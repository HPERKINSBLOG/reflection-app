import { z } from 'zod';
import { IMPORT_LIMITS } from '../../contracts/import-policy.ts';
import {
  apiSchemas,
  ImportChunkDocument,
  ImportRecordIdentity,
  ImportRecovery,
  ImportSource,
  ImportUnit,
} from '../../contracts/index.ts';
import { canonicalJson } from '../../domain/json.ts';
import { buildImportGroups } from '../../domain/imports/chunks.ts';
import { sameSource } from '../../domain/imports/identity.ts';
import { rawHash } from '../../domain/imports/legacy.ts';
import { parseImport, validateUnit } from '../../domain/imports/parse.ts';
import type { Unit, ImportWrite } from '../../domain/imports/types.ts';
import { assertExists, assertChanges, DB_NOW, statement as q } from '../db/core.ts';
import type { Session } from '../identity/types.ts';
import { RecordBase, RecordError, iso } from './base.ts';
import {
  aliasTarget,
  classifyImport,
  effectiveImportUnit,
  importCopySources,
  importIndex,
  type AliasRow,
} from './import-identity.ts';
import { importLabel } from '../../domain/imports/review.ts';
import { importFields } from './import-fields.ts';
import { projectImportGroup, publishImportTargets } from './import-targets.ts';

type Commit = z.infer<typeof apiSchemas.ImportGroupCommit>;
type Preview = z.infer<typeof apiSchemas.ImportPreview>;
type Status = z.infer<typeof apiSchemas.ImportGroupStatus>;
type Results = z.infer<typeof apiSchemas.ImportGroupResultPage>;
const RowResult = z.strictObject({
  identity: ImportRecordIdentity.nullable(),
  originalId: z.string().nullable(),
  readiness: z.enum(['ready', 'duplicate', 'conflict', 'erased', 'invalid']),
});
const StoredItem = z.strictObject({
  unit: ImportUnit,
  source: ImportSource,
  recovery: ImportRecovery,
});
const after = z.strictObject({ ordinal: z.number().int().nonnegative() });
interface Group {
  id: string;
  manifest_hash: string;
  source_hmac: string;
  recovery_hmac: string;
  epoch: number;
  unit_count: number;
  preview_hash: string | null;
  state: Status['state'];
  expires_at: number;
  expired: number;
  lease_expired: number;
  retain_until: number;
}
interface Item {
  batch_id: string;
  item_index: number;
  group_id: string | null;
  ordinal: number;
  source_key_hmac: string;
  source_entity_hmac: string;
  original_hmac: string;
  state: string;
  session_id: string | null;
  error_code: string | null;
  body_enc: string | null;
  result_enc: string | null;
}
type Decision = Awaited<ReturnType<typeof classifyImport>>;
const field = (
  ownerId: string,
  column: 'result_enc' | 'body_enc',
  batchId: string,
  index: number,
) => ({ ownerId, table: 'import_items', column, recordId: `${batchId}:${index}`, aadRevision: 1 });
const sizeLimit = 20 * 1024 * 1024;
const groupAdmission = `SELECT 1 AS allowed WHERE EXISTS(SELECT 1 FROM import_groups WHERE owner_id=? AND id=?) OR (
  (SELECT count(*) FROM import_groups WHERE owner_id=? AND created_at>=unixepoch('now','start of day')*1000)
  +(SELECT count(*) FROM import_batches WHERE owner_id=? AND group_id IS NULL AND created_at>=unixepoch('now','start of day')*1000))<10`;
const noErase = (db: D1Database, owner: string) =>
  assertExists(
    db,
    "SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM deletion_jobs WHERE owner_id=? AND state!='complete')",
    owner,
  );

