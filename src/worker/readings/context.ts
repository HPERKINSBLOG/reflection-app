import { editionContextText } from '../../domain/tarot/continuity.ts';
import { z } from 'zod';
import {
  apiSchemas,
  Grant,
  Id,
  SelectedFragment,
  type StartRequest,
} from '../../contracts/index.ts';
import {
  assertContextBounds,
  contextExcerpt,
  contextAcknowledgementInput,
} from '../../contracts/context-policy.ts';
import { statement as q, DB_NOW } from '../db/core.ts';
import { assertion } from '../identity/checkpoint.ts';
import type { Session } from '../identity/types.ts';
import { RecordError, availableSession, type RecordBase } from './base.ts';
import { ReadingRecords } from './records.ts';
import { Reflections } from './reflections.ts';
import { Revisits } from './revisits.ts';
import { contextFence } from './context-lifecycle.ts';

export type GrantPage = z.infer<typeof apiSchemas.GrantPage>;
export type ContextPreviewWrite = z.infer<typeof apiSchemas.ContextPreviewWrite>;
export type ContextPreview = z.infer<typeof apiSchemas.ContextPreview>;
export interface GrantRow {
  id: string;
  revision: number;
  state: string;
  edition_id: string | null;
  reflection_id: string | null;
  reflection_revision: number | null;
  revisit_id: string | null;
  revisit_revision: number | null;
  created_at: number;
}
export function decodeGrant(row: GrantRow): z.infer<typeof Grant> {
  return Grant.parse({
    id: row.id,
    revision: row.revision,
    state: row.state,
    source: row.edition_id
      ? { kind: 'edition', editionId: row.edition_id }
      : row.reflection_id
        ? {
            kind: 'reflection_revision',
            reflectionId: row.reflection_id,
            revision: row.reflection_revision,
          }
        : { kind: 'revisit_revision', revisitId: row.revisit_id, revision: row.revisit_revision },
  });
}
const pointSchema = z.strictObject({ at: z.number().int(), id: Id });

