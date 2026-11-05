import { ASTROLOGY_LIMITS } from '../../contracts/astrology-policy.ts';
import type { Session } from '../identity/types.ts';
import { type RecordBase, RecordError } from '../readings/base.ts';
import { assertion } from '../identity/checkpoint.ts';
import { statement as q, DB_NOW } from '../db/core.ts';

/** HMAC only, bounded to two UTC days; independent of AI permission and reading allowance. */
export class AstrologyAdmission {
  constructor(readonly base: RecordBase) {}
  async admit(session: Session, semanticInput: unknown) {
    const account = await this.base.account(session);
    if (!account.recovery_ack_at) throw new RecordError(403, 'FORBIDDEN');
    const hash = await this.base.crypt.hashVersion(
      session.subjectId,
      'astrology-calculation.v1',
      semanticInput,
      account.key_version,
    );
    const exists =
      "EXISTS(SELECT 1 FROM astrology_admissions WHERE owner_id=? AND quota_day=strftime('%Y-%m-%d','now') AND input_hmac=?)";
    try {
      await this.base.db.batch([
        this.base.identity.sessions.guard(session),
        assertion(
          this.base.db,
          'EXISTS(SELECT 1 FROM accounts WHERE id=? AND key_version=? AND recovery_ack_at IS NOT NULL)',
          session.subjectId,
          account.key_version,
        ),
        q(
          this.base.db,
          `INSERT OR IGNORE INTO astrology_admissions(owner_id,quota_day,input_hmac,key_version,created_at,expires_at) SELECT ?,strftime('%Y-%m-%d','now'),?,?,${DB_NOW},(unixepoch('now','start of day','+2 days')*1000) WHERE (SELECT count(*) FROM astrology_admissions WHERE owner_id=? AND quota_day=strftime('%Y-%m-%d','now'))<?`,
          session.subjectId,
          hash,
          account.key_version,
          session.subjectId,
          ASTROLOGY_LIMITS.calculationsPerDay,
        ),
        assertion(this.base.db, exists, session.subjectId, hash),
        assertion(
          this.base.db,
          'EXISTS(SELECT 1 FROM accounts WHERE id=? AND storage_bytes<=20971520)',
          session.subjectId,
        ),
      ]);
    } catch (error) {
      await this.base.checked(session);
      if ((await this.base.account(session)).storage_bytes + 1024 > 20971520)
        throw new RecordError(409, 'STORAGE_LIMIT_EXCEEDED');
      const count = await q(
        this.base.db,
        "SELECT count(*) n FROM astrology_admissions WHERE owner_id=? AND quota_day=strftime('%Y-%m-%d','now')",
        session.subjectId,
      ).first<number>('n');
      if (
        count! >= ASTROLOGY_LIMITS.calculationsPerDay &&
        !(await q(this.base.db, `SELECT 1 WHERE ${exists}`, session.subjectId, hash).first())
      )
        throw new RecordError(429, 'QUOTA_EXCEEDED');
      throw error;
    }
  }
}
