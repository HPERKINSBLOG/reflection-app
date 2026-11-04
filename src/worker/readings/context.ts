import { z } from 'zod';
import {
  apiSchemas,
  Grant,
  Id,
  type SelectedFragment,
  StartRequest,
} from '../../contracts/index.ts';
import {
  assertContextBounds,
  contextAcknowledgementInput,
  contextExcerpt,
} from '../../contracts/context-policy.ts';
import { editionContextPassages } from '../../contracts/context-reading.ts';
import { DB_NOW, statement as q } from '../db/core.ts';
import { eligibleGrantSource } from '../db/publication-guard.ts';
import { assertion } from '../identity/checkpoint.ts';
import type { Session } from '../identity/types.ts';
import { RecordBase, RecordError } from './base.ts';
import { grantFromRow, revokeGrants, type GrantRow } from './context-grant.ts';
import { ReadingRecords } from './records.ts';
import { Reflections } from './reflections.ts';
import { Revisits } from './revisits.ts';

type GrantValue = z.infer<typeof Grant>;
type Source = GrantValue['source'];
type Fragment = z.infer<typeof SelectedFragment>;
type PreviewWrite = z.infer<typeof apiSchemas.ContextPreviewWrite>;
type Range = PreviewWrite['items'][number];
const position = z.strictObject({ at: z.number().int(), id: Id, expires: z.number().int() });
const storageLimit = 20 * 1024 * 1024;

function sourceColumns(source: Source) {
  return [
    source.kind === 'edition' ? source.editionId : null,
    source.kind === 'reflection_revision' ? source.reflectionId : null,
    source.kind === 'reflection_revision' ? source.revision : null,
    source.kind === 'revisit_revision' ? source.revisitId : null,
    source.kind === 'revisit_revision' ? source.revision : null,
  ];
}

/** This is the same source predicate used for existing grants at dispatch and publication. */
function sourceQuery(owner: string, source: Source, parent = false) {
  return {
    sql: `SELECT coalesce(e.id,f.id,n.id) AS id,coalesce(f.current_revision,n.current_revision) AS revision,
            ((${eligibleGrantSource})${parent ? " AND e.status='accepted' AND e.mode!='legacy'" : ''}) AS eligible
          FROM (SELECT ? AS owner_id,? AS edition_id,? AS reflection_id,? AS reflection_revision,? AS revisit_id,? AS revisit_revision) g
          LEFT JOIN reading_editions e ON e.owner_id=g.owner_id AND e.id=g.edition_id
          LEFT JOIN reflections f ON f.owner_id=g.owner_id AND f.id=g.reflection_id
          LEFT JOIN revisits n ON n.owner_id=g.owner_id AND n.id=g.revisit_id`,
    args: [owner, ...sourceColumns(source)],
  };
}

/** Exact, authenticated grant metadata and read-only request review. */
export class ContextRecords extends RecordBase {
  private async requireSource(session: Session, source: Source, parent = false) {
    const { sql, args } = sourceQuery(session.subjectId, source, parent);
    const row = await q(this.db, sql, ...args).first<{
      id: string | null;
      revision: number | null;
      eligible: number;
    }>();
    if (!row?.id) throw new RecordError(404, 'NOT_FOUND');
    if (source.kind !== 'edition' && row.revision !== source.revision)
      throw new RecordError(409, 'CONTEXT_CHANGED', row.revision);
    if (!row.eligible) throw new RecordError(410, 'CONTENT_UNAVAILABLE');
  }

  private async grantRow(session: Session, id: string) {
    const [, result] = await this.db.batch<GrantRow & { eligible: number }>([
      this.identity.sessions.guard(session, false, false),
      q(
        this.db,
        `SELECT g.*,(${eligibleGrantSource}) AS eligible FROM context_grants g WHERE g.owner_id=? AND g.id=?`,
        session.subjectId,
        id,
      ),
    ]);
    const row = result!.results[0];
    if (!row) throw new RecordError(404, 'NOT_FOUND');
    return row;
  }