export class ReadingImports extends RecordBase {
  private async group(session: Session, id: string) {
    await this.checked(session);
    const row = await q(
      this.db,
      `SELECT *,expires_at<=${DB_NOW} AS expired,lease_until<=${DB_NOW} AS lease_expired FROM import_groups WHERE owner_id=? AND id=? AND retain_until>${DB_NOW}`,
      session.subjectId,
      id,
    ).first<Group>();
    if (!row) throw new RecordError(404, 'NOT_FOUND');
    return row;
  }
  private async parse(input: ImportWrite, id: string) {
    try {
      let parseSource = input.source;
      if (
        input.recovery.kind !== 'none' &&
        (input.format === 'reflection-import.v1' || input.format === 'reflection-portable-chunk.v1')
      ) {
        const carrier = JSON.parse(input.document);
        const embedded =
          input.format === 'reflection-portable-chunk.v1'
            ? carrier.items?.[0]?.unit?.identity?.source
            : carrier.records?.[0]?.identity?.source;
        if (embedded && sameSource(embedded, input.recovery.previousSource))
          parseSource = input.recovery.previousSource;
      }
      const parsed = await parseImport({ ...input, source: parseSource });
      if (parsed.units.length + parsed.errors.length > IMPORT_LIMITS.previewItems)
        throw new Error('INPUT_TOO_LARGE');
      if (input.format === 'reflection-portable-chunk.v1') {
        if (parsed.errors.length) throw new Error('IMPORT_INVALID');
        const chunk = ImportChunkDocument.parse(JSON.parse(input.document));
        return {
          units: chunk.items,
          errors: parsed.errors,
          groupId: chunk.groupId,
          manifest: chunk.manifestHash,
          total: chunk.unitCount,
        };
      }
      // A raw multi-family file is a preview only. The client explicitly selects and submits its individual manifests.
      const oneFamily =
        parsed.units.length > 0 &&
        !parsed.errors.length &&
        parsed.units.every((u) => u.groupKey === parsed.units[0]!.groupKey);
      if (oneFamily) {
        const [group] = await buildImportGroups(parsed.units, () => id, input.recovery);
        return {
          units: group!.units.map((unit, ordinal) => ({ ordinal, unit })),
          errors: parsed.errors,
          groupId: id,
          manifest: group!.manifestHash,
          total: group!.units.length,
        };
      }
      return {
        units: parsed.units.map((unit, ordinal) => ({ ordinal, unit })),
        errors: parsed.errors,
        groupId: null,
        manifest: null,
        total: parsed.units.length,
      };
    } catch (error) {
      throw new RecordError(
        error instanceof Error && error.message === 'INPUT_TOO_LARGE' ? 413 : 422,
        error instanceof Error && error.message === 'INPUT_TOO_LARGE'
          ? 'INPUT_TOO_LARGE'
          : 'IMPORT_INVALID',
      );
    }
  }
  private async previewReply(session: Session, id: string, input: ImportWrite): Promise<Preview> {
    const owner = session.subjectId;
    const account = await this.account(session);
    const batch = await q(
      this.db,
      `SELECT b.expires_at,b.document_hmac,b.expires_at<=${DB_NOW} AS expired,g.epoch FROM import_batches b
       LEFT JOIN import_groups g ON g.owner_id=b.owner_id AND g.id=b.group_id WHERE b.owner_id=? AND b.id=?`,
      owner,
      id,
    ).first<{ expires_at: number; expired: number; document_hmac: string; epoch: number | null }>();
    if (!batch) throw new RecordError(404, 'NOT_FOUND');
    if (batch.expired) throw new RecordError(410, 'EXPIRED');
    if (batch.epoch !== null && batch.epoch !== session.epoch)
      throw new RecordError(409, 'CONFLICT');
    const rows = await q(
      this.db,
      'SELECT item_index,result_enc,error_code FROM import_items WHERE owner_id=? AND batch_id=? ORDER BY item_index',
      owner,
      id,
    ).all<{ item_index: number; result_enc: string | null; error_code: string | null }>();
    const items = await Promise.all(
      rows.results.map(async (row) => {
        if (!row.result_enc)
          return {
            index: row.item_index,
            status: 'erased' as const,
            identity: null,
            originalId: null,
            error: 'CONTENT_UNAVAILABLE',
          };
        const item = (await this.opened(
          field(owner, 'result_enc', id, row.item_index),
          row.result_enc,
          RowResult,
        )) as z.infer<typeof RowResult>;
        return {
          index: row.item_index,
          status: item.readiness,
          identity: item.identity,
          originalId: item.originalId,
          error: item.readiness === 'invalid' ? (row.error_code ?? 'IMPORT_INVALID') : null,
        };
      }),
    );
    await this.checked(session, account.data_revision, [noErase(this.db, owner)]);
    return apiSchemas.ImportPreview.parse({
      id,
      source: input.source,
      recovery: input.recovery,
      expiresAt: iso(batch.expires_at),
      previewHash: batch.document_hmac,
      items,
    });
  }
  async preview(session: Session, key: string, input: ImportWrite): Promise<Preview> {
    if (
      input.document.length > IMPORT_LIMITS.documentUnits ||
      new TextEncoder().encode(JSON.stringify(input)).length > IMPORT_LIMITS.bodyBytes
    )
      throw new RecordError(413, 'INPUT_TOO_LARGE');
    await this.checked(session);
    const account = await this.account(session),
      owner = session.subjectId,
      version = account.key_version;
    if (!account.recovery_ack_at) throw new RecordError(403, 'FORBIDDEN');
    const mutation = await this.mutation(session, key, 'import.preview', input);
    if (mutation.existing) return this.previewReply(session, mutation.existing, input);
    const batchId = crypto.randomUUID(),
      parsed = await this.parse(input, batchId);
    const existingOwner = parsed.groupId
      ? await q(
          this.db,
          'SELECT owner_id FROM import_groups WHERE id=?',
          parsed.groupId,
        ).first<string>('owner_id')
      : null;
    if (existingOwner !== null && existingOwner !== owner) throw new RecordError(404, 'NOT_FOUND');
    const joinExisting = async () => {
      const existing = await q(
        this.db,
        'SELECT id FROM import_batches WHERE owner_id=? AND document_hmac=?',
        owner,
        mutation.payloadHash,
      ).first<string>('id');
      if (!existing) return null;
      if ((await this.account(session)).storage_bytes + 1024 > sizeLimit)
        throw new RecordError(409, 'STORAGE_LIMIT_EXCEEDED');
      try {
        // Only the retry key changes. Readers comparing account data revisions can keep their snapshot.
        await this.db.batch([
          this.identity.sessions.guard(session),
          noErase(this.db, owner),
          assertExists(
            this.db,
            `SELECT 1 FROM import_batches WHERE owner_id=? AND id=? AND document_hmac=? AND expires_at>${DB_NOW}`,
            owner,
            existing,
            mutation.payloadHash,
          ),
          mutation.insert(existing),
          assertExists(
            this.db,
            'SELECT 1 FROM accounts WHERE id=? AND storage_bytes<=?',
            owner,
            sizeLimit,
          ),
        ]);
      } catch (error) {
        const raced = await this.mutation(session, key, 'import.preview', input);
        if (raced.existing !== existing) throw error;
      }
      return this.previewReply(session, existing, input);
    };
    const existing = await joinExisting();
    if (existing) return existing;
    const [sourceHash, recoveryHash] = await Promise.all([
      this.crypt.hashVersion(owner, 'import-source', input.source, version),
      this.crypt.hashVersion(owner, 'import-recovery', input.recovery, version),
    ]);
    const groupId = parsed.groupId;
    const admissionArgs = [owner, groupId, owner, owner] as const;
    const admits = () => q(this.db, groupAdmission, ...admissionArgs).first();
    if (!(await admits())) throw new RecordError(429, 'RATE_LIMITED');
    const items = await Promise.all(
      parsed.units.map(async ({ unit, ordinal }, index) => {
        const effective = effectiveImportUnit(unit, input.source, input.recovery);
        const decision = await classifyImport(
          this,
          session,
          effective,
          input.source,
          input.recovery,
          version,
        );
        const result = {
          identity: effective.identity,
          originalId:
            effective.kind === 'legacy-reading'
              ? effective.record.originalId
              : effective.kind === 'portable'
                ? effective.record.originalId
                : effective.identity.recordId,
          readiness: decision.state,
        };
        const [body, summary, links] = await Promise.all([
          this.crypt.seal(
            field(owner, 'body_enc', batchId, index),
            { unit, source: input.source, recovery: input.recovery },
            version,
          ),
          this.crypt.seal(field(owner, 'result_enc', batchId, index), result, version),
          Promise.all(
            importCopySources(effective).map(
              async (id) => (await importIndex(this, owner, id, version)).entity,
            ),
          ),
        ]);
        return { index, ordinal, ...decision, body, summary, links };
      }),
    );
    const errors = await Promise.all(
      parsed.errors.map(async (e, i) => {
        const index = items.length + i;
        const result = { identity: null, originalId: null, readiness: 'invalid' };
        return {
          index,
          ordinal: index,
          key: `${mutation.payloadHash}:${index}`,
          entity: `${mutation.payloadHash}:${index}`,
          original: mutation.payloadHash,
          state: 'invalid',
          body: null,
          summary: await this.crypt.seal(
            field(owner, 'result_enc', batchId, index),
            result,
            version,
          ),
          links: [] as string[],
          error: e.code,
        };
      }),
    );
    const all = [...items, ...errors];
    const links = JSON.stringify(
      all.flatMap((item) =>
        [...new Set(item.links)]
          .filter((link) => link !== item.entity)
          .map((link) => [link, item.entity]),
      ),
    );
    const missingLinks = await q(
      this.db,
      `SELECT count(*) AS n FROM json_each(?) link WHERE NOT EXISTS (
      SELECT 1 FROM import_copy_sources old WHERE old.owner_id=? AND old.source_entity_hmac=link.value->>'$[0]' AND old.dependent_entity_hmac=link.value->>'$[1]')`,
      links,
      owner,
    ).first<number>('n');
    const required = all.reduce(
      (bytes, item) => bytes + 1024 + (item.body?.length ?? 0) + item.summary.length,
      2048 +
        (parsed.groupId !== null && existingOwner === null ? 1024 : 0) +
        1024 * (missingLinks ?? 0),
    );
    if (account.storage_bytes + required > sizeLimit)
      throw new RecordError(409, 'STORAGE_LIMIT_EXCEEDED');
    const statements: D1PreparedStatement[] = [
      noErase(this.db, owner),
      assertExists(this.db, groupAdmission, ...admissionArgs),
      assertExists(
        this.db,
        'SELECT 1 FROM accounts WHERE id=? AND key_version=? AND data_revision=? AND recovery_ack_at IS NOT NULL',
        owner,
        version,
        account.data_revision,
      ),
    ];
    if (groupId) {
      statements.push(
        q(
          this.db,
          `INSERT INTO import_groups(id,owner_id,manifest_hash,source_hmac,recovery_hmac,epoch,unit_count,state,created_at,expires_at,retain_until) VALUES(?,?,?,?,?,?,?,'staged',${DB_NOW},${DB_NOW}+86400000,${DB_NOW}+604800000) ON CONFLICT(id) DO NOTHING`,
          groupId,
          owner,
          parsed.manifest!,
          sourceHash,
          recoveryHash,
          session.epoch,
          parsed.total,
        ),
        assertExists(
          this.db,
          `SELECT 1 FROM import_groups WHERE id=? AND owner_id=? AND state='staged' AND epoch=? AND manifest_hash=? AND source_hmac=? AND recovery_hmac=? AND unit_count=? AND expires_at>${DB_NOW}`,
          groupId,
          owner,
          session.epoch,
          parsed.manifest!,
          sourceHash,
          recoveryHash,
          parsed.total,
        ),
      );
    }
    statements.push(
      q(
        this.db,
        `INSERT INTO import_batches(id,owner_id,source_format,document_hmac,state,created_at,expires_at,group_id) VALUES(?,?,?,?,'preview',${DB_NOW},coalesce((SELECT expires_at FROM import_groups WHERE id=? AND owner_id=?),${DB_NOW}+86400000),?)`,
        batchId,
        owner,
        input.format,
        mutation.payloadHash,
        groupId,
        owner,
        groupId,
      ),
    );
    for (const item of all)
      statements.push(
        q(
          this.db,
          'INSERT INTO import_items(batch_id,owner_id,item_index,source_key_hmac,source_entity_hmac,original_hmac,body_enc,result_enc,key_version,state,group_id,ordinal,error_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
          batchId,
          owner,
          item.index,
          item.key,
          item.entity,
          item.original,
          item.body,
          item.summary,
          version,
          item.state,
          groupId,
          groupId ? item.ordinal : null,
          'error' in item ? item.error : null,
        ),
      );
    statements.push(
      q(
        this.db,
        `INSERT OR IGNORE INTO import_copy_sources(owner_id,source_entity_hmac,dependent_entity_hmac)
      SELECT ?,value->>'$[0]',value->>'$[1]' FROM json_each(?)`,
        owner,
        links,
      ),
    );
    try {
      await this.atomic(session, [...statements, mutation.insert(batchId)]);
    } catch (error) {
      const replay = await this.mutation(session, key, 'import.preview', input);
      if (replay.existing) return this.previewReply(session, replay.existing, input);
      const raced = await joinExisting();
      if (raced) return raced;
      if (
        groupId &&
        (await q(
          this.db,
          'SELECT 1 FROM import_groups WHERE id=? AND owner_id!=?',
          groupId,
          owner,
        ).first())
      )
        throw new RecordError(404, 'NOT_FOUND');
      if ((await this.account(session)).storage_bytes + required > sizeLimit)
        throw new RecordError(409, 'STORAGE_LIMIT_EXCEEDED');
      if (!(await admits())) throw new RecordError(429, 'RATE_LIMITED');
      if (String(error).includes('constraint')) throw new RecordError(409, 'CONFLICT');
      throw error;
    }
    return this.previewReply(session, batchId, input);
  }

