import { z } from 'zod';
import {
  apiSchemas,
  Reading,
  Reflection,
  Id,
  AnyWriterReceipt,
  SelectedFragment,
  ImportUnit,
  Hash,
  type ImportRecordIdentity,
  PortableRecord,
  PortableRecordV2,
  BirthProfileV1,
  type ExportPageV2,
} from '../../contracts/index.ts';
import { statement as q, DB_NOW } from '../db/core.ts';
import { assertion } from '../identity/checkpoint.ts';
import type { Session } from '../identity/types.ts';
import { iso, availableSession, type RecordBase, RecordError } from './base.ts';
import { decodeRevisit } from './revisit-codec.ts';
import { Reflections } from './reflections.ts';
import { Question, ReadingRecords, recentRequestSummary } from './records.ts';
import { grantFromRow, type GrantRow } from './context-grant.ts';

const Point = z.strictObject({
  kind: z.enum([
    'session',
    'reading',
    'reflection',
    'generation_receipt',
    'permission',
    'revisit',
    'grant',
    'import_alias',
    'birth_profile',
  ]),
  id: Id.or(Hash),
  revision: z.number().int().positive(),
});
type Row = z.infer<typeof Point> & {
  session_id: string | null;
  value_enc: string | null;
  key_version: number;
  metadata: string;
};
type Ticket = { id: string; snapshot_revision: number; created_at: number; expires_at: number };
const utf8 = new TextEncoder();
const noPendingErasure =
  "NOT EXISTS(SELECT 1 FROM deletion_jobs j WHERE j.owner_id=t.owner_id AND j.state!='complete')";