  async grant(session: Session, key: string, source: Source): Promise<GrantValue> {
    const parsed = Grant.shape.source.safeParse(source);
    if (!parsed.success) throw new RecordError(400, 'BAD_INPUT');
    source = parsed.data;
    const account = await this.account(session);
    if (!account.recovery_ack_at) throw new RecordError(403, 'FORBIDDEN');
    const mutation = await this.mutation(session, key, 'context.grant', source);
    if (mutation.existing) return grantFromRow(await this.grantRow(session, mutation.existing));
    await this.requireSource(session, source);
    const id = crypto.randomUUID();
    try {
      await this.atomic(session, [
        assertion(
          this.db,
          'EXISTS(SELECT 1 FROM accounts WHERE id=? AND recovery_ack_at IS NOT NULL)',
          session.subjectId,
        ),
        q(
          this.db,
          `INSERT INTO context_grants(id,owner_id,edition_id,reflection_id,reflection_revision,revisit_id,revisit_revision,state,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,'allowed',${DB_NOW},${DB_NOW})`,
          id,
          session.subjectId,
          ...sourceColumns(source),
        ),
        assertion(
          this.db,
          `EXISTS(SELECT 1 FROM context_grants g WHERE g.owner_id=? AND g.id=? AND (${eligibleGrantSource}))`,
          session.subjectId,
          id,
        ),
        mutation.insert(id),
      ]);
    } catch (error) {
      const retry = await this.mutation(session, key, 'context.grant', source);
      if (retry.existing) return grantFromRow(await this.grantRow(session, retry.existing));
      await this.checked(session);
      await this.requireSource(session, source);
      if ((await this.account(session)).storage_bytes + 2048 > storageLimit)
        throw new RecordError(409, 'STORAGE_LIMIT_EXCEEDED');
      throw error;
    }
    return grantFromRow(await this.grantRow(session, id));
  }