  private async snapshot(session: Session, g: Group) {
    const owner = session.subjectId;
    const values: { row: Item; stored: z.infer<typeof StoredItem>; effective: Unit }[] = [];
    while (values.length < g.unit_count) {
      const page = await q(
        this.db,
        'SELECT * FROM import_items WHERE owner_id=? AND group_id=? AND ordinal>=? ORDER BY ordinal LIMIT 4',
        owner,
        g.id,
        values.length,
      ).all<Item>();
      if (!page.results.length) break;
      for (const row of page.results) {
        if (!row.body_enc || row.ordinal !== values.length) throw new RecordError(409, 'CONFLICT');
        const stored = await this.crypt.open(
          field(owner, 'body_enc', row.batch_id, row.item_index),
          row.body_enc,
          StoredItem,
        );
        await validateUnit(stored.unit);
        values.push({
          row,
          stored,
          effective: effectiveImportUnit(stored.unit, stored.source, stored.recovery),
        });
      }
    }
    if (
      values.length !== g.unit_count ||
      values.some(
        (v, i) =>
          v.stored.unit.groupKey !== values[0]!.stored.unit.groupKey ||
          (i > 0 && v.stored.unit.key <= values[i - 1]!.stored.unit.key),
      ) ||
      (await rawHash(canonicalJson(values.map((v) => v.stored.unit)))) !== g.manifest_hash
    )
      throw new RecordError(409, 'CONFLICT');
    return values;
  }
  private status(g: Group): Status {
    return apiSchemas.ImportGroupStatus.parse({
      groupId: g.id,
      state: g.state,
      manifestHash: g.manifest_hash,
      previewHash: g.preview_hash,
      totalItems: g.unit_count,
      completedItems: g.state === 'complete' ? g.unit_count : 0,
      nextCursor: null,
    });
  }
  private async stop(session: Session, g: Group, state: 'failed' | 'expired', token?: string) {
    const owner = session.subjectId;
    await this.db.batch([
      this.identity.sessions.guard(session),
      q(
        this.db,
        `UPDATE import_groups SET state=?,preview_hash=NULL,lease_token=NULL,lease_until=NULL WHERE owner_id=? AND id=? AND state IN('staged','committing') AND ${token ? 'lease_token=?' : state === 'expired' ? `expires_at<=${DB_NOW}` : `lease_until<=${DB_NOW}`}`,
        state,
        owner,
        g.id,
        ...(token ? [token] : []),
      ),
      assertChanges(this.db, 1),
      q(this.db, 'DELETE FROM import_staging WHERE owner_id=? AND group_id=?', owner, g.id),
      q(
        this.db,
        "UPDATE import_items SET body_enc=NULL,state='failed',error_code=? WHERE owner_id=? AND group_id=?",
        state === 'expired' ? 'EXPIRED' : 'CONFLICT',
        owner,
        g.id,
      ),
      q(
        this.db,
        "UPDATE import_batches SET state='expired' WHERE owner_id=? AND group_id=?",
        owner,
        g.id,
      ),
    ]);
  }
  async groupStatus(session: Session, id: string): Promise<Status> {
    let g = await this.group(session, id);
    if (g.state === 'complete' || g.state === 'failed' || g.state === 'expired')
      return this.status(g);
    if (g.expired || (g.state === 'committing' && g.lease_expired)) {
      try {
        await this.stop(session, g, g.expired ? 'expired' : 'failed');
      } catch {
        /* Concurrent completion reconciles below. */
      }
      return this.status(await this.group(session, id));
    }
    if (g.epoch !== session.epoch) throw new RecordError(409, 'CONFLICT');
    if (g.state === 'staged' && !g.preview_hash) {
      const count = await q(
        this.db,
        "SELECT count(*) AS n FROM import_items WHERE owner_id=? AND group_id=? AND state IN('ready','duplicate') AND body_enc IS NOT NULL",
        session.subjectId,
        id,
      ).first<number>('n');
      if (count === g.unit_count) {
        const units = await this.snapshot(session, g);
        const digest = await this.crypt.hash(session.subjectId, 'import-confirm', [
          'import-group.v1',
          session.epoch,
          id,
          g.manifest_hash,
          g.source_hmac,
          g.recovery_hmac,
          units.map((v) => [
            v.row.ordinal,
            v.row.source_key_hmac,
            v.row.original_hmac,
            v.row.state,
          ]),
        ]);
        await this.db.batch([
          this.identity.sessions.guard(session),
          noErase(this.db, session.subjectId),
          q(
            this.db,
            `UPDATE import_groups SET preview_hash=? WHERE owner_id=? AND id=? AND state='staged' AND expires_at>${DB_NOW}`,
            digest,
            session.subjectId,
            id,
          ),
        ]);
        g = await this.group(session, id);
      }
    }
    return this.status(g);
  }
  async reviewPage(
    session: Session,
    id: string,
    cursor: string | null,
  ): Promise<z.infer<typeof apiSchemas.ImportReviewPage>> {
    const account = await this.account(session);
    const group = await this.group(session, id);
    if (group.expired) throw new RecordError(410, 'EXPIRED');
    if (group.state !== 'staged' || group.epoch !== session.epoch)
      throw new RecordError(409, 'CONFLICT');
    const scope = ['import-review', session.epoch, id, group.manifest_hash];
    const prior = cursor ? await this.parseCursor(session, scope, cursor, after) : null;
    const rows = await q(
      this.db,
      'SELECT batch_id,item_index,ordinal,body_enc,result_enc FROM import_items WHERE owner_id=? AND group_id=? AND ordinal>? ORDER BY ordinal LIMIT 26',
      session.subjectId,
      id,
      prior?.ordinal ?? -1,
    ).all<Item>();
    const visible = await Promise.all(
      rows.results.slice(0, 25).map(async (row) => {
        if (!row.body_enc || !row.result_enc) throw new RecordError(410, 'CONTENT_UNAVAILABLE');
        const [stored, result] = await Promise.all([
          this.crypt.open(
            field(session.subjectId, 'body_enc', row.batch_id, row.item_index),
            row.body_enc,
            StoredItem,
          ),
          this.crypt.open(
            field(session.subjectId, 'result_enc', row.batch_id, row.item_index),
            row.result_enc,
            RowResult,
          ),
        ]);
        const unit = stored.unit;
        const label = importLabel(unit);
        return {
          source: stored.source,
          recovery: stored.recovery,
          item: {
            index: row.ordinal,
            label,
            identity: result.identity,
            originalId: result.originalId,
            status: result.readiness,
            error: null,
          },
        };
      }),
    );
    if (!visible[0]) throw new RecordError(404, 'NOT_FOUND');
    await this.checked(session, account.data_revision, [
      noErase(this.db, session.subjectId),
      assertExists(
        this.db,
        `SELECT 1 FROM import_groups WHERE owner_id=? AND id=? AND state='staged' AND expires_at>${DB_NOW}`,
        session.subjectId,
        id,
      ),
    ]);
    return {
      groupId: id,
      source: visible[0].source,
      recovery: visible[0].recovery,
      items: visible.map((v) => v.item),
      nextCursor:
        rows.results.length > 25
          ? await this.cursor(session, scope, { ordinal: visible[24]!.item.index })
          : null,
    };
  }

