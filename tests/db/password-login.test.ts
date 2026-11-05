import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas, AuthResult } from '../../src/contracts/index.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { ReadingClient, readingAccount, readingBindings } from '../fixtures/reading-client.ts';
import { encode, uuidBytes } from '../../src/worker/identity/crypto.ts';
import { OfflineRestore } from '../../src/worker/recovery/restore.ts';
import { objects } from '../../src/worker/recovery/ledger.ts';
import { restoreSnapshot, snapshot } from '../fixtures/snapshot.ts';
import { syntheticPasskey } from '../fixtures/passkeys.ts';

const registration = {
  username: 'Garden_Reader',
  email: 'Reader@example.org',
  password: '  Many garden paths 🌿  ',
};
const register = (client: ReadingClient) => client.request('/auth/password/register', registration);
const login = (client: ReadingClient, identifier: string, password = registration.password) =>
  client.request('/auth/password/login', { identifier, password });
beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));

test('both normalized identifiers open the same account, and password characters are exact', async () => {
  const client = new ReadingClient();
  const response = await register(client);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const account = AuthResult.parse(await response.json());
  expect(account.recoveryCodes).toHaveLength(10);
  await client.me();
  await client.acknowledge();
  expect((await client.request('/auth/logout', {})).status).toBe(204);
  for (const identifier of ['  GARDEN_READER ', ' reader@EXAMPLE.ORG ']) {
    const other = new ReadingClient();
    expect((await login(other, identifier)).status).toBe(200);
    expect(await other.me()).toMatchObject({ subjectId: account.subjectId, passwordEnabled: true });
  }
  const rows = JSON.stringify(await env.DB.prepare('SELECT * FROM accounts').all());
  for (const value of Object.values(registration))
    expect(rows.toLowerCase()).not.toContain(value.toLowerCase());
  expect(rows).toContain('scrypt-v1');
  const wrong = await login(client, registration.email, registration.password.trim());
  const missing = await login(client, 'no-such-reader');
  expect([wrong.status, missing.status]).toEqual([401, 401]);
  expect((await wrong.json<{ error: { message: string } }>()).error.message).toBe(
    (await missing.json<{ error: { message: string } }>()).error.message,
  );
  expect((await client.request('/me')).status).toBe(401);
});

test('colliding accounts cannot claim either identifier, even in a race', async () => {
  const replies = await Promise.all([register(new ReadingClient()), register(new ReadingClient())]);
  expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
  for (const change of [
    { email: 'another@example.org', username: 'GARDEN_READER' },
    { username: 'another', email: 'READER@EXAMPLE.ORG' },
  ]) {
    expect(
      (await new ReadingClient().request('/auth/password/register', { ...registration, ...change }))
        .status,
    ).toBe(409);
  }
  expect(await env.DB.prepare('SELECT count(*) AS n FROM accounts').first('n')).toBe(1);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM security_operations').first('n')).toBe(1);
});

test('a passkey account can opt in only after proving its existing passkey', async () => {
  const { client, kit, passkey } = await readingAccount(false, false);
  expect((await client.request('/auth/password/enroll', registration)).status).toBe(401);
  const options = apiSchemas.AuthOptions.parse(
    await (await client.request('/auth/options', { purpose: 'reauthenticate' })).json(),
  );
  const proof = await client.request('/auth/authenticate', {
    challengeId: options.challengeId,
    credential: await passkey.authenticate(options, encode(uuidBytes(kit.subjectId)), 1),
  });
  client.csrf = AuthResult.parse(await proof.json()).csrfToken;
  expect(
    (
      await client.request('/auth/password/enroll', registration, {
        headers: { 'X-CSRF-Token': 'bad' },
      })
    ).status,
  ).toBe(403);
  expect((await client.request('/auth/password/enroll', registration)).status).toBe(200);
  const other = new ReadingClient();
  expect((await login(other, registration.username)).status).toBe(200);
  expect((await other.me()).subjectId).toBe(kit.subjectId);
  expect((await other.request('/auth/options', { purpose: 'add' })).status).toBe(401);
});

test('kit recovery replaces a forgotten password on the same account and revokes old access', async () => {
  for (const object of await objects(env.RECOVERY, '')) await env.RECOVERY.delete(object.key);
  const owner = new ReadingClient(),
    fresh = new ReadingClient();
  const kit = AuthResult.parse(await (await register(owner)).json());
  const backup = await snapshot(env.DB);
  const proof = { recoveryHandle: kit.recoveryHandle, code: kit.recoveryCodes[0] };
  const grant = apiSchemas.RecoveryGrant.parse(
    await (await fresh.request('/auth/recover', proof)).json(),
  );
  expect(grant.passwordEnabled).toBe(true);
  const replacement = { challengeId: grant.challengeId, password: 'A different garden path' };
  expect((await owner.request('/auth/password/recover', replacement)).status).toBe(401);
  const response = await fresh.request('/auth/password/recover', replacement);
  expect(response.status).toBe(200);
  expect(AuthResult.parse(await response.json())).toMatchObject({ subjectId: kit.subjectId });
  expect((await owner.request('/me')).status).toBe(401);
  expect((await fresh.request('/auth/password/recover', replacement)).status).toBe(401);
  expect((await login(owner, registration.username)).status).toBe(401);
  expect((await login(owner, registration.email, replacement.password)).status).toBe(200);
  const operator = new OfflineRestore({ ...readingBindings, RESTORE_MODE: 'offline' });
  await operator.prepare();
  await restoreSnapshot(env.DB, backup);
  await operator.replay();
  expect((await login(owner, registration.email)).status).toBe(401);
  expect((await login(owner, registration.username, replacement.password)).status).toBe(200);
});

test('confirming a password rotates only the current session and authorizes a first passkey', async () => {
  const client = new ReadingClient();
  await register(client);
  await client.me();
  expect((await client.request('/auth/options', { purpose: 'add' })).status).toBe(401);
  const confirm = (password: string) =>
    client.request('/auth/password/reauthenticate', { password });
  expect((await confirm('incorrect password')).status).toBe(401);
  const stale = new ReadingClient();
  stale.cookies = new Map(client.cookies);
  expect((await confirm(registration.password)).status).toBe(200);
  expect((await stale.request('/me')).status).toBe(401);
  await client.me();
  const options = apiSchemas.AuthOptions.parse(
    await (await client.request('/auth/options', { purpose: 'add' })).json(),
  );
  const passkey = await syntheticPasskey();
  expect(
    (
      await client.request('/auth/register', {
        challengeId: options.challengeId,
        credential: await passkey.register(options),
      })
    ).status,
  ).toBe(200);
  expect((await login(client, registration.username)).status).toBe(200);
  await client.me();
  expect((await client.request('/auth/options', { purpose: 'add' })).status).toBe(401);
});

test('registration validates both aliases and passwords, and login limits guesses across IP addresses', async () => {
  const client = new ReadingClient();
  for (const changes of [{ email: 'invalid' }, { username: 'x@y' }, { password: 'short' }]) {
    expect(
      (await client.request('/auth/password/register', { ...registration, ...changes })).status,
    ).toBe(400);
  }
  expect(
    (
      await client.request('/auth/password/register', registration, {
        headers: { Origin: 'https://another.example' },
      })
    ).status,
  ).toBe(403);
  for (let attempt = 0; attempt < 10; attempt++)
    expect((await login(new ReadingClient(), '  Unknown  ', 'wrong')).status).toBe(401);
  expect((await login(new ReadingClient(), 'UNKNOWN', 'wrong')).status).toBe(429);
});