/** Export only persisted families this local slice can create; unsupported families fail closed. */
export class ReadingExports {
  constructor(readonly base: RecordBase) {}
  async create(session: Session, key: string) {
    if (session.authenticatedAt <= Date.now() - 300_000)
      throw new RecordError(401, 'UNAUTHENTICATED');
    const mutation = await this.base.mutation(session, key, 'export.create', {});
    const id = mutation.existing ?? crypto.randomUUID();
    if (!mutation.existing) {
      await this.base.identity.rate('export', session.subjectId, 2, 3_600_000);
      await this.base.db.batch([
        this.base.identity.sessions.guard(session, true),
        q(
          this.base.db,
          // Time alone can remove an unsaved record without advancing data_revision. Bind every
          // page to the earliest retention boundary in the entire snapshot, including later pages.
          `INSERT INTO export_tickets SELECT ?,id,data_revision,${DB_NOW},min(${DB_NOW}+3600000,
            coalesce((SELECT min(retention_expires_at) FROM reading_sessions WHERE owner_id=accounts.id
              AND status='open' AND retention_expires_at>${DB_NOW}),${DB_NOW}+3600000)) FROM accounts WHERE id=?`,
          id,
          session.subjectId,
        ),
        mutation.insert(id),
      ]);
    }
    const ticket = await this.ticket(session, id);
    return apiSchemas.ExportTicket.parse({
      id,
      snapshotRevision: ticket.snapshot_revision,
      expiresAt: iso(ticket.expires_at),
    });
  }
  private async ticket(session: Session, id: string): Promise<Ticket> {
    const row = await q(
      this.base.db,
      `SELECT t.*,a.data_revision,(${DB_NOW}<t.expires_at) AS valid, ${noPendingErasure} AS exportable FROM export_tickets t JOIN accounts a ON a.id=t.owner_id WHERE t.owner_id=? AND t.id=?`,
      session.subjectId,
      id,
    ).first<Ticket & { data_revision: number; valid: number; exportable: number }>();
    if (!row) throw new RecordError(404, 'NOT_FOUND');
    if (!row.exportable) throw new RecordError(409, 'EXPORT_CHANGED');
    if (!row.valid) {
      if (row.expires_at < row.created_at + 3_600_000) throw new RecordError(409, 'EXPORT_CHANGED');
      throw new RecordError(410, 'EXPIRED');
    }
    if (row.snapshot_revision !== row.data_revision) throw new RecordError(409, 'EXPORT_CHANGED');
    return row;
  }
  private guard(session: Session, ticket: Ticket) {
    return assertion(
      this.base.db,
      `EXISTS(SELECT 1 FROM export_tickets t JOIN accounts a ON a.id=t.owner_id WHERE t.owner_id=? AND t.id=? AND a.data_revision=t.snapshot_revision AND t.snapshot_revision=? AND t.expires_at>${DB_NOW} AND ${noPendingErasure})`,
      session.subjectId,
      ticket.id,
      ticket.snapshot_revision,
    );
  }
  private async guardedBatch<T>(
    session: Session,
    ticket: Ticket,
    statements: D1PreparedStatement[],
  ) {
    try {
      return await this.base.db.batch<T>(statements);
    } catch (error) {
      // Classify a snapshot race using current authoritative state, without releasing any page.
      if (!(error instanceof Error) || !/CHECK constraint/.test(error.message)) throw error;
      try {
        await this.base.checked(session);
      } catch {
        throw new RecordError(401, 'UNAUTHENTICATED');
      }
      await this.ticket(session, ticket.id);
      throw new RecordError(409, 'EXPORT_CHANGED');
    }
  }
  private nativeRows(
    session: Session,
    point: z.infer<typeof Point> | null,
    identity?: z.infer<typeof ImportRecordIdentity>,
  ) {
    const owner = session.subjectId;
    const filterArgs: (string | number)[] = identity
      ? [
          identity.kind,
          identity.recordId,
          ...(identity.kind === 'reading' ? [] : [identity.recordRevision]),
        ]
      : point
        ? [point.kind, point.id, point.revision]
        : [];
    const position = identity
      ? 'kind=? AND id=?' + (identity.kind === 'reading' ? '' : ' AND revision=?')
      : point
        ? '(kind,id,revision)>(?,?,?)'
        : '1';
    const filter = identity
      ? position
      : position +
        ` AND NOT EXISTS(SELECT 1 FROM import_identities i WHERE i.owner_id=? AND i.erased_at IS NULL AND
      CASE n.kind WHEN 'session' THEN i.entity_kind='session' AND i.session_id=n.id
        WHEN 'reading' THEN i.edition_id=n.id
        WHEN 'reflection' THEN i.reflection_id=n.id AND i.reflection_revision=n.revision
        WHEN 'revisit' THEN i.revisit_id=n.id AND coalesce(i.revisit_revision,1)=n.revision ELSE 0 END)`;
    const extra = [...filterArgs, ...(identity ? [] : [owner])];
    // D1 bounds compound SELECT terms; keep authored families in a separately bounded group.
    const sql = `WITH authored AS MATERIALIZED (SELECT * FROM (
      SELECT 'reflection' AS kind,f.id,r.revision,f.session_id,r.body_enc AS value_enc,r.key_version,json_object('editionId',f.edition_id) AS metadata
      FROM reflection_revisions r JOIN reflections f ON f.id=r.reflection_id AND f.owner_id=r.owner_id JOIN reading_sessions s ON s.id=f.session_id AND s.owner_id=f.owner_id WHERE f.owner_id=? AND r.erased_at IS NULL AND ${availableSession}

      UNION ALL
      SELECT 'revisit',n.id,n.current_revision,n.session_id,n.note_enc,n.key_version,
        json_object('editionId',n.edition_id,'createdAt',n.created_at,'updatedAt',n.updated_at,'historical',0)
      FROM revisits n JOIN reading_sessions s ON s.owner_id=n.owner_id AND s.id=n.session_id WHERE n.owner_id=? AND n.deleted_at IS NULL AND n.note_enc IS NOT NULL AND ${availableSession}
      UNION ALL
      SELECT 'revisit',n.id,r.revision,n.session_id,r.body_enc,r.key_version,
        json_object('editionId',n.edition_id,'createdAt',n.created_at,'updatedAt',r.created_at,'historical',1)
      FROM revisit_revisions r JOIN revisits n ON n.owner_id=r.owner_id AND n.id=r.revisit_id JOIN reading_sessions s ON s.owner_id=n.owner_id AND s.id=n.session_id WHERE n.owner_id=? AND n.deleted_at IS NULL AND r.erased_at IS NULL AND r.body_enc IS NOT NULL AND ${availableSession}

      UNION ALL
      SELECT 'grant',g.id,g.revision,NULL,NULL,1,json_object('id',g.id,'revision',g.revision,'state',g.state,'edition_id',g.edition_id,
        'reflection_id',g.reflection_id,'reflection_revision',g.reflection_revision,'revisit_id',g.revisit_id,'revisit_revision',g.revisit_revision)
      FROM context_grants g WHERE g.owner_id=?
      UNION ALL
      SELECT 'birth_profile',p.id,p.revision,NULL,p.body_enc,p.key_version,'{}'
      FROM birth_profiles p WHERE p.owner_id=? AND p.deleted_at IS NULL AND p.body_enc IS NOT NULL

    ) AS n WHERE ${filter} ORDER BY kind,id,revision LIMIT 101) SELECT * FROM (
      SELECT 'session' AS kind,s.id,s.revision,s.id AS session_id,s.question_enc AS value_enc,1 AS key_version,
        json_object('status',s.status,'savedAt',s.saved_at,'createdAt',s.created_at,
          'editionIds',(SELECT json_group_array(id) FROM reading_editions WHERE owner_id=s.owner_id AND session_id=s.id),
          'reflectionIds',(SELECT json_group_array(id) FROM reflections WHERE owner_id=s.owner_id AND session_id=s.id AND deleted_at IS NULL),
          'requests',(SELECT json_group_array(json_object('requestId',requestId,'state',state)) FROM (${recentRequestSummary('s.owner_id', 's.id')}))) AS metadata
      FROM reading_sessions s WHERE s.owner_id=? AND ${availableSession}
      UNION ALL
      SELECT 'reading',e.id,e.edition_number,e.session_id,e.body_enc,e.key_version,
        json_object('status',e.status,'contentState',coalesce(pc.state,c.state),'parentEditionId',e.parent_edition_id,'unavailableAt',coalesce(e.invalidated_at,pc.withdrawn_at,c.withdrawn_at,e.accepted_at))
      FROM reading_editions e JOIN reading_sessions s ON s.id=e.session_id AND s.owner_id=e.owner_id LEFT JOIN content_editions c ON c.hash=e.content_hash LEFT JOIN pattern_content_releases pc ON pc.hash=e.pattern_content_hash WHERE e.owner_id=? AND ${availableSession}
      UNION ALL
      SELECT * FROM authored
      UNION ALL
      SELECT 'generation_receipt',r.id,r.revision,r.session_id,d.transmission_enc,r.key_version,
        json_object('state',r.state,'createdAt',r.created_at,'dispatchId',d.id,'contextCount',r.context_count,'inputTokens',coalesce(cost.input_tokens,d.input_tokens),'outputTokens',coalesce(cost.output_tokens,d.output_tokens),'cachedInputTokens',coalesce(cost.cached_input_tokens,d.cached_input_tokens),'cacheWriteTokens',coalesce(cost.cache_write_tokens,d.cache_write_tokens),'reasoningTokens',coalesce(cost.reasoning_tokens,d.reasoning_tokens),'serviceTier',coalesce(cost.service_tier,d.service_tier),'costState',coalesce(cost.state,CASE WHEN d.cost_expired_at IS NOT NULL THEN 'expired' ELSE 'none' END),'actualCost',cost.actual_microusd)
      FROM generation_requests r JOIN reading_sessions s ON s.id=r.session_id AND s.owner_id=r.owner_id LEFT JOIN provider_dispatches d ON d.request_id=r.id AND d.owner_id=r.owner_id LEFT JOIN cost_reservations cost ON cost.dispatch_id=d.id AND cost.owner_id=r.owner_id WHERE r.owner_id=? AND ${availableSession}
      UNION ALL
      SELECT 'permission',p.owner_id,p.revision,NULL,NULL,1,json_object('allowed',p.model_allowed)
      FROM permission_revisions p WHERE p.owner_id=?
    ) AS n WHERE ${filter} ORDER BY kind,id,revision LIMIT 101`;
    return q(
      this.base.db,
      sql,
      ...Array<string>(5).fill(owner),
      ...extra,
      ...Array<string>(4).fill(owner),
      ...extra,
    );
  }
  async nativeRecord(
    session: Session,
    identity: z.infer<typeof ImportRecordIdentity>,
  ): Promise<z.infer<typeof PortableRecord> | null> {
    const native =
      identity.source.namespaceId === session.subjectId &&
      /^(native-v1|snapshot-[0-9]+)$/.test(identity.source.revision);
    if (!native && identity.kind !== 'session') return null;
    const account = await this.base.account(session);
    const row = await this.nativeRows(session, null, identity).first<Row>();
    if (
      !row ||
      (identity.kind === 'reading' &&
        identity.recordRevision !== (identity.source.revision === 'native-v1' ? 1 : row.revision))
    )
      return null;
    if (!native) {
      const companion = await this.exported(session, row);
      if (
        companion.identity.source.namespaceId !== identity.source.namespaceId ||
        companion.identity.source.revision !== identity.source.revision
      )
        return null;
    }
    const record = PortableRecord.parse({
      kind: row.kind,
      identity,
      originalId: row.id,
      value: await this.value(session, row),
    });
    await this.base.checked(session, account.data_revision);
    return record;
  }
  private async exported(session: Session, row: Row): Promise<z.infer<typeof PortableRecordV2>> {
    const owner = session.subjectId,
      meta = JSON.parse(row.metadata);
    if (row.kind === 'import_alias') {
      const unit = await this.base.opened<z.infer<typeof ImportUnit>>(
        {
          ownerId: owner,
          table: 'import_identities',
          column: 'source_record_enc',
          recordId: row.id,
          aadRevision: 1,
        },
        row.value_enc!,
        ImportUnit,
      );
      if (unit.kind === 'portable') return unit.record;
      let value: unknown;
      if (unit.kind === 'legacy-reading') {
        value = await new ReadingRecords(this.base).reading(session, meta.editionId);
      } else {
        value = await new Reflections(this.base).read(
          session,
          meta.reflectionId,
          meta.reflectionRevision,
        );
      }
      return PortableRecordV2.parse({
        kind: unit.identity.kind,
        identity: unit.identity,
        originalId: unit.identity.recordId,
        ...(unit.kind === 'legacy-authored' ? { importedOriginal: unit.record } : {}),
        value,
      });
    }
    const value = await this.value(session, row);
    let source = { namespaceId: owner, revision: 'native-v1' };
    // An adapter reading carries its own dataset namespace. Its generated
    // session envelope uses the same source, so exported dependencies resolve.
    if (row.kind === 'session') {
      const id = await q(
        this.base.db,
        "SELECT source_key_hmac,source_record_enc FROM import_identities WHERE owner_id=? AND session_id=? AND entity_kind='edition' AND erased_at IS NULL ORDER BY rowid LIMIT 1",
        owner,
        row.id,
      ).first<{ source_key_hmac: string; source_record_enc: string }>();
      if (id?.source_record_enc) {
        const unit = await this.base.opened<z.infer<typeof ImportUnit>>(
          {
            ownerId: owner,
            table: 'import_identities',
            column: 'source_record_enc',
            recordId: id.source_key_hmac,
            aadRevision: 1,
          },
          id.source_record_enc,
          ImportUnit,
        );
        source = unit.identity.source;
      }
    }
    return PortableRecordV2.parse({
      kind: row.kind,
      identity: {
        source,
        kind: row.kind,
        recordId: row.id,
        recordRevision: row.kind === 'reading' ? 1 : row.revision,
      },
      originalId: row.id,
      value,
    });
  }
  async page(
    session: Session,
    id: string,
    cursor: string | null,
  ): Promise<
    Omit<z.infer<typeof ExportPageV2>, 'format'> & {
      format: 'reflection-export.v1' | 'reflection-export.v2';
    }
  > {
    const ticket = await this.ticket(session, id),
      scope = ['export', id, ticket.snapshot_revision];
    const point = cursor ? await this.base.parseCursor(session, scope, cursor, Point) : null;
    const after = point ? "AND ('import_alias',i.source_key_hmac,1)>(?,?,?)" : '';
    const batch = await this.guardedBatch<Row>(session, ticket, [
      this.base.identity.sessions.guard(session, false, false),
      this.guard(session, ticket),
      this.nativeRows(session, point),
      q(
        this.base.db,
        `SELECT 'import_alias' AS kind,i.source_key_hmac AS id,1 AS revision,i.session_id,i.source_record_enc AS value_enc,i.key_version,
        json_object('editionId',i.edition_id,'reflectionId',i.reflection_id,'reflectionRevision',i.reflection_revision) AS metadata
        FROM import_identities i WHERE i.owner_id=? AND i.erased_at IS NULL AND i.source_record_enc IS NOT NULL
        ${after} ORDER BY i.source_key_hmac LIMIT 101`,
        session.subjectId,
        ...(point ? [point.kind, point.id, point.revision] : []),
      ),
    ]);
    const rows = [...batch[2]!.results, ...batch[3]!.results].sort((a, b) =>
        a.kind !== b.kind
          ? a.kind < b.kind
            ? -1
            : 1
          : a.id !== b.id
            ? a.id < b.id
              ? -1
              : 1
            : a.revision - b.revision,
      ),
      records: z.infer<typeof PortableRecordV2>[] = [];
    let length = 0,
      last: Row | undefined;
    for (const row of rows.slice(0, 100)) {
      const record = await this.exported(session, row);
      const size = utf8.encode(JSON.stringify(record)).length;
      if (length + size > 950_000) {
        if (!records.length) throw new RecordError(413, 'INPUT_TOO_LARGE');
        break;
      }
      records.push(record);
      length += size;
      last = row;
    }
    let account = null;
    if (!cursor) {
      const created = await q(
        this.base.db,
        'SELECT created_at FROM accounts WHERE id=?',
        session.subjectId,
      ).first<number>('created_at');
      const credentials = await q(
        this.base.db,
        'SELECT id,created_at,backed_up FROM credentials WHERE owner_id=? ORDER BY id LIMIT 10',
        session.subjectId,
      ).all<{ id: string; created_at: number; backed_up: number }>();
      account = {
        subjectId: session.subjectId,
        createdAt: iso(created!),
        credentials: credentials.results.map((c) => ({
          id: c.id,
          createdAt: iso(c.created_at),
          backedUp: Boolean(c.backed_up),
        })),
      };
    }
    const nextCursor =
      records.length < rows.length && last
        ? await this.base.cursor(session, scope, {
            kind: last.kind,
            id: last.id,
            revision: last.revision,
          })
        : null;
    const v2 = await q(
      this.base.db,
      "SELECT 1 FROM birth_profiles WHERE owner_id=? AND body_enc IS NOT NULL UNION ALL SELECT 1 FROM reading_editions WHERE owner_id=? AND mode IN('pattern','legacy') LIMIT 1",
      session.subjectId,
      session.subjectId,
    ).first();
    const result = apiSchemas.ExportPage.parse({
      format: v2 ? 'reflection-export.v2' : 'reflection-export.v1',
      exportId: id,
      snapshotRevision: ticket.snapshot_revision,
      records,
      nextCursor,
      exportedAt: iso(Date.now()),
      account,
    });
    // Validate again after decryption/serialization; never release a mixed or revoked snapshot.
    await this.ticket(session, id);
    const sessions = [
      ...new Set(
        rows
          .slice(0, records.length)
          .map((row) => row.session_id)
          .filter((id): id is string => id !== null),
      ),
    ];
    const patternEditions = records.flatMap((record, index) =>
      rows[index]?.kind === 'reading' &&
      record.kind === 'reading' &&
      record.value.kind === 'astrology.pattern.accepted.v1'
        ? [record.originalId]
        : [],
    );
    await this.guardedBatch(session, ticket, [
      this.base.identity.sessions.guard(session, false, false),
      this.guard(session, ticket),
      ...(patternEditions.length
        ? [
            assertion(
              this.base.db,
              "(SELECT count(*) FROM reading_editions e JOIN pattern_content_releases p ON p.hash=e.pattern_content_hash WHERE e.owner_id=? AND e.id IN (SELECT value FROM json_each(?)) AND e.status='accepted' AND e.mode='pattern' AND p.state='active' AND e.body_enc IS NOT NULL)=?",
              session.subjectId,
              JSON.stringify(patternEditions),
              patternEditions.length,
            ),
          ]
        : []),
      ...(sessions.length
        ? [
            assertion(
              this.base.db,
              `(SELECT count(*) FROM reading_sessions s WHERE s.owner_id=? AND s.id IN (SELECT value FROM json_each(?)) AND ${availableSession})=?`,
              session.subjectId,
              JSON.stringify(sessions),
              sessions.length,
            ),
          ]
        : []),
    ]);
    return result;
  }
  private async value(session: Session, row: Row): Promise<unknown> {
    const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    const owner = session.subjectId;
    if (row.kind === 'birth_profile')
      return this.base.opened(
        {
          ownerId: owner,
          table: 'birth_profiles',
          column: 'body_enc',
          recordId: row.id,
          aadRevision: row.revision,
        },
        row.value_enc!,
        BirthProfileV1,
      );
    if (row.kind === 'grant') return grantFromRow(metadata as unknown as GrantRow);
    if (row.kind === 'permission')
      return {
        revision: row.revision,
        modelAllowed: Boolean(metadata.allowed),
        policyVersion: 'egress.v1',
      };
    if (row.kind === 'session') {
      const question = row.value_enc
        ? await this.base.opened<z.infer<typeof Question>>(
            {
              ownerId: owner,
              table: 'reading_sessions',
              column: 'question_enc',
              recordId: row.id,
              aadRevision: 1,
            },
            row.value_enc,
            Question,
          )
        : null;
      return {
        id: row.id,
        revision: row.revision,
        status: metadata.status,
        question: question?.text ?? null,
        editionIds: metadata.editionIds,
        reflectionIds: metadata.reflectionIds,
        savedAt: metadata.savedAt === null ? null : iso(Number(metadata.savedAt)),
        createdAt: iso(Number(metadata.createdAt)),
        requests: metadata.requests,
      };
    }
    if (row.kind === 'reading') {
      if (
        metadata.status === 'withdrawn' ||
        metadata.status === 'deleted' ||
        metadata.contentState === 'withdrawn' ||
        !row.value_enc
      )
        return {
          kind: 'reading.unavailable.v1',
          editionId: row.id,
          sessionId: row.session_id,
          editionNumber: row.revision,
          parentEditionId: metadata.parentEditionId,
          reason:
            metadata.status === 'deleted'
              ? 'deleted'
              : metadata.contentState === 'withdrawn'
                ? 'content_withdrawn'
                : 'source_erased',
          unavailableAt: iso(Number(metadata.unavailableAt)),
        };
      const value = await this.base.opened<z.infer<typeof Reading>>(
        {
          ownerId: owner,
          table: 'reading_editions',
          column: 'body_enc',
          recordId: row.id,
          aadRevision: 1,
        },
        row.value_enc,
        Reading,
      );
      if (
        value.editionId !== row.id ||
        value.sessionId !== row.session_id ||
        value.editionNumber !== row.revision
      )
        throw new RecordError(503, 'KEY_UNAVAILABLE');
      return value;
    }
    if (row.kind === 'revisit') {
      if (!row.value_enc || !row.session_id) throw new RecordError(503, 'KEY_UNAVAILABLE');
      return decodeRevisit(
        this.base,
        owner,
        {
          id: row.id,
          session_id: row.session_id,
          edition_id: String(metadata.editionId),
          created_at: Number(metadata.createdAt),
        },
        row.revision,
        row.value_enc,
        row.key_version,
        Number(metadata.updatedAt),
        Boolean(metadata.historical),
      );
    }
    if (row.kind === 'reflection') {
      if (!row.value_enc) throw new RecordError(503, 'KEY_UNAVAILABLE');
      const value = await this.base.opened<z.infer<typeof Reflection>>(
        {
          ownerId: owner,
          table: 'reflection_revisions',
          column: 'body_enc',
          recordId: `${row.id}:${row.revision}`,
          aadRevision: row.revision,
        },
        row.value_enc,
        Reflection,
      );
      if (
        value.id !== row.id ||
        value.revision !== row.revision ||
        value.sessionId !== row.session_id ||
        value.editionId !== metadata.editionId
      )
        throw new RecordError(503, 'KEY_UNAVAILABLE');
      return value;
    }
    const selectedFragments = metadata.contextCount
      ? await this.fragments(owner, row.id)
      : undefined;
    const contextComplete =
      !selectedFragments ||
      (selectedFragments.length === metadata.contextCount &&
        selectedFragments.every((fragment) => fragment.availability === 'retained'));
    const transmission =
      row.value_enc && contextComplete
        ? await this.base.opened<{
            v: 1;
            syntheticOnly: boolean;
            payload: string;
            contextReceipt?: z.infer<typeof AnyWriterReceipt> | null;
          }>(
            {
              ownerId: owner,
              table: 'provider_dispatches',
              column: 'transmission_enc',
              recordId: String(metadata.dispatchId),
              aadRevision: 1,
            },
            row.value_enc,
            z.strictObject({
              v: z.literal(1),
              syntheticOnly: z.boolean(),
              payload: z.string().max(200000),
              contextReceipt: AnyWriterReceipt.nullable().optional(),
            }),
          )
        : null;
    return {
      requestId: row.id,
      state: metadata.state,
      createdAt: iso(Number(metadata.createdAt)),
      inputTokens: metadata.inputTokens,
      outputTokens: metadata.outputTokens,
      cachedInputTokens: metadata.cachedInputTokens ?? null,
      cacheWriteTokens: metadata.cacheWriteTokens ?? null,
      reasoningTokens: metadata.reasoningTokens ?? null,
      serviceTier: metadata.serviceTier ?? null,
      actualCostMicroUsd: metadata.actualCost ?? null,
      costState: metadata.costState,
      transmission: transmission?.payload ?? null,
      ...(transmission?.contextReceipt ? { contextReceipt: transmission.contextReceipt } : {}),
      ...(selectedFragments ? { selectedFragments } : {}),
      reproduction: transmission ? 'complete' : 'redacted',
    };
  }
  private async fragments(owner: string, requestId: string) {
    const { results } = await q(
      this.base.db,
      'SELECT ordinal,grant_id,grant_revision,fragment_enc,fragment_hmac FROM generation_context WHERE owner_id=? AND request_id=? ORDER BY ordinal',
      owner,
      requestId,
    ).all<{
      ordinal: number;
      grant_id: string;
      grant_revision: number;
      fragment_enc: string | null;
      fragment_hmac: string;
    }>();
    return Promise.all(
      results.map(async (row) => {
        if (row.fragment_enc === null)
          return {
            ordinal: row.ordinal,
            grantId: row.grant_id,
            grantRevision: row.grant_revision,
            availability: 'erased' as const,
          };
        const fragment = await this.base.opened<z.infer<typeof SelectedFragment>>(
          {
            table: 'generation_context',
            column: 'fragment_enc',
            recordId: `${requestId}:${row.ordinal}`,
            ownerId: owner,
            aadRevision: 1,
          },
          row.fragment_enc,
          SelectedFragment,
        );
        if (
          fragment.ordinal !== row.ordinal ||
          fragment.grantId !== row.grant_id ||
          fragment.grantRevision !== row.grant_revision ||
          fragment.availability !== 'retained' ||
          fragment.text === null ||
          fragment.textHash !== row.fragment_hmac
        )
          throw new RecordError(503, 'KEY_UNAVAILABLE');
        return fragment;
      }),
    );
  }
}
