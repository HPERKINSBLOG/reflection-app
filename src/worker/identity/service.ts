import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { z } from 'zod';
import { apiSchemas, AuthOptions, IdentityCheckpoint } from '../../contracts/index.ts';
import { assertion, onlineGuard, DB_NOW, IdentityCheckpoints, statement } from './checkpoint.ts';
import { type Checkpoint, encode, type IdentityCrypto, randomToken, uuidBytes } from './crypto.ts';
import { IdentitySessions } from './sessions.ts';
import {
  loginHash,
  makePasswordFactor,
  type PasswordInput,
  passwordVerifier,
  verifyPassword,
} from './password.ts';
import { type Challenge, type CredentialRow, IdentityError, type Session } from './types.ts';

// Map SimpleWebAuthn verification failures to safe, actionable categories. The
// library's raw messages can name expected origins/challenges, so they never
// reach the client; only these codes cross the boundary.
function verificationFailure(error: unknown, fallback: string): IdentityError {
  const message = error instanceof Error ? error.message : '';
  if (/origin|RP ID hash/i.test(message)) return new IdentityError(401, 'PASSKEY_ORIGIN_MISMATCH');
  if (/user verification|user presence|user.*not present/i.test(message))
    return new IdentityError(401, 'PASSKEY_VERIFICATION_REQUIRED');
  if (/public key alg|attestation format/i.test(message))
    return new IdentityError(401, 'PASSKEY_UNSUPPORTED');
  if (/challenge/i.test(message)) return new IdentityError(401, 'CHALLENGE_INVALID');
  return new IdentityError(401, fallback);
}