  async groupResults(session: Session, id: string, cursor: string | null): Promise<Results> {
    const g = await this.group(session, id);
    const revision = (await this.account(session)).data_revision;
    if (g.state !== 'complete' && g.state !== 'failed' && g.state !== 'expired')
      throw new RecordError(409, 'CONFLICT');
    const scope = ['import-results', session.epoch, id],
      point = cursor ? await this.parseCursor(session, scope, cursor, after) : null;
    const rows = await q(
      this.db,
      'SELECT batch_id,item_index,ordinal,result_enc,session_id,state,error_code FROM import_items WHERE owner_id=? AND group_id=? AND ordinal>? ORDER BY ordinal LIMIT 101',
      session.subjectId,
      id,
      point?.ordinal ?? -1,
    ).all<Item>();
    const items = await Promise.all(
      rows.results.slice(0, 100).map(async (row) => {
        const value = row.result_enc
          ? await this.crypt.open(
              field(session.subjectId, 'result_enc', row.batch_id, row.item_index),
              row.result_enc,
              RowResult,
            )
          : null;
        return {
          index: row.ordinal,
          identity: value?.identity ?? null,
          status:
            row.state === 'imported'
              ? 'imported'
              : row.state === 'duplicate'
                ? 'duplicate'
                : 'failed',
          sessionId: row.session_id,
          errorCode: row.error_code,
        };
      }),
    );
    const nextCursor =
      rows.results.length > 100
        ? await this.cursor(session, scope, { ordinal: rows.results[99]!.ordinal })
        : null;
    await this.checked(session, revision, [noErase(this.db, session.subjectId)]);
    return apiSchemas.ImportGroupResultPage.parse({ groupId: g.id, items, nextCursor });
  }
  async commitGroup(session: Session, id: string, key: string, input: Commit): Promise<Status> {
    const owner = session.subjectId,
      account = await this.account(session),
      version = account.key_version;
    const mutation = await this.mutation(session, key, 'import.commit', { id, input });
    if (mutation.existing && mutation.existing !== id)
      throw new RecordError(409, 'IDEMPOTENCY_MISMATCH');
    const current = await this.groupStatus(session, id),
      g = await this.group(session, id);
    if (current.state === 'expired') throw new RecordError(410, 'EXPIRED');
    if (
      g.epoch !== session.epoch ||
      input.manifestHash !== g.manifest_hash ||
      input.previewHash !== g.preview_hash ||
      (await this.crypt.hashVersion(owner, 'import-recovery', input.confirmedRecovery, version)) !==
        g.recovery_hmac
    ) {
      if (mutation.existing && g.state === 'failed') return this.status(g);
      throw new RecordError(409, 'CONFLICT');
    }
    const joinSubmitted = async () => {
      if (!mutation.existing) {
        if ((await this.account(session)).storage_bytes + 1024 > sizeLimit)
          throw new RecordError(409, 'STORAGE_LIMIT_EXCEEDED');
        try {
          await this.db.batch([
            this.identity.sessions.guard(session),
            noErase(this.db, owner),
            mutation.insert(id),
            q(
              this.db,
              `UPDATE import_groups SET retain_until=max(retain_until,${DB_NOW}+604800000) WHERE owner_id=? AND id=? AND epoch=? AND preview_hash=? AND state IN('committing','complete')`,
              owner,
              id,
              session.epoch,
              input.previewHash,
            ),
            assertChanges(this.db, 1),
            assertExists(
              this.db,
              'SELECT 1 FROM accounts WHERE id=? AND storage_bytes<=?',
              owner,
              sizeLimit,
            ),
          ]);
        } catch (error) {
          const raced = await this.mutation(session, key, 'import.commit', { id, input });
          if (raced.existing !== id) throw error;
        }
      }
      return this.groupStatus(session, id);
    };
    if (g.state === 'complete' || g.state === 'committing') return joinSubmitted();
    if (g.state !== 'staged') throw new RecordError(409, 'CONFLICT');
    const token = crypto.randomUUID();
    try {
      await this.atomic(session, [
        noErase(this.db, owner),
        q(
          this.db,
          `UPDATE import_groups SET state='committing',lease_token=?,lease_until=min(expires_at,${DB_NOW}+120000),retain_until=max(retain_until,${DB_NOW}+604800000) WHERE owner_id=? AND id=? AND epoch=? AND state='staged' AND expires_at>${DB_NOW} AND preview_hash=?`,
          token,
          owner,
          id,
          session.epoch,
          input.previewHash,
        ),
        assertChanges(this.db, 1),
        ...(mutation.existing ? [] : [mutation.insert(id)]),
      ]);
    } catch (error) {
      const raced = await this.mutation(session, key, 'import.commit', { id, input });
      if (raced.existing === id) return this.groupStatus(session, id);
      const winner = await this.group(session, id);
      if (winner.state === 'committing' || winner.state === 'complete') return joinSubmitted();
      if (String(error).includes('constraint')) throw new RecordError(409, 'CONFLICT');
      throw error;
    }
    try {
      const snapshotAccount = await this.account(session);
      const sourceRows = await this.snapshot(session, g);
      const decisions: Decision[] = [];
      for (const entry of sourceRows) {
        const decision = await classifyImport(
          this,
          session,
          entry.effective,
          entry.stored.source,
          entry.stored.recovery,
          version,
        );
        if (
          decision.state !== entry.row.state ||
          decision.key !== entry.row.source_key_hmac ||
          decision.entity !== entry.row.source_entity_hmac ||
          decision.original !== entry.row.original_hmac ||
          !['ready', 'duplicate'].includes(decision.state)
        )
          throw new RecordError(409, 'CONFLICT');
        decisions.push(decision);
      }
      const resolve = async (dep: Unit['dependencies'][number]) => {
        if (dep.recordRevision === null) return null;
        const indexes = await importIndex(
          this,
          owner,
          { ...dep, recordRevision: dep.recordRevision },
          version,
        );
        const alias = await q(
          this.db,
          'SELECT * FROM import_identities WHERE owner_id=? AND source_key_hmac=? AND erased_at IS NULL',
          owner,
          indexes.key,
        ).first<AliasRow>();
        return alias ? aliasTarget(alias) : null;
      };
      const projected = await projectImportGroup(
        owner,
        id,
        sourceRows.map((entry, i) => ({
          ordinal: entry.row.ordinal,
          unit: entry.effective,
          duplicate: decisions[i]!.duplicate,
        })),
        resolve,
        Date.now(),
        this,
      );
      const guard = () => [
        this.identity.sessions.guard(session),
        noErase(this.db, owner),
        assertExists(
          this.db,
          `SELECT 1 FROM import_groups g JOIN accounts a ON a.id=g.owner_id WHERE g.owner_id=? AND g.id=? AND g.state='committing' AND g.lease_token=? AND g.lease_until>${DB_NOW} AND g.expires_at>${DB_NOW} AND a.key_version=? AND a.data_revision=? AND a.recovery_ack_at IS NOT NULL`,
          owner,
          id,
          token,
          version,
          snapshotAccount.data_revision,
        ),
      ];
      for (let start = 0; start < sourceRows.length; start += 4) {
        const stage: D1PreparedStatement[] = [];
        let growth = 0;
        for (const { row, effective, stored } of sourceRows.slice(start, start + 4)) {
          const rendered = projected.get(row.ordinal),
            decision = decisions[row.ordinal]!;
          if (!rendered) throw new RecordError(409, 'CONFLICT');
          const { target } = rendered;
          const localLinks = await Promise.all(
            rendered.localSources.map(
              async (source) => (await importIndex(this, owner, source, version)).entity,
            ),
          );
          const prior =
            stored.recovery.kind === 'none'
              ? null
              : await importIndex(
                  this,
                  owner,
                  { ...effective.identity, source: stored.recovery.previousSource },
                  version,
                );
          const aliasMeta = {
            ...target,
            aliased: decision.alreadyAliased ? 1 : 0,
            localLinks: [...new Set(localLinks)].filter((entity) => entity !== decision.entity),
            recovery: stored.recovery.kind,
            priorKey: prior?.key ?? null,
            priorEntity: prior?.entity ?? null,
          };
          const fields = [
            ...rendered.fields,
            {
              kind: 'alias' as const,
              targetId: decision.key,
              meta: aliasMeta,
              value: decision.alreadyAliased ? null : effective,
              aadRevision: 1,
            },
          ];
          for (const f of fields) {
            const pair = importFields[f.kind];
            const encrypted =
              f.value === null
                ? null
                : await this.crypt.seal(
                    {
                      ownerId: owner,
                      table: pair[0],
                      column: pair[1],
                      recordId: f.targetId,
                      aadRevision: f.aadRevision,
                    },
                    f.value,
                    version,
                  );
            stage.push(
              q(
                this.db,
                'INSERT INTO import_staging(owner_id,group_id,ordinal,kind,source_entity_hmac,target_id,meta_json,field_enc,key_version) VALUES(?,?,?,?,?,?,?,?,?)',
                owner,
                id,
                row.ordinal,
                f.kind,
                decision.entity,
                f.targetId,
                JSON.stringify(f.meta),
                encrypted,
                version,
              ),
            );
            growth += 1024 + (encrypted?.length ?? 0);
          }
        }
        const bytes = await q(
          this.db,
          'SELECT storage_bytes FROM accounts WHERE id=?',
          owner,
        ).first<number>('storage_bytes');
        if (bytes === null || bytes + growth > sizeLimit)
          throw new RecordError(409, 'STORAGE_LIMIT_EXCEEDED');
        await this.db.batch([
          ...guard(),
          ...stage,
          q(
            this.db,
            `UPDATE import_groups SET lease_until=min(expires_at,${DB_NOW}+120000) WHERE owner_id=? AND id=?`,
            owner,
            id,
          ),
          assertExists(
            this.db,
            'SELECT 1 FROM accounts WHERE id=? AND storage_bytes<=?',
            owner,
            sizeLimit,
          ),
        ]);
      }
      const checkedRows = assertExists(
        this.db,
        `SELECT count(*) FROM import_staging t
        JOIN import_items i ON i.owner_id=t.owner_id AND i.group_id=t.group_id AND i.ordinal=t.ordinal
        LEFT JOIN import_identities a ON a.owner_id=i.owner_id AND a.source_key_hmac=i.source_key_hmac
        WHERE t.owner_id=? AND t.group_id=? AND t.kind='alias' AND i.state IN('ready','duplicate') AND i.body_enc IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM import_identities e WHERE e.owner_id=i.owner_id AND e.source_entity_hmac=i.source_entity_hmac AND e.erased_at IS NOT NULL)
          AND ((t.meta_json->>'$.aliased'=1 AND a.erased_at IS NULL AND a.original_hmac=i.original_hmac) OR (t.meta_json->>'$.aliased'=0 AND a.source_key_hmac IS NULL))
          AND CASE t.meta_json->>'$.recovery'
            WHEN 'none' THEN 1 WHEN 'new_revision' THEN EXISTS(SELECT 1 FROM import_identities prior WHERE prior.owner_id=i.owner_id AND prior.source_key_hmac=t.meta_json->>'$.priorKey' AND prior.erased_at IS NULL)
            WHEN 'reimport_erased' THEN EXISTS(SELECT 1 FROM import_identities prior WHERE prior.owner_id=i.owner_id AND prior.source_entity_hmac=t.meta_json->>'$.priorEntity' AND prior.erased_at IS NOT NULL) END
        HAVING count(*)=?`,
        owner,
        id,
        g.unit_count,
      );
      await this.db.batch([
        ...guard(),
        checkedRows,
        ...publishImportTargets(this.db, owner, id),
        q(
          this.db,
          `INSERT INTO import_identities(owner_id,source_key_hmac,source_entity_hmac,original_hmac,session_id,entity_kind,edition_id,reflection_id,reflection_revision,revisit_id,revisit_revision,source_record_enc,key_version)
          SELECT i.owner_id,i.source_key_hmac,i.source_entity_hmac,i.original_hmac,t.meta_json->>'$.sessionId',t.meta_json->>'$.kind',
            CASE WHEN t.meta_json->>'$.kind'='edition' THEN t.meta_json->>'$.editionId' END,
            CASE WHEN t.meta_json->>'$.kind'='reflection_revision' THEN t.meta_json->>'$.reflectionId' END,
            CASE WHEN t.meta_json->>'$.kind'='reflection_revision' THEN t.meta_json->>'$.reflectionRevision' END,
            CASE WHEN t.meta_json->>'$.kind'='revisit' THEN t.meta_json->>'$.revisitId' END,
            CASE WHEN t.meta_json->>'$.kind'='revisit' THEN t.meta_json->>'$.revisitRevision' END,t.field_enc,t.key_version
          FROM import_staging t JOIN import_items i ON i.owner_id=t.owner_id AND i.group_id=t.group_id AND i.ordinal=t.ordinal
          WHERE t.owner_id=? AND t.group_id=? AND t.kind='alias' AND t.meta_json->>'$.aliased'=0`,
          owner,
          id,
        ),
        q(
          this.db,
          `INSERT OR IGNORE INTO import_copy_sources(owner_id,source_entity_hmac,dependent_entity_hmac)
          SELECT t.owner_id,l.value,t.source_entity_hmac FROM import_staging t,json_each(t.meta_json,'$.localLinks') l WHERE t.owner_id=? AND t.group_id=? AND t.kind='alias'`,
          owner,
          id,
        ),
        q(
          this.db,
          `UPDATE import_items AS i SET body_enc=NULL,state=CASE i.state WHEN 'ready' THEN 'imported' ELSE i.state END,session_id=t.meta_json->>'$.sessionId'
          FROM import_staging t WHERE i.owner_id=? AND i.group_id=? AND t.owner_id=i.owner_id AND t.group_id=i.group_id AND t.ordinal=i.ordinal AND t.kind='alias'`,
          owner,
          id,
        ),
        assertChanges(this.db, g.unit_count),
        q(this.db, 'DELETE FROM import_staging WHERE owner_id=? AND group_id=?', owner, id),
        q(
          this.db,
          "UPDATE import_batches SET state='complete' WHERE owner_id=? AND group_id=?",
          owner,
          id,
        ),
        q(
          this.db,
          `UPDATE import_groups SET state='complete',lease_token=NULL,lease_until=NULL WHERE owner_id=? AND id=? AND lease_token=? AND expires_at>${DB_NOW}`,
          owner,
          id,
          token,
        ),
        assertChanges(this.db, 1),
        q(
          this.db,
          'UPDATE accounts SET data_revision=data_revision+1 WHERE id=? AND storage_bytes<=?',
          owner,
          sizeLimit,
        ),
        assertChanges(this.db, 1),
      ]);
    } catch (error) {
      const latest = await this.group(session, id);
      if (latest.state === 'complete') return this.status(latest);
      try {
        await this.stop(session, latest, latest.expired ? 'expired' : 'failed', token);
      } catch {
        /* Another driver or erasure holds the fence. */
      }
      if (latest.expired || latest.state === 'expired') throw new RecordError(410, 'EXPIRED');
      if (error instanceof RecordError) throw error;
      if (String(error).includes('constraint')) throw new RecordError(409, 'CONFLICT');
      throw error;
    }
    return this.status(await this.group(session, id));
  }
}
