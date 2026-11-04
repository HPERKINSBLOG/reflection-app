import { z } from 'zod';
import { apiSchemas, Reading, Id, ImportUnit, UnavailableReading } from '../../contracts/index.ts';
import type { Session } from '../identity/types.ts';
import { assertion } from '../identity/checkpoint.ts';
import { statement as q, DB_NOW } from '../db/core.ts';
import { availableSession, iso, type RecordBase, RecordError, type SessionRow } from './base.ts';
import { pendingImportedQuestion } from './import-copies.ts';
export const Question = z.strictObject({ v: z.literal(1), text: z.string().max(10000).nullable() });
// Include the newest bounded request summaries in chronological display order.
// Each request has its own independently paginated export receipt.
export function recentRequestSummary(owner: string, family: string) {
  return `SELECT requestId,state FROM (SELECT id AS requestId,state,created_at FROM generation_requests WHERE owner_id=${owner} AND session_id=${family} ORDER BY created_at DESC,id DESC LIMIT 51) ORDER BY created_at,requestId`;
}
export class ReadingRecords {
  constructor(readonly base: RecordBase) {}
  async question(owner: string, row: SessionRow) {
    if (!row.question_enc || (await pendingImportedQuestion(this.base, owner, row.id))) return null;
    const value = await this.base.opened<z.infer<typeof Question>>(
      {
        ownerId: owner,
        table: 'reading_sessions',
        column: 'question_enc',
        recordId: row.id,
        aadRevision: 1,
      },
      row.question_enc,
      Question,
    );
    return value.text;
  }
  async session(session: Session, id: string) {
    const account = await this.base.account(session),
      row = await this.base.ownedSession(session, id);
    const [editions, reflections, requests] = await this.base.db.batch<Record<string, unknown>>([
      q(
        this.base.db,
        "SELECT id,mode FROM reading_editions WHERE owner_id=? AND session_id=? AND status!='deleted' ORDER BY edition_number",
        session.subjectId,
        id,
      ),
      q(
        this.base.db,
        'SELECT id FROM reflections WHERE owner_id=? AND session_id=? AND deleted_at IS NULL ORDER BY id',
        session.subjectId,
        id,
      ),
      q(this.base.db, recentRequestSummary('?', '?'), session.subjectId, id),
    ]);
    const result = apiSchemas.SessionRecord.parse({
      id,
      ...(editions!.results.some((e) => e.mode === 'legacy') ? { imported: true } : {}),
      revision: row.revision,
      status: row.status,
      question: await this.question(session.subjectId, row),
      editionIds: editions!.results.map((r) => r.id),
      reflectionIds: reflections!.results.map((r) => r.id),
      savedAt: row.saved_at === null ? null : iso(row.saved_at),
      retentionExpiresAt: row.retention_expires_at === null ? null : iso(row.retention_expires_at),
      createdAt: iso(row.created_at),
      requests: requests!.results,
    });
    await this.base.checkedSession(session, id, account.data_revision);
    return result;
  }
  private async importedTombstone(
    session: Session,
    id: string,
    revision: number,
    local: { session_id: string; parent_edition_id: string | null; edition_number: number },
  ) {
    const sql = `SELECT i.source_key_hmac,i.source_record_enc FROM import_identities i JOIN reading_editions e ON e.owner_id=i.owner_id AND e.id=i.edition_id
      WHERE i.owner_id=? AND i.edition_id=? AND i.erased_at IS NULL AND i.source_record_enc IS NOT NULL AND e.mode='legacy' AND e.status='withdrawn' AND e.body_enc IS NULL
      AND NOT EXISTS(SELECT 1 FROM deletion_jobs j WHERE j.owner_id=i.owner_id AND j.state!='complete')`;
    const alias = await q(
      this.base.db,
      sql + ' ORDER BY i.source_key_hmac LIMIT 1',
      session.subjectId,
      id,
    ).first<{ source_key_hmac: string; source_record_enc: string }>();
    if (!alias) return null;
    const unit = await this.base.crypt.open(
      {
        ownerId: session.subjectId,
        table: 'import_identities',
        column: 'source_record_enc',
        recordId: alias.source_key_hmac,
        aadRevision: 1,
      },
      alias.source_record_enc,
      ImportUnit,
    );
    if (
      unit.kind !== 'portable' ||
      unit.record.kind !== 'reading' ||
      unit.record.value.kind !== 'reading.unavailable.v1'
    )
      return null;
    await this.base.checkedSession(session, local.session_id, revision, [
      assertion(
        this.base.db,
        'EXISTS(' + sql + ' AND i.source_key_hmac=?)',
        session.subjectId,
        id,
        alias.source_key_hmac,
      ),
    ]);
    return UnavailableReading.parse({
      ...unit.record.value,
      editionId: id,
      sessionId: local.session_id,
      editionNumber: local.edition_number,
      parentEditionId: local.parent_edition_id,
    });
  }
  async reading(session: Session, id: string) {
    const account = await this.base.account(session);
    const row = await q(
      this.base.db,
      'SELECT e.*,c.state AS content_state FROM reading_editions e LEFT JOIN content_editions c ON c.hash=e.content_hash WHERE e.owner_id=? AND e.id=?',
      session.subjectId,
      id,
    ).first<{
      id: string;
      session_id: string;
      edition_number: number;
      parent_edition_id: string | null;
      status: string;
      mode: string;
      content_state: string | null;
      body_enc: string | null;
      key_version: number;
    }>();
    if (!row) throw new RecordError(404, 'NOT_FOUND');
    await this.base.ownedSession(session, row.session_id);
    if (row.mode === 'legacy' && row.status === 'withdrawn' && !row.body_enc) {
      const tombstone = await this.importedTombstone(session, id, account.data_revision, row);
      if (tombstone) return tombstone;
    }
    if (
      !row.body_enc ||
      !['accepted', 'imported'].includes(row.status) ||
      row.content_state === 'withdrawn'
    )
      throw new RecordError(410, 'CONTENT_UNAVAILABLE');
    const result = await this.base.opened<z.infer<typeof Reading>>(
      {
        ownerId: session.subjectId,
        table: 'reading_editions',
        column: 'body_enc',
        recordId: id,
        aadRevision: 1,
      },
      row.body_enc,
      Reading,
    );
    if (
      result.editionId !== id ||
      result.sessionId !== row.session_id ||
      result.editionNumber !== row.edition_number ||
      ('provenance' in result && result.parentEditionId !== row.parent_edition_id)
    )
      throw new RecordError(503, 'KEY_UNAVAILABLE');
    try {
      await this.base.checkedSession(session, row.session_id, account.data_revision, [
        assertion(
          this.base.db,
          "EXISTS(SELECT 1 FROM reading_editions e LEFT JOIN content_editions c ON c.hash=e.content_hash WHERE e.owner_id=? AND e.id=? AND e.status IN ('accepted','imported') AND (c.state IS NULL OR c.state!='withdrawn'))",
          session.subjectId,
          id,
        ),
      ]);
    } catch (error) {
      const current = await q(
        this.base.db,
        "SELECT 1 FROM reading_editions e LEFT JOIN content_editions c ON c.hash=e.content_hash WHERE e.owner_id=? AND e.id=? AND (e.status NOT IN ('accepted','imported') OR c.state='withdrawn')",
        session.subjectId,
        id,
      ).first();
      if (current) throw new RecordError(410, 'CONTENT_UNAVAILABLE');
      throw error;
    }
    return result;
  }
  async history(session: Session, status = 'saved', limit = 20, cursor: string | null = null) {
    if (!['open', 'saved'].includes(status) || !Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new RecordError(400, 'BAD_INPUT');
    const account = await this.base.account(session),
      scope = ['history', status, limit];
    const point = cursor
      ? await this.base.parseCursor(
          session,
          scope,
          cursor,
          z.strictObject({ at: z.number().int(), id: Id }),
        )
      : null;
    const rows = await q(
      this.base.db,
      `SELECT s.*, EXISTS(SELECT 1 FROM reading_editions e WHERE e.owner_id=s.owner_id AND e.session_id=s.id AND e.mode='legacy') AS imported, (SELECT id FROM reading_editions WHERE owner_id=s.owner_id AND session_id=s.id AND status!='deleted' ORDER BY edition_number DESC LIMIT 1) AS edition_id, (SELECT id FROM generation_requests WHERE owner_id=s.owner_id AND session_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1) AS request_id FROM reading_sessions s WHERE s.owner_id=? AND s.status=? AND ${availableSession}${point ? ' AND (s.created_at<? OR (s.created_at=? AND s.id<?))' : ''} ORDER BY s.created_at DESC,s.id DESC LIMIT ?`,
      session.subjectId,
      status,
      ...(point ? [point.at, point.at, point.id] : []),
      limit + 1,
    ).all<
      SessionRow & { edition_id: string | null; request_id: string | null; imported: number }
    >();
    const items = [];
    for (const row of rows.results.slice(0, limit)) {
      const question = await this.question(session.subjectId, row);
      let preview = '';
      for (const char of question ?? '') {
        if (preview.length + char.length > 500) break;
        preview += char;
      }
      items.push({
        id: row.id,
        revision: row.revision,
        questionPreview: question === null ? null : preview,
        questionTruncated: question !== null && question.length > preview.length,
        createdAt: iso(row.created_at),
        savedAt: row.saved_at === null ? null : iso(row.saved_at),
        latestEditionId: row.edition_id,
        requestId: row.request_id,
        imported: !!row.imported,
      });
    }
    const last = rows.results[limit - 1];
    const nextCursor =
      rows.results.length > limit && last
        ? await this.base.cursor(session, scope, { at: last.created_at, id: last.id })
        : null;
    const ids = items.map((item) => item.id);
    await this.base.checked(
      session,
      account.data_revision,
      ids.length
        ? [
            assertion(
              this.base.db,
              `(SELECT count(*) FROM reading_sessions s WHERE s.owner_id=? AND s.id IN (${ids.map(() => '?').join(',')}) AND ${availableSession})=?`,
              session.subjectId,
              ...ids,
              ids.length,
            ),
          ]
        : [],
    );
    return apiSchemas.HistoryPage.parse({ items, nextCursor });
  }
  async save(session: Session, id: string, revision: number, key: string, saved: boolean) {
    const row = await this.base.ownedSession(session, id),
      account = await this.base.account(session);
    if (!account.recovery_ack_at) throw new RecordError(403, 'FORBIDDEN');
    const mutation = await this.base.mutation(session, key, 'reading.save', {
      id,
      revision,
      saved,
    });
    if (mutation.existing) return this.session(session, id);
    if (row.revision !== revision) throw new RecordError(409, 'CONFLICT', row.revision);
    const dependents = async () => {
      if (
        !saved &&
        (await q(
          this.base.db,
          'SELECT 1 FROM revisits WHERE owner_id=? AND session_id=? AND deleted_at IS NULL LIMIT 1',
          session.subjectId,
          id,
        ).first())
      )
        throw new RecordError(409, 'DEPENDENTS_EXIST');
    };
    await dependents();
    try {
      await this.base.atomic(
        session,
        [
          this.base.sessionGuard(session, id, revision),
          ...(!saved
            ? [
                assertion(
                  this.base.db,
                  'NOT EXISTS(SELECT 1 FROM revisits WHERE owner_id=? AND session_id=? AND deleted_at IS NULL)',
                  session.subjectId,
                  id,
                ),
              ]
            : []),
          assertion(
            this.base.db,
            'EXISTS(SELECT 1 FROM accounts WHERE id=? AND recovery_ack_at IS NOT NULL)',
            session.subjectId,
          ),
          q(
            this.base.db,
            `UPDATE reading_sessions SET status=?,saved_at=${saved ? DB_NOW : 'NULL'},retention_expires_at=${saved ? 'NULL' : `${DB_NOW}+86400000`},revision=revision+1 WHERE owner_id=? AND id=?`,
            saved ? 'saved' : 'open',
            session.subjectId,
            id,
          ),
          mutation.insert(id),
        ],
        true,
      );
    } catch (error) {
      await this.base.checked(session);
      await this.base.ownedSession(session, id);
      await dependents();
      throw error;
    }
    return this.session(session, id);
  }
  async permission(session: Session, allowed: boolean, revision: number, key: string) {
    const account = await this.base.account(session),
      mutation = await this.base.mutation(session, key, 'permission', { allowed, revision });
    if (mutation.existing) return (await this.base.identity.sessions.view(session)).permission;
    if (account.permission_revision !== revision)
      throw new RecordError(409, 'CONFLICT', account.permission_revision);
    await this.base.atomic(
      session,
      [
        assertion(
          this.base.db,
          'EXISTS(SELECT 1 FROM accounts WHERE id=? AND permission_revision=?)',
          session.subjectId,
          revision,
        ),
        q(
          this.base.db,
          `INSERT INTO permission_revisions VALUES (?,?,?,'egress.v1',${DB_NOW})`,
          session.subjectId,
          revision + 1,
          Number(allowed),
        ),
        q(
          this.base.db,
          'UPDATE accounts SET permission_revision=? WHERE id=?',
          revision + 1,
          session.subjectId,
        ),
        ...(!allowed ? this.base.stopStatements(session.subjectId) : []),
        mutation.insert(String(revision + 1)),
      ],
      !allowed,
    );
    return apiSchemas.Permission.parse({
      revision: revision + 1,
      modelAllowed: allowed,
      policyVersion: 'egress.v1',
    });
  }
}
