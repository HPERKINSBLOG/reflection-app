import {
  BirthDraft,
  BirthProfileV1,
  BirthProfileView,
  BirthProfileWrite,
} from '../../contracts/astrology.ts';
import { resolveBirthTime } from '../../domain/astrology/civil-time.ts';
import { validateBirthplace } from './places.ts';
import type { Session } from '../identity/types.ts';
import { assertion } from '../identity/checkpoint.ts';
import { statement as q } from '../db/core.ts';
import { type RecordBase, RecordError, iso } from '../readings/base.ts';

export class BirthProfiles {
  constructor(readonly base: RecordBase) {}
  guard(session: Session, revision: number, present = true) {
    return assertion(
      this.base.db,
      `coalesce((SELECT revision FROM birth_profiles WHERE owner_id=?),0)=? AND NOT EXISTS(SELECT 1 FROM deletion_jobs WHERE owner_id=? AND scope='birth_profile' AND state!='complete')${present ? ' AND EXISTS(SELECT 1 FROM birth_profiles WHERE owner_id=? AND body_enc IS NOT NULL AND deleted_at IS NULL)' : ''}`,
      session.subjectId,
      revision,
      session.subjectId,
      ...(present ? [session.subjectId] : []),
    );
  }
  async resolve(input: unknown) {
    const birth = BirthDraft.parse(input);
    if (!(await validateBirthplace(birth.place)))
      return {
        kind: 'invalid' as const,
        message: 'Choose a current birthplace result or enter the place and timezone manually.',
      };
    return resolveBirthTime(birth, new Date());
  }
  async read(session: Session) {
    const account = await this.base.account(session);
    if (
      await q(
        this.base.db,
        "SELECT 1 FROM deletion_jobs WHERE owner_id=? AND scope='birth_profile' AND state!='complete'",
        session.subjectId,
      ).first()
    )
      throw new RecordError(503, 'DEPENDENCY_UNAVAILABLE');
    const row = await q(
      this.base.db,
      'SELECT id,revision,body_enc FROM birth_profiles WHERE owner_id=?',
      session.subjectId,
    ).first<{ id: string; revision: number; body_enc: string | null }>();
    const profile = row?.body_enc
      ? await this.base.opened<BirthProfileV1>(
          {
            ownerId: session.subjectId,
            table: 'birth_profiles',
            column: 'body_enc',
            recordId: row.id,
            aadRevision: row.revision,
          },
          row.body_enc,
          BirthProfileV1,
        )
      : null;
    if (profile && (profile.id !== row!.id || profile.revision !== row!.revision))
      throw new RecordError(503, 'KEY_UNAVAILABLE');
    await this.base.checked(session, account.data_revision, [
      this.guard(session, row?.revision ?? 0, false),
    ]);
    return BirthProfileView.parse({ profile, revision: row?.revision ?? 0 });
  }
  async write(session: Session, raw: unknown, key: string) {
    const input = BirthProfileWrite.parse(raw),
      account = await this.base.account(session);
    if (!account.recovery_ack_at) throw new RecordError(403, 'FORBIDDEN');
    const mutation = await this.base.mutation(session, key, 'birth-profile.write', input);
    const current = await this.read(session);
    if (mutation.existing) {
      if (current.profile && mutation.existing === `${current.profile.id}:${current.revision}`)
        return current;
      throw new RecordError(409, 'CONFLICT', current.revision || null);
    }
    if (current.revision !== input.expectedRevision)
      throw new RecordError(409, 'CONFLICT', current.revision || null);
    const resolution = await this.resolve(input.birth);
    if (resolution.kind !== 'resolved') throw new RecordError(400, 'BAD_INPUT');
    const old = await q(
      this.base.db,
      'SELECT id,created_at FROM birth_profiles WHERE owner_id=?',
      session.subjectId,
    ).first<{ id: string; created_at: number }>();
    const now = Date.now(),
      id = old?.id ?? crypto.randomUUID(),
      revision = current.revision + 1;
    const value = BirthProfileV1.parse({
      kind: 'birth.profile.v1',
      id,
      revision,
      birth: input.birth,
      resolved: resolution.time,
      createdAt: iso(old?.created_at ?? now),
      updatedAt: iso(now),
    });
    const body = await this.base.crypt.seal(
      {
        ownerId: session.subjectId,
        table: 'birth_profiles',
        column: 'body_enc',
        recordId: id,
        aadRevision: revision,
      },
      value,
      account.key_version,
    );
    try {
      await this.base.atomic(session, [
        this.guard(session, input.expectedRevision, false),
        assertion(
          this.base.db,
          'EXISTS(SELECT 1 FROM accounts WHERE id=? AND key_version=? AND recovery_ack_at IS NOT NULL)',
          session.subjectId,
          account.key_version,
        ),
        q(
          this.base.db,
          `INSERT INTO birth_profiles(owner_id,id,revision,body_enc,key_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision,body_enc=excluded.body_enc,key_version=excluded.key_version,updated_at=excluded.updated_at,deleted_at=NULL`,
          session.subjectId,
          id,
          revision,
          body,
          account.key_version,
          old?.created_at ?? now,
          now,
        ),
        mutation.insert(`${id}:${revision}`),
      ]);
    } catch (error) {
      await this.base.checked(session);
      const replay = await this.base.mutation(session, key, 'birth-profile.write', input),
        latest = await this.read(session);
      if (
        replay.existing &&
        latest.profile &&
        replay.existing === `${latest.profile.id}:${latest.revision}`
      )
        return latest;
      if (latest.revision !== input.expectedRevision)
        throw new RecordError(409, 'CONFLICT', latest.revision || null);
      if ((await this.base.account(session)).storage_bytes + body.length + 2048 > 20971520)
        throw new RecordError(409, 'STORAGE_LIMIT_EXCEEDED');
      throw error;
    }
    return this.read(session);
  }
}