/** Eligibility and previews are owned operations, independent of general AI consent. */
export class ContextRecords {
  constructor(readonly base: RecordBase) {}
  private sourceGuard(session: Session, source: z.infer<typeof Grant>['source']) {
    if (source.kind === 'edition')
      return assertion(
        this.base.db,
        `EXISTS(SELECT 1 FROM reading_editions e JOIN reading_sessions s ON s.owner_id=e.owner_id AND s.id=e.session_id LEFT JOIN content_editions c ON c.hash=e.content_hash WHERE e.owner_id=? AND e.id=? AND e.body_enc IS NOT NULL AND e.status IN('accepted','imported') AND ${availableSession} AND (e.mode='legacy' OR (c.state IN('approved','superseded') AND c.rights_status='cleared')))`,
        session.subjectId,
        source.editionId,
      );
    if (source.kind === 'reflection_revision')
      return assertion(
        this.base.db,
        `EXISTS(SELECT 1 FROM reflections f JOIN reflection_revisions v ON v.owner_id=f.owner_id AND v.reflection_id=f.id AND v.revision=f.current_revision JOIN reading_sessions s ON s.owner_id=f.owner_id AND s.id=f.session_id WHERE f.owner_id=? AND f.id=? AND f.current_revision=? AND f.deleted_at IS NULL AND v.erased_at IS NULL AND v.body_enc IS NOT NULL AND ${availableSession})`,
        session.subjectId,
        source.reflectionId,
        source.revision,
      );
    return assertion(
      this.base.db,
      `EXISTS(SELECT 1 FROM revisits n JOIN reading_sessions s ON s.owner_id=n.owner_id AND s.id=n.session_id WHERE n.owner_id=? AND n.id=? AND n.current_revision=? AND n.deleted_at IS NULL AND n.note_enc IS NOT NULL AND ${availableSession})`,
      session.subjectId,
      source.revisitId,
      source.revision,
    );
  }
  /** Reusable atomic admission/dispatch guards. A preview read is never authorization to send. */
  guards(
    session: Session,
    fragments: readonly z.infer<typeof SelectedFragment>[],
    parentEditionId: string | null = null,
  ): D1PreparedStatement[] {
    return [
      ...(parentEditionId
        ? [this.sourceGuard(session, { kind: 'edition', editionId: parentEditionId })]
        : []),
      ...fragments.flatMap((f) => [
        assertion(
          this.base.db,
          "EXISTS(SELECT 1 FROM context_grants WHERE owner_id=? AND id=? AND revision=? AND state='allowed')",
          session.subjectId,
          f.grantId,
          f.grantRevision,
        ),
        this.sourceGuard(
          session,
          f.sourceKind === 'edition'
            ? { kind: 'edition', editionId: f.sourceId }
            : f.sourceKind === 'reflection_revision'
              ? {
                  kind: 'reflection_revision',
                  reflectionId: f.sourceId,
                  revision: f.sourceRevision,
                }
              : { kind: 'revisit_revision', revisitId: f.sourceId, revision: f.sourceRevision },
        ),
      ]),
    ];
  }
  private async row(session: Session, id: string) {
    const row = await q(
      this.base.db,
      'SELECT * FROM context_grants WHERE owner_id=? AND id=?',
      session.subjectId,
      id,
    ).first<GrantRow>();
    if (!row) throw new RecordError(404, 'NOT_FOUND');
    return row;
  }
  private async source(session: Session, source: z.infer<typeof Grant>['source']) {
    if (source.kind === 'edition') {
      const value = await new ReadingRecords(this.base).reading(session, source.editionId);
      if (value.kind === 'reading.unavailable.v1')
        throw new RecordError(410, 'CONTENT_UNAVAILABLE');
      const text = editionContextText(value);
      return {
        text,
        sourceId: value.editionId,
        revision: value.editionNumber,
        sessionId: value.sessionId,
        authorship:
          value.kind === 'legacy.imported.v1'
            ? ('legacy_unknown' as const)
            : ('generated' as const),
      };
    }
    const table = source.kind === 'reflection_revision' ? 'reflections' : 'revisits';
    const id = source.kind === 'reflection_revision' ? source.reflectionId : source.revisitId;
    // Ownership and current revision are established before any ciphertext is opened.
    const row = await q(
      this.base.db,
      `SELECT current_revision,deleted_at FROM ${table} WHERE owner_id=? AND id=?`,
      session.subjectId,
      id,
    ).first<{ current_revision: number; deleted_at: number | null }>();
    if (!row) throw new RecordError(404, 'NOT_FOUND');
    if (row.deleted_at !== null) throw new RecordError(410, 'CONTENT_UNAVAILABLE');
    if (row.current_revision !== source.revision)
      throw new RecordError(409, 'CONFLICT', row.current_revision);
    const value =
      source.kind === 'reflection_revision'
        ? await new Reflections(this.base).read(session, id, source.revision)
        : await new Revisits(this.base).read(session, id, source.revision);
    return {
      text: 'text' in value ? value.text : value.note,
      sourceId: id,
      revision: source.revision,
      sessionId: value.sessionId,
      authorship: 'user' as const,
    };
  }
  async grant(
    session: Session,
    key: string,
    source: z.infer<typeof Grant>['source'],
  ): Promise<z.infer<typeof Grant>> {
    source = Grant.shape.source.parse(source);
    const account = await this.base.account(session),
      mutation = await this.base.mutation(session, key, 'context.grant', source);
    if (mutation.existing) {
      const result = decodeGrant(await this.row(session, mutation.existing));
      await this.base.checked(session);
      return result;
    }
    if (!account.recovery_ack_at) throw new RecordError(403, 'FORBIDDEN');
    const resolved = await this.source(session, source),
      id = crypto.randomUUID();
    try {
      await this.base.atomic(session, [
        assertion(
          this.base.db,
          'EXISTS(SELECT 1 FROM accounts WHERE id=? AND data_revision=? AND key_version=? AND recovery_ack_at IS NOT NULL)',
          session.subjectId,
          account.data_revision,
          account.key_version,
        ),
        this.base.sessionGuard(session, resolved.sessionId),
        this.sourceGuard(session, source),
        q(
          this.base.db,
          `INSERT INTO context_grants(id,owner_id,edition_id,reflection_id,reflection_revision,revisit_id,revisit_revision,state,created_at,updated_at,source_session_id) VALUES(?,?,?,?,?,?,?,'allowed',${DB_NOW},${DB_NOW},?)`,
          id,
          session.subjectId,
          source.kind === 'edition' ? source.editionId : null,
          source.kind === 'reflection_revision' ? source.reflectionId : null,
          source.kind === 'reflection_revision' ? source.revision : null,
          source.kind === 'revisit_revision' ? source.revisitId : null,
          source.kind === 'revisit_revision' ? source.revision : null,
          resolved.sessionId,
        ),
        mutation.insert(id),
      ]);
    } catch (error) {
      const retry = await this.base.mutation(session, key, 'context.grant', source);
      if (retry.existing) return decodeGrant(await this.row(session, retry.existing));
      if ((await this.base.account(session)).storage_bytes + 2048 > 20971520)
        throw new RecordError(409, 'STORAGE_LIMIT_EXCEEDED');
      throw error;
    }
    return decodeGrant(await this.row(session, id));
  }
  async list(
    session: Session,
    cursor: string | null,
    limit: number,
    editionId: string | null,
  ): Promise<GrantPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new RecordError(400, 'BAD_INPUT');
    const account = await this.base.account(session),
      scope = ['grants', session.epoch, editionId, limit];
    if (editionId) await new ReadingRecords(this.base).reading(session, editionId);
    const point = cursor ? await this.base.parseCursor(session, scope, cursor, pointSchema) : null;
    const rows = await q(
      this.base.db,
      `SELECT g.* FROM context_grants g WHERE g.owner_id=?${editionId ? ' AND (g.edition_id=? OR g.reflection_id IN(SELECT id FROM reflections WHERE owner_id=g.owner_id AND edition_id=?) OR g.revisit_id IN(SELECT id FROM revisits WHERE owner_id=g.owner_id AND edition_id=?))' : ''}${point ? ' AND (g.created_at,g.id)>(?,?)' : ''} ORDER BY g.created_at,g.id LIMIT ?`,
      session.subjectId,
      ...(editionId ? [editionId, editionId, editionId] : []),
      ...(point ? [point.at, point.id] : []),
      limit + 1,
    ).all<GrantRow>();
    const selected = rows.results.slice(0, limit),
      last = selected.at(-1);
    const nextCursor =
      rows.results.length > limit && last
        ? await this.base.cursor(session, scope, { at: last.created_at, id: last.id })
        : null;
    await this.base.checked(session, account.data_revision);
    return { items: selected.map(decodeGrant), nextCursor };
  }
  async revoke(
    session: Session,
    id: string,
    revision: number,
    key: string,
  ): Promise<z.infer<typeof Grant>> {
    await this.base.account(session);
    const row = await this.row(session, id),
      mutation = await this.base.mutation(session, key, 'context.revoke', { id, revision });
    if (mutation.existing) {
      await this.base.checked(session);
      return decodeGrant(row);
    }
    if (row.revision !== revision) throw new RecordError(409, 'CONFLICT', row.revision);
    try {
      await this.base.atomic(
        session,
        [
          assertion(
            this.base.db,
            'EXISTS(SELECT 1 FROM context_grants WHERE owner_id=? AND id=? AND revision=?)',
            session.subjectId,
            id,
            revision,
          ),
          ...contextFence(this.base, session.subjectId, { sql: 'g.id=?', args: [id] }),
          mutation.insert(id),
        ],
        true,
      );
    } catch (error) {
      const retry = await this.base.mutation(session, key, 'context.revoke', { id, revision });
      if (!retry.existing) throw error;
    }
    return decodeGrant(await this.row(session, id));
  }
  async resolve(
    session: Session,
    input: ContextPreviewWrite,
  ): Promise<{
    fragments: z.infer<typeof SelectedFragment>[];
    acknowledgementHash: string;
    dataRevision: number;
  }> {
    input = apiSchemas.ContextPreviewWrite.parse(input);
    const account = await this.base.account(session);
    if (account.permission_revision !== input.permissionRevision)
      throw new RecordError(409, 'CONFLICT');
    if (input.parentEditionId)
      await new ReadingRecords(this.base).reading(session, input.parentEditionId);
    const fragments: z.infer<typeof SelectedFragment>[] = [];
    for (const selection of input.items) {
      const grant = decodeGrant(await this.row(session, selection.grantId));
      if (grant.state !== 'allowed' || grant.revision !== selection.grantRevision)
        throw new RecordError(409, 'CONFLICT', grant.revision);
      const source = await this.source(session, grant.source);
      let text: string;
      try {
        text = contextExcerpt(source.text, selection.start, selection.end);
      } catch {
        throw new RecordError(422, 'BAD_INPUT');
      }
      const textHash = await this.base.crypt.hash(session.subjectId, 'context-excerpt', [
        grant.source,
        selection.start,
        selection.end,
        text,
      ]);
      fragments.push({
        ordinal: fragments.length,
        grantId: grant.id,
        grantRevision: grant.revision,
        sourceKind: grant.source.kind,
        sourceId: source.sourceId,
        sourceRevision: source.revision,
        start: selection.start,
        end: selection.end,
        text,
        textHash,
        availability: 'retained',
        authorship: source.authorship,
      });
    }
    try {
      assertContextBounds(fragments);
    } catch {
      throw new RecordError(422, 'BAD_INPUT');
    }
    const acknowledgementHash = await this.base.crypt.hash(
      session.subjectId,
      'context-acknowledgement',
      contextAcknowledgementInput(session.subjectId, session.epoch, input, fragments),
    );
    await this.base.checked(
      session,
      account.data_revision,
      this.guards(session, fragments, input.parentEditionId),
    );
    return { fragments, acknowledgementHash, dataRevision: account.data_revision };
  }
  async preview(session: Session, input: ContextPreviewWrite): Promise<ContextPreview> {
    const { fragments, acknowledgementHash } = await this.resolve(session, input);
    return apiSchemas.ContextPreview.parse({
      acknowledgementHash,
      items: fragments.map((f) => ({
        selection: {
          grantId: f.grantId,
          grantRevision: f.grantRevision,
          start: f.start,
          end: f.end,
          previewHash: f.textHash,
        },
        text: f.text,
        authorship: f.authorship,
      })),
    });
  }
  /** C4 must persist these server-derived fragments and guard dataRevision in its admission batch. */
  async acknowledge(session: Session, input: z.infer<typeof StartRequest>) {
    const result = await this.resolve(session, {
      clientIntentId: input.clientIntentId,
      question: input.question,
      parentEditionId: input.parentEditionId,
      permissionRevision: input.permissionRevision,
      items: input.selection.map(({ previewHash: _, ...item }) => item),
    });
    if (
      result.acknowledgementHash !== input.contextAcknowledgement ||
      input.selection.some((s, i) => s.previewHash !== result.fragments[i]?.textHash)
    )
      throw new RecordError(409, 'CONFLICT');
    return result;
  }
}