  async list(
    session: Session,
    cursor: string | null,
    limit: number,
    editionId: string | null,
  ): Promise<z.infer<typeof apiSchemas.GrantPage>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new RecordError(400, 'BAD_INPUT');
    const account = await this.account(session);
    const owner = session.subjectId,
      scope = ['context-grants', session.epoch, editionId, 'desc'];
    const point = cursor === null ? null : await this.parseCursor(session, scope, cursor, position);
    if (point && point.expires <= Date.now()) throw new RecordError(400, 'BAD_INPUT');
    if (
      editionId !== null &&
      !(await q(
        this.db,
        'SELECT 1 FROM reading_editions WHERE owner_id=? AND id=?',
        owner,
        editionId,
      ).first())
    )
      throw new RecordError(404, 'NOT_FOUND');
    const rows = await q(
      this.db,
      `SELECT g.* FROM context_grants g WHERE g.owner_id=?
      ${
        editionId === null
          ? ''
          : `AND (g.edition_id=? OR EXISTS(SELECT 1 FROM reflections f WHERE f.owner_id=g.owner_id AND f.id=g.reflection_id AND f.edition_id=?)
        OR EXISTS(SELECT 1 FROM revisits n WHERE n.owner_id=g.owner_id AND n.id=g.revisit_id AND n.edition_id=?))`
      }
      ${point ? 'AND (g.created_at<? OR (g.created_at=? AND g.id<?))' : ''}
      ORDER BY g.created_at DESC,g.id DESC LIMIT ?`,
      owner,
      ...(editionId === null ? [] : [editionId, editionId, editionId]),
      ...(point ? [point.at, point.at, point.id] : []),
      limit + 1,
    ).all<GrantRow & { created_at: number }>();
    const visible = rows.results.slice(0, limit),
      last = visible.at(-1);
    const nextCursor =
      rows.results.length > limit && last
        ? await this.cursor(session, scope, {
            at: last.created_at,
            id: last.id,
            expires: point?.expires ?? Date.now() + 86400000,
          })
        : null;
    await this.checked(session, account.data_revision);
    return { items: visible.map(grantFromRow), nextCursor };
  }

  async revoke(session: Session, id: string, revision: number, key: string): Promise<GrantValue> {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new RecordError(400, 'BAD_INPUT');
    const row = await this.grantRow(session, id);
    const payload = { id, revision };
    const mutation = await this.mutation(session, key, 'context.revoke', payload);
    if (mutation.existing) return grantFromRow(await this.grantRow(session, id));
    if (row.state !== 'allowed' || row.revision !== revision)
      throw new RecordError(409, 'CONFLICT', row.revision);
    try {
      await this.atomic(
        session,
        [
          assertion(
            this.db,
            "EXISTS(SELECT 1 FROM context_grants WHERE owner_id=? AND id=? AND revision=? AND state='allowed')",
            session.subjectId,
            id,
            revision,
          ),
          ...revokeGrants(this, session.subjectId, 'id', id),
          mutation.insert(id),
        ],
        true,
      );
    } catch (error) {
      const retry = await this.mutation(session, key, 'context.revoke', payload);
      const current = await this.grantRow(session, id);
      if (retry.existing) return grantFromRow(current);
      if (current.revision !== revision) throw new RecordError(409, 'CONFLICT', current.revision);
      throw error;
    }
    return grantFromRow(await this.grantRow(session, id));
  }

  private async excerpt(session: Session, source: Source, item: Range) {
    let text: string,
      startOffset = 0,
      authorship: Fragment['authorship'] = 'user';
    let sourceId: string, sourceRevision: number;
    if (source.kind === 'edition') {
      const reading = await new ReadingRecords(this).reading(session, source.editionId);
      const passage = editionContextPassages(reading).find(
        (p) => p.start <= item.start && p.end >= item.end,
      );
      if (!passage) throw new RecordError(400, 'BAD_INPUT');
      ({ text, authorship, start: startOffset } = passage);
      sourceId = source.editionId;
      sourceRevision = reading.editionNumber;
    } else if (source.kind === 'reflection_revision') {
      const reflection = await new Reflections(this).read(
        session,
        source.reflectionId,
        source.revision,
      );
      text = reflection.text;
      sourceId = reflection.id;
      sourceRevision = reflection.revision;
    } else {
      const note = await new Revisits(this).read(session, source.revisitId, source.revision);
      text = note.note;
      sourceId = note.id;
      sourceRevision = note.revision;
    }
    try {
      text = contextExcerpt(text, item.start - startOffset, item.end - startOffset);
    } catch {
      throw new RecordError(400, 'BAD_INPUT');
    }
    return { sourceKind: source.kind, sourceId, sourceRevision, authorship, text };
  }

  private async resolveRequest(session: Session, input: PreviewWrite, atStart: boolean) {
    const account = await this.account(session);
    await this.checked(session);
    if (account.permission_revision !== input.permissionRevision)
      throw new RecordError(409, 'CONTEXT_CHANGED', account.permission_revision);
    if (atStart && !account.model_allowed) throw new RecordError(403, 'CONSENT_REQUIRED');
    if (atStart && !account.recovery_ack_at) throw new RecordError(403, 'FORBIDDEN');
    const guards = [
      assertion(
        this.db,
        `EXISTS(SELECT 1 FROM accounts a JOIN permission_revisions p ON p.owner_id=a.id AND p.revision=a.permission_revision
        WHERE a.id=? AND a.permission_revision=?${atStart ? ' AND p.model_allowed=1 AND a.recovery_ack_at IS NOT NULL AND a.write_fence IS NULL' : ''})`,
        session.subjectId,
        input.permissionRevision,
      ),
    ];
    if (input.parentEditionId !== null) {
      const parent = { kind: 'edition' as const, editionId: input.parentEditionId };
      await this.requireSource(session, parent, true);
      const query = sourceQuery(session.subjectId, parent, true);
      guards.push(
        assertion(this.db, `EXISTS(SELECT 1 FROM (${query.sql}) WHERE eligible=1)`, ...query.args),
      );
    }
    // Authorize every submitted ID before decrypting any of the selected records.
    const grants: GrantValue[] = [];
    for (const item of input.items) {
      const row = await this.grantRow(session, item.grantId);
      if (!row.eligible || row.state !== 'allowed' || row.revision !== item.grantRevision)
        throw new RecordError(409, 'CONTEXT_CHANGED', row.revision);
      grants.push(grantFromRow(row));
      guards.push(
        assertion(
          this.db,
          `EXISTS(SELECT 1 FROM context_grants g WHERE g.owner_id=? AND g.id=? AND g.revision=? AND g.state='allowed' AND (${eligibleGrantSource}))`,
          session.subjectId,
          item.grantId,
          item.grantRevision,
        ),
      );
    }
    const fragments: Fragment[] = [];
    for (const [ordinal, item] of input.items.entries()) {
      const excerpt = await this.excerpt(session, grants[ordinal]!.source, item);
      const textHash = await this.crypt.hash(session.subjectId, 'context-excerpt.v1', [
        item,
        excerpt,
      ]);
      fragments.push({ ordinal, ...item, ...excerpt, textHash, availability: 'retained' });
    }
    try {
      assertContextBounds(fragments);
    } catch {
      throw new RecordError(400, 'BAD_INPUT');
    }
    const acknowledgementHash = await this.crypt.hash(
      session.subjectId,
      'context-acknowledgement.v1',
      contextAcknowledgementInput(session.subjectId, session.epoch, input, fragments),
    );
    try {
      await this.checked(session, account.data_revision, guards);
    } catch (error) {
      await this.account(session);
      await this.checked(session);
      if (error instanceof Error && /CHECK constraint/.test(error.message))
        throw new RecordError(409, 'CONTEXT_CHANGED');
      throw error;
    }
    return { fragments, acknowledgementHash };
  }

  async resolve(
    session: Session,
    input: PreviewWrite,
  ): Promise<{ fragments: Fragment[]; acknowledgementHash: string }> {
    const parsed = apiSchemas.ContextPreviewWrite.safeParse(input);
    if (!parsed.success) throw new RecordError(400, 'BAD_INPUT');
    return this.resolveRequest(session, parsed.data, false);
  }

  async preview(
    session: Session,
    input: PreviewWrite,
  ): Promise<z.infer<typeof apiSchemas.ContextPreview>> {
    const { fragments, acknowledgementHash } = await this.resolve(session, input);
    return apiSchemas.ContextPreview.parse({
      acknowledgementHash,
      items: fragments.map(
        ({ grantId, grantRevision, start, end, textHash, text, authorship }) => ({
          selection: { grantId, grantRevision, start, end, previewHash: textHash },
          text,
          authorship,
        }),
      ),
    });
  }

  async confirmStart(session: Session, input: z.infer<typeof StartRequest>): Promise<Fragment[]> {
    const parsed = StartRequest.safeParse(input);
    if (!parsed.success) throw new RecordError(400, 'BAD_INPUT');
    const {
      clientIntentId,
      question,
      parentEditionId,
      permissionRevision,
      selection,
      contextAcknowledgement,
    } = parsed.data;
    const items = selection.map(({ grantId, grantRevision, start, end }) => ({
      grantId,
      grantRevision,
      start,
      end,
    }));
    const { fragments, acknowledgementHash } = await this.resolveRequest(
      session,
      { clientIntentId, question, parentEditionId, permissionRevision, items },
      true,
    );
    if (
      (contextAcknowledgement !== undefined && contextAcknowledgement !== acknowledgementHash) ||
      fragments.some((fragment, i) => fragment.textHash !== selection[i]!.previewHash)
    )
      throw new RecordError(409, 'CONTEXT_CHANGED');
    return fragments;
  }
}