export class IdentityService {
  readonly sessions: IdentitySessions;
  readonly checkpoints: IdentityCheckpoints;
  constructor(
    private db: D1Database,
    bucket: R2Bucket,
    readonly crypt: IdentityCrypto,
    readonly origin: string,
  ) {
    this.sessions = new IdentitySessions(db, crypt);
    this.checkpoints = new IdentityCheckpoints(db, bucket, crypt);
  }
  async maintenance(deadlineMs = Infinity): Promise<void> {
    await this.checkpoints.resumePending(deadlineMs);
  }
  async rate(scope: string, identity: string, limit: number, period: number): Promise<void> {
    const now = Date.now(),
      day = Math.floor(now / 86_400_000),
      start = Math.floor(now / period) * period;
    const hash = await this.crypt.hash('rate', [scope, day, identity]);
    const results = await this.db.batch<{ count: number }>([
      onlineGuard(this.db),
      statement(
        this.db,
        'INSERT INTO rate_buckets(scope_hash,window_start,count,expires_at) VALUES (?,?,1,?) ON CONFLICT(scope_hash,window_start) DO UPDATE SET count=count+1 RETURNING count',
        hash,
        start,
        now + 2 * 86_400_000,
      ),
    ]);
    const row = results[1]?.results[0];
    if (!row || row.count > limit) throw new IdentityError(429, 'RATE_LIMITED');
  }
  private async newChallenge(
    purpose: string,
    owner: string | null = null,
    epoch: number | null = null,
  ) {
    const id = crypto.randomUUID(),
      challenge = randomToken(),
      browser = randomToken(),
      now = Date.now();
    const options = AuthOptions.parse({
      challengeId: id,
      challenge,
      rpId: new URL(this.origin).hostname,
      user:
        purpose === 'authenticate' || purpose === 'reauthenticate'
          ? null
          : {
              id: encode(uuidBytes(owner ?? id)),
              name: `Reflection account ${id.slice(0, 8)}`,
              displayName: `Reflection account ${id.slice(0, 8)}`,
            },
      rpName: 'Reflection',
      timeout: 300000,
      userVerification: 'required',
      residentKey: 'required',
      attestation: 'none',
      algorithms: [-7, -257],
      excludeCredentialIds: [],
    });
    const insert = statement(
      this.db,
      'INSERT INTO auth_challenges(id,owner_id,purpose,challenge_hash,browser_hash,auth_epoch,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)',
      id,
      owner,
      purpose,
      await this.crypt.hash('challenge', challenge),
      await this.crypt.hash('browser', browser),
      epoch,
      now + 300_000,
      now,
    );
    return { options, browser, insert };
  }
  async begin(purpose: z.infer<typeof apiSchemas.AuthBegin>['purpose'], session?: Session) {
    if (purpose === 'reauthenticate' && !session) throw new IdentityError(401, 'AUTH_REQUIRED');
    let excluded: string[] = [];
    let factor: 'passkey' | 'password' | undefined;
    if (purpose === 'add') {
      if (!session) throw new IdentityError(401, 'AUTH_REQUIRED');
      excluded = (await this.credentials(session)).items.map((credential) => credential.id);
      factor = excluded.length ? 'passkey' : 'password';
      this.requireRecentFactor(session, factor);
      if (excluded.length >= 10) throw new IdentityError(409, 'CREDENTIAL_LIMIT');
    }
    const made = await this.newChallenge(
      purpose,
      session?.subjectId ?? null,
      session?.epoch ?? null,
    );
    made.options.excludeCredentialIds = excluded;
    await this.db.batch([
      onlineGuard(this.db),
      ...(session ? [this.sessions.guard(session, purpose === 'add', true, factor)] : []),
      made.insert,
    ]);
    return made;
  }
  private requireRecentFactor(session: Session, factor: 'passkey' | 'password') {
    const cutoff = Date.now() - 300_000;
    const confirmedAt =
      factor === 'passkey' ? session.passkeyAuthenticatedAt : session.passwordAuthenticatedAt;
    if (session.authenticatedAt <= cutoff || confirmedAt === null || confirmedAt <= cutoff)
      throw new IdentityError(401, 'REAUTH_REQUIRED');
  }
  async credentials(session: Session) {
    if (session.writeFence) throw new IdentityError(503, 'DEPENDENCY_UNAVAILABLE');
    const results = await this.db.batch<{ id: string; created_at: number; backed_up: number }>([
      this.sessions.guard(session),
      statement(
        this.db,
        'SELECT id,created_at,backed_up FROM credentials WHERE owner_id=? ORDER BY created_at,id',
        session.subjectId,
      ),
    ]);
    return apiSchemas.Credentials.parse({
      items: results[1]!.results.map((credential) => ({
        id: credential.id,
        createdAt: new Date(credential.created_at).toISOString(),
        backedUp: Boolean(credential.backed_up),
      })),
    });
  }
  private async challenge(
    id: string,
    browser: string | undefined,
    purposes: string[],
  ): Promise<Challenge> {
    if (!browser) throw new IdentityError(401, 'CHALLENGE_MISSING');
    const row = await statement(
      this.db,
      'SELECT * FROM auth_challenges WHERE id=?',
      id,
    ).first<Challenge>();
    // Expiry/reuse are only disclosed to the browser holding the challenge
    // cookie; anyone else gets the same answer as an unknown challenge.
    if (!row || row.browser_hash !== (await this.crypt.hash('browser', browser)))
      throw new IdentityError(401, 'CHALLENGE_INVALID');
    if (!purposes.includes(row.purpose)) throw new IdentityError(401, 'CHALLENGE_INVALID');
    if (row.consumed_at !== null) throw new IdentityError(401, 'CHALLENGE_USED');
    if (row.expires_at <= Date.now()) throw new IdentityError(401, 'CHALLENGE_EXPIRED');
    if (row.owner_id) {
      const account = await statement(
        this.db,
        "SELECT 1 AS ok FROM accounts WHERE id=? AND auth_epoch=? AND status='active' AND write_fence IS NULL",
        row.owner_id,
        row.auth_epoch,
      ).first();
      if (!account) throw new IdentityError(401, 'AUTH_FAILED');
    }
    return row;
  }
  private consume(row: Challenge): D1PreparedStatement[] {
    return [
      assertion(
        this.db,
        `EXISTS(SELECT 1 FROM auth_challenges WHERE id=? AND purpose=? AND browser_hash=? AND consumed_at IS NULL AND expires_at>${DB_NOW})`,
        row.id,
        row.purpose,
        row.browser_hash,
      ),
      statement(this.db, `UPDATE auth_challenges SET consumed_at=${DB_NOW} WHERE id=?`, row.id),
    ];
  }
  private async kit() {
    const recoveryHandle = randomToken(16),
      codes = Array.from({ length: 10 }, () => randomToken(16)),
      createdAt = new Date().toISOString();
    return {
      recoveryHandle,
      codes,
      hash: await this.crypt.hash('recovery-handle', recoveryHandle),
      verifiers: await Promise.all(
        codes.map(async (code) => ({
          codeHash: await this.crypt.hash('recovery-code', [recoveryHandle, code]),
          usedAt: null,
          createdAt,
        })),
      ),
    };
  }
  async snapshot(subjectId: string): Promise<Checkpoint> {
    const account = await statement(
      this.db,
      "SELECT * FROM accounts WHERE id=? AND status='active' AND write_fence IS NULL",
      subjectId,
    ).first<{
      auth_epoch: number;
      recovery_handle_hash: string;
      recovery_ack_at: number | null;
      login_username_hash: string | null;
      login_email_hash: string | null;
      password_verifier: string | null;
    }>();
    if (!account) throw new IdentityError(401, 'ACCOUNT_UNAVAILABLE');
    const credentials = await statement(
      this.db,
      'SELECT * FROM credentials WHERE owner_id=? ORDER BY id',
      subjectId,
    ).all<CredentialRow>();
    const codes = await statement(
      this.db,
      'SELECT * FROM recovery_codes WHERE owner_id=? ORDER BY code_hash',
      subjectId,
    ).all<{ code_hash: string; used_at: number | null; created_at: number }>();
    return IdentityCheckpoint.parse({
      v: 1,
      operationId: crypto.randomUUID(),
      subjectId,
      epoch: account.auth_epoch,
      createdAt: new Date().toISOString(),
      recoveryHandleHash: account.recovery_handle_hash,
      ...(account.password_verifier
        ? {
            password: {
              usernameHash: account.login_username_hash,
              emailHash: account.login_email_hash,
              verifier: account.password_verifier,
            },
          }
        : {}),
      recoveryAcknowledgedAt:
        account.recovery_ack_at === null ? null : new Date(account.recovery_ack_at).toISOString(),
      credentials: credentials.results.map((c) => ({
        id: c.id,
        publicKey: encode(new Uint8Array(c.public_key)),
        signCount: c.sign_count,
        backedUp: Boolean(c.backed_up),
        transports: JSON.parse(c.transports_json),
        createdAt: new Date(c.created_at).toISOString(),
      })),
      recoveryCodes: codes.results.map((c) => ({
        codeHash: c.code_hash,
        usedAt: c.used_at === null ? null : new Date(c.used_at).toISOString(),
        createdAt: new Date(c.created_at).toISOString(),
      })),
    });
  }
  async register(
    input: z.infer<typeof apiSchemas.RegisterFinish>,
    browser: string | undefined,
    ip = 'loopback',
    session?: Session,
    csrfToken?: string,
  ) {
    const challenge = await this.challenge(input.challengeId, browser, [
      'register',
      'recover',
      'add',
    ]);
    const current = challenge.purpose === 'add' ? session : undefined;
    if (challenge.purpose === 'add' && !current) throw new IdentityError(401, 'AUTH_REQUIRED');
    if (current) {
      if (csrfToken !== current.csrfToken) throw new IdentityError(403, 'FORBIDDEN');
      if (current.subjectId !== challenge.owner_id || current.epoch !== challenge.auth_epoch)
        throw new IdentityError(401, 'AUTH_REQUIRED');
    }
    const credential = input.credential;
    if (credential.id !== credential.rawId)
      throw new IdentityError(401, 'PASSKEY_VERIFICATION_FAILED');
    // Only an explicit rk:false proves the credential is not discoverable.
    // Several browsers/managers never return credProps; for them the
    // residentKey:'required' creation option already guarantees discoverability.
    if (credential.clientExtensionResults.credProps?.rk === false)
      throw new IdentityError(401, 'PASSKEY_NOT_DISCOVERABLE');
    const verified = await verifyRegistrationResponse({
      response: {
        id: credential.id,
        rawId: credential.rawId,
        type: credential.type,
        response: credential.response,
        clientExtensionResults: { credProps: { rk: true } },
        ...(credential.authenticatorAttachment
          ? { authenticatorAttachment: credential.authenticatorAttachment }
          : {}),
      },
      expectedChallenge: async (value) =>
        (await this.crypt.hash('challenge', value)) === challenge.challenge_hash,
      expectedOrigin: this.origin,
      expectedRPID: new URL(this.origin).hostname,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -257],
    }).catch((error: unknown) => {
      throw verificationFailure(error, 'PASSKEY_VERIFICATION_FAILED');
    });
    if (!verified.verified) throw new IdentityError(401, 'PASSKEY_VERIFICATION_FAILED');
    if (verified.registrationInfo.fmt !== 'none')
      throw new IdentityError(401, 'PASSKEY_UNSUPPORTED');
    if (current) {
      const previous = await this.snapshot(current.subjectId);
      const factor = previous.credentials.length ? 'passkey' : 'password';
      this.requireRecentFactor(current, factor);
      if (previous.credentials.length >= 10) throw new IdentityError(409, 'CREDENTIAL_LIMIT');
      const info = verified.registrationInfo;
      if (
        await statement(this.db, 'SELECT 1 FROM credentials WHERE id=?', info.credential.id).first()
      )
        throw new IdentityError(409, 'CREDENTIAL_EXISTS');
      const now = new Date().toISOString();
      const snapshot: Checkpoint = {
        ...previous,
        operationId: crypto.randomUUID(),
        epoch: previous.epoch + 1,
        createdAt: now,
        credentials: [
          ...previous.credentials,
          {
            id: info.credential.id,
            publicKey: encode(info.credential.publicKey),
            signCount: info.credential.counter,
            backedUp: info.credentialBackedUp,
            transports: credential.response.transports,
            createdAt: now,
          },
        ],
      };
      await this.checkpoints.commit(snapshot, {
        expected: previous,
        guards: [
          this.sessions.guard(current, true, true, factor),
          ...this.consume(challenge),
          assertion(
            this.db,
            'NOT EXISTS(SELECT 1 FROM credentials WHERE id=?)',
            info.credential.id,
          ),
          assertion(
            this.db,
            '(SELECT count(*) FROM credentials WHERE owner_id=?)<10',
            current.subjectId,
          ),
        ],
      });
      return this.sessions.issue(
        current.subjectId,
        snapshot.epoch,
        current.authenticatedAt,
        [],
        current,
      );
    }
    if (challenge.purpose === 'register') await this.rate('registration', ip, 3, 86_400_000);
    const subjectId = challenge.owner_id ?? challenge.id,
      previous = challenge.purpose === 'recover' ? await this.snapshot(subjectId) : undefined;
    if (previous && previous.epoch !== challenge.auth_epoch)
      throw new IdentityError(401, 'CHALLENGE_INVALID');
    const info = verified.registrationInfo;
    return this.establishAccount(
      subjectId,
      [
        {
          id: info.credential.id,
          publicKey: encode(info.credential.publicKey),
          signCount: info.credential.counter,
          backedUp: info.credentialBackedUp,
          transports: credential.response.transports,
          createdAt: new Date().toISOString(),
        },
      ],
      undefined,
      this.consume(challenge),
      previous,
    );
  }
  private async establishAccount(
    subjectId: string,
    credentials: Checkpoint['credentials'],
    password: Checkpoint['password'],
    guards: D1PreparedStatement[],
    previous?: Checkpoint,
  ) {
    const kit = await this.kit();
    const snapshot: Checkpoint = {
      v: 1,
      operationId: crypto.randomUUID(),
      subjectId,
      epoch: previous ? previous.epoch + 1 : 1,
      createdAt: new Date().toISOString(),
      recoveryHandleHash: kit.hash,
      recoveryAcknowledgedAt: null,
      credentials,
      ...(password ? { password } : {}),
      recoveryCodes: kit.verifiers,
    };
    await this.checkpoints.commit(snapshot, {
      ...(previous
        ? { expected: previous }
        : { initialKeys: await this.crypt.createAccountKeys(subjectId) }),
      guards,
    });
    const issued = await this.sessions.issue(subjectId, snapshot.epoch);
    issued.result.recoveryHandle = kit.recoveryHandle;
    issued.result.recoveryCodes = kit.codes;
    return issued;
  }
  async registerPassword(input: PasswordInput, ip: string) {
    await this.rate('registration', ip, 3, 86_400_000);
    const owner = crypto.randomUUID();
    return this.establishAccount(owner, [], await makePasswordFactor(this.crypt, owner, input), []);
  }
  async enrollPassword(input: PasswordInput, session: Session) {
    this.requireRecentFactor(session, 'passkey');
    const previous = await this.snapshot(session.subjectId);
    if (previous.password) throw new IdentityError(409, 'PASSWORD_ALREADY_ENABLED');
    const snapshot = {
      ...previous,
      operationId: crypto.randomUUID(),
      epoch: previous.epoch + 1,
      createdAt: new Date().toISOString(),
      password: await makePasswordFactor(this.crypt, session.subjectId, input),
    };
    await this.checkpoints.commit(snapshot, {
      expected: previous,
      guards: [this.sessions.guard(session, true, true, 'passkey')],
    });
    return this.sessions.issue(
      session.subjectId,
      snapshot.epoch,
      session.authenticatedAt,
      [],
      session,
    );
  }
  async authenticatePassword(
    password: string,
    subject: { identifier: string } | { session: Session },
    ip: string,
  ) {
    await this.rate('password-ip', ip, 20, 600_000);
    const current = 'session' in subject ? subject.session : undefined;
    const lookup =
      'identifier' in subject
        ? await loginHash(this.crypt, subject.identifier)
        : subject.session.subjectId;
    await this.rate('password-identifier', lookup, 10, 600_000);
    const column =
      'identifier' in subject
        ? subject.identifier.includes('@')
          ? 'login_email_hash'
          : 'login_username_hash'
        : 'id';
    const row = await statement(
      this.db,
      `SELECT id,auth_epoch,password_verifier FROM accounts WHERE ${column}=? AND status='active' AND write_fence IS NULL AND password_verifier IS NOT NULL`,
      lookup,
    ).first<{ id: string; auth_epoch: number; password_verifier: string }>();
    const valid = await verifyPassword(
      this.crypt,
      row?.id ?? '00000000-0000-0000-0000-000000000000',
      password,
      row?.password_verifier ?? null,
    );
    if (!valid || !row)
      throw new IdentityError(401, current ? 'PASSWORD_CONFIRMATION_FAILED' : 'PASSWORD_FAILED');
    const now = Date.now();
    return this.sessions.issue(
      row.id,
      row.auth_epoch,
      now,
      current
        ? [
            this.sessions.guard(current),
            statement(this.db, 'DELETE FROM auth_sessions WHERE token_hash=?', current.tokenHash),
          ]
        : [],
      { passwordAuthenticatedAt: now },
    );
  }
  async recoverPassword(
    input: z.infer<typeof apiSchemas.PasswordRecovery>,
    browser: string | undefined,
  ) {
    const challenge = await this.challenge(input.challengeId, browser, ['recover']);
    if (!challenge.owner_id) throw new IdentityError(401, 'CHALLENGE_INVALID');
    const previous = await this.snapshot(challenge.owner_id);
    if (previous.epoch !== challenge.auth_epoch || !previous.password)
      throw new IdentityError(401, 'CHALLENGE_INVALID');
    const password = {
      ...previous.password,
      verifier: await passwordVerifier(this.crypt, previous.subjectId, input.password),
    };
    return this.establishAccount(
      previous.subjectId,
      [],
      password,
      this.consume(challenge),
      previous,
    );
  }
  async authenticate(
    input: z.infer<typeof apiSchemas.AuthenticateFinish>,
    browser: string | undefined,
    session?: Session,
  ) {
    const challenge = await this.challenge(input.challengeId, browser, [
      'authenticate',
      'reauthenticate',
    ]);
    const row = await statement(
      this.db,
      "SELECT c.*,a.auth_epoch FROM credentials c JOIN accounts a ON a.id=c.owner_id WHERE c.id=? AND a.status='active' AND a.write_fence IS NULL",
      input.credential.id,
    ).first<CredentialRow & { auth_epoch: number }>();
    if (
      !row ||
      input.credential.id !== input.credential.rawId ||
      input.credential.response.userHandle !== encode(uuidBytes(row.owner_id))
    )
      throw new IdentityError(401, 'AUTH_FAILED');
    if (
      challenge.purpose === 'reauthenticate' &&
      (!session ||
        session.subjectId !== row.owner_id ||
        session.epoch !== row.auth_epoch ||
        challenge.owner_id !== row.owner_id)
    )
      throw new IdentityError(401, 'AUTH_REQUIRED');
    const verified = await verifyAuthenticationResponse({
      response: {
        id: input.credential.id,
        rawId: input.credential.rawId,
        type: input.credential.type,
        response: { ...input.credential.response, userHandle: encode(uuidBytes(row.owner_id)) },
        clientExtensionResults: {},
        ...(input.credential.authenticatorAttachment
          ? { authenticatorAttachment: input.credential.authenticatorAttachment }
          : {}),
      },
      expectedChallenge: async (value) =>
        (await this.crypt.hash('challenge', value)) === challenge.challenge_hash,
      expectedOrigin: this.origin,
      expectedRPID: new URL(this.origin).hostname,
      requireUserVerification: true,
      credential: {
        id: row.id,
        publicKey: new Uint8Array(row.public_key),
        counter: row.sign_count,
      },
    }).catch((error: unknown) => {
      // Origin/verification problems are actionable by the person signing in;
      // signature and counter failures stay under the generic AUTH_FAILED.
      throw verificationFailure(error, 'AUTH_FAILED');
    });
    if (!verified.verified) throw new IdentityError(401, 'AUTH_FAILED');
    const now = Date.now();
    return this.sessions.issue(
      row.owner_id,
      row.auth_epoch,
      now,
      [
        ...this.consume(challenge),
        ...(session ? [this.sessions.guard(session)] : []),
        assertion(
          this.db,
          'EXISTS(SELECT 1 FROM credentials WHERE id=? AND owner_id=? AND sign_count=?)',
          row.id,
          row.owner_id,
          row.sign_count,
        ),
        statement(
          this.db,
          'UPDATE credentials SET sign_count=?,backed_up=? WHERE id=?',
          verified.authenticationInfo.newCounter,
          Number(verified.authenticationInfo.credentialBackedUp),
          row.id,
        ),
        ...(session
          ? [statement(this.db, 'DELETE FROM auth_sessions WHERE token_hash=?', session.tokenHash)]
          : []),
      ],
      { passkeyAuthenticatedAt: now },
    );
  }
  async recover(input: z.infer<typeof apiSchemas.Recover>, ip = 'loopback') {
    const now = Date.now(),
      day = Math.floor(now / 86_400_000),
      start = Math.floor(now / 3_600_000) * 3_600_000;
    const hashes = await Promise.all([
      this.crypt.hash('rate', ['recovery-ip', day, ip]),
      this.crypt.hash('rate', ['recovery-handle', day, input.recoveryHandle]),
    ]);
    const limited = await statement(
      this.db,
      'SELECT 1 FROM rate_buckets WHERE scope_hash IN (?,?) AND window_start=? AND count>=5',
      hashes[0]!,
      hashes[1]!,
      start,
    ).first();
    if (limited) throw new IdentityError(429, 'RATE_LIMITED');
    try {
      return await this.recoverAccount(input);
    } catch (error) {
      if (
        !(error instanceof IdentityError && error.status === 401) &&
        !(
          error instanceof Error &&
          /CHECK constraint failed|UNIQUE constraint failed/.test(error.message)
        )
      )
        throw error;
      const results = await this.db.batch<{ count: number }>([
        onlineGuard(this.db),
        ...hashes.map((hash) =>
          statement(
            this.db,
            'INSERT INTO rate_buckets(scope_hash,window_start,count,expires_at) VALUES (?,?,1,?) ON CONFLICT(scope_hash,window_start) DO UPDATE SET count=count+1 RETURNING count',
            hash,
            start,
            now + 2 * 86_400_000,
          ),
        ),
      ]);
      if (results.slice(1).some((result) => result.results[0]!.count > 5))
        throw new IdentityError(429, 'RATE_LIMITED');
      // Preserve the specific 401 (e.g. RECOVERY_FAILED) instead of flattening it.
      throw error instanceof IdentityError ? error : new IdentityError(401, 'AUTH_FAILED');
    }
  }
  private async recoverAccount(input: z.infer<typeof apiSchemas.Recover>) {
    const handleHash = await this.crypt.hash('recovery-handle', input.recoveryHandle),
      codeHash = await this.crypt.hash('recovery-code', [input.recoveryHandle, input.code]);
    const account = await statement(
      this.db,
      "SELECT a.id FROM accounts a JOIN recovery_codes c ON c.owner_id=a.id WHERE a.recovery_handle_hash=? AND c.code_hash=? AND c.used_at IS NULL AND a.status='active' AND a.write_fence IS NULL",
      handleHash,
      codeHash,
    ).first<{ id: string }>();
    if (!account) throw new IdentityError(401, 'RECOVERY_FAILED');
    const previous = await this.snapshot(account.id),
      epoch = previous.epoch + 1;
    const made = await this.newChallenge('recover', account.id, epoch),
      now = new Date().toISOString();
    const snapshot = {
      ...previous,
      operationId: crypto.randomUUID(),
      epoch,
      createdAt: now,
      recoveryCodes: previous.recoveryCodes.map((code) =>
        code.codeHash === codeHash ? { ...code, usedAt: now } : code,
      ),
    };
    await this.checkpoints.commit(snapshot, {
      expected: previous,
      guards: [
        assertion(
          this.db,
          'EXISTS(SELECT 1 FROM recovery_codes WHERE owner_id=? AND code_hash=? AND used_at IS NULL)',
          account.id,
          codeHash,
        ),
        made.insert,
      ],
    });
    return {
      browser: made.browser,
      result: {
        challengeId: made.options.challengeId,
        options: made.options,
        ...(previous.password ? { passwordEnabled: true } : {}),
      },
    };
  }
  async acknowledge(session: Session) {
    const previous = await this.snapshot(session.subjectId);
    if (previous.recoveryAcknowledgedAt) return null;
    const snapshot = {
      ...previous,
      operationId: crypto.randomUUID(),
      epoch: previous.epoch + 1,
      recoveryAcknowledgedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    await this.checkpoints.commit(snapshot, {
      expected: previous,
      guards: [this.sessions.guard(session)],
    });
    return this.sessions.issue(
      session.subjectId,
      snapshot.epoch,
      session.authenticatedAt,
      [],
      session,
    );
  }
  async rotate(session: Session) {
    const previous = await this.snapshot(session.subjectId),
      kit = await this.kit();
    const snapshot = {
      ...previous,
      operationId: crypto.randomUUID(),
      epoch: previous.epoch + 1,
      createdAt: new Date().toISOString(),
      recoveryAcknowledgedAt: null,
      recoveryHandleHash: kit.hash,
      recoveryCodes: kit.verifiers,
    };
    await this.checkpoints.commit(snapshot, {
      expected: previous,
      guards: [this.sessions.guard(session, true)],
    });
    return {
      ...(await this.sessions.issue(
        session.subjectId,
        snapshot.epoch,
        session.authenticatedAt,
        [],
        session,
      )),
      kit: { recoveryHandle: kit.recoveryHandle, codes: kit.codes },
    };
  }
  async logoutAll(session: Session) {
    const previous = await this.snapshot(session.subjectId);
    // Persist the new epoch independently before acknowledging revocation. The
    // checkpoint apply transaction clears every session and old challenge.
    await this.checkpoints.commit(
      {
        ...previous,
        operationId: crypto.randomUUID(),
        epoch: previous.epoch + 1,
        createdAt: new Date().toISOString(),
      },
      { expected: previous, guards: [this.sessions.guard(session)] },
    );
  }
  async removeCredential(session: Session, id: string) {
    this.requireRecentFactor(session, 'passkey');
    const previous = await this.snapshot(session.subjectId);
    if (!previous.credentials.some((credential) => credential.id === id))
      throw new IdentityError(404, 'NOT_FOUND');
    if (previous.credentials.length <= 1) throw new IdentityError(409, 'LAST_CREDENTIAL');
    const snapshot: Checkpoint = {
      ...previous,
      operationId: crypto.randomUUID(),
      epoch: previous.epoch + 1,
      createdAt: new Date().toISOString(),
      credentials: previous.credentials.filter((credential) => credential.id !== id),
    };
    await this.checkpoints.commit(snapshot, {
      expected: previous,
      guards: [
        this.sessions.guard(session, true, true, 'passkey'),
        assertion(
          this.db,
          '(SELECT count(*) FROM credentials WHERE owner_id=?)>1',
          session.subjectId,
        ),
      ],
    });
    return this.sessions.issue(
      session.subjectId,
      snapshot.epoch,
      session.authenticatedAt,
      [],
      session,
    );
  }
}
