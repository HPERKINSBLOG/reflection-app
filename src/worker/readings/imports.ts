import { z } from 'zod';
import { apiSchemas, ImportChunkDocument } from '../../contracts/index.ts';
import { parseImport } from '../../domain/imports/parse.ts';
import { buildImportGroups, verifyImportGroup } from '../../domain/imports/chunks.ts';
import type { ImportWrite, Unit } from '../../domain/imports/types.ts';
import { statement as q, DB_NOW } from '../db/core.ts';
import { assertion } from '../identity/checkpoint.ts';
import type { Session } from '../identity/types.ts';
import { RecordBase, RecordError, iso } from './base.ts';
import { materializeImport } from './import-materialize.ts';
import { copyLinks, destinationLinks, nativeLinks } from './import-lifecycle.ts';
import { nativeImport } from './import-native.ts';
import { nativeImports } from './import-native-batch.ts';
import { encryptedBytes } from './crypto.ts';
import {
  ImportHeader,
  ImportItemBody,
  importHashers,
  assertRecovery,
  effectiveIdentity,
  itemId,
  same,
  type GroupRow,
  type ItemRow,
  type AliasRow,
  type Header,
  type ItemResult,
} from './import-model.ts';

const DAY = 86_400_000;
type Commit = z.infer<typeof apiSchemas.ImportGroupCommit>;
export class ReadingImports extends RecordBase {
  constructor(base: RecordBase) {
    super(base.db, base.identity);
  }
  private field(ownerId: string, table: string, column: string, recordId: string) {
    return { ownerId, table, column, recordId, aadRevision: 1 };
  }
  private async group(session: Session, id: string) {
    await this.account(session);
    const row = await q(
      this.db,
      'SELECT * FROM import_groups WHERE owner_id=? AND id=?',
      session.subjectId,
      id,
    ).first<GroupRow>();
    if (!row) throw new RecordError(404, 'NOT_FOUND');
    await this.checked(session);
    return row;
  }
  private async items(session: Session, groupId: string) {
    return (
      await q(
        this.db,
        'SELECT * FROM import_items WHERE owner_id=? AND group_id=? ORDER BY ordinal',
        session.subjectId,
        groupId,
      ).all<ItemRow>()
    ).results;
  }
  private async aliases(owner: string) {
    return (
      await q(this.db, 'SELECT * FROM import_identities WHERE owner_id=?', owner).all<AliasRow>()
    ).results;
  }
  private async disposition(
    _session: Session,
    unit: Unit,
    header: Header,
    hashes: Awaited<ReturnType<typeof importHashers>>,
    aliases: AliasRow[],
    native: Awaited<ReturnType<typeof nativeImport>>,
  ) {
    const identity = effectiveIdentity(unit.identity, header),
      key = await hashes.key(identity),
      entity = await hashes.entity(identity),
      content = await hashes.content(unit);
    let prior = aliases.find((a) => a.source_key_hmac === key);
    if (!prior && native?.matches)
      prior = {
        ...native.destination,
        source_key_hmac: key,
        source_entity_hmac: entity,
        original_hmac: content,
        erased_at: null,
        withheld_at: null,
        materialized: 0,
        source_record_enc: null,
        native: true,
      };
    let state = aliases.some((a) => a.source_entity_hmac === entity && a.erased_at !== null)
      ? 'erased'
      : prior
        ? prior.original_hmac === content
          ? 'duplicate'
          : 'conflict'
        : 'ready';
    if (prior?.withheld_at !== null && prior?.withheld_at !== undefined && prior.erased_at === null)
      state = 'conflict';
    if (!prior && native && !native.matches)
      state = 'erased' in native && native.erased ? 'erased' : 'conflict';
    if (header.recovery.kind !== 'none') {
      const previous = { ...unit.identity, source: header.recovery.previousSource };
      const previousKey = await hashes.key(previous),
        previousEntity = await hashes.entity(previous);
      const valid =
        header.recovery.kind === 'new_revision'
          ? aliases.some((a) => a.source_key_hmac === previousKey && a.erased_at === null)
          : aliases.some((a) => a.source_entity_hmac === previousEntity && a.erased_at !== null);
      if (!valid) state = 'invalid';
    }
    return { key, entity, content, state, duplicate: state === 'duplicate' ? prior! : null };
  }
  async preview(session: Session, key: string, input: ImportWrite) {
    const account = await this.account(session),
      mutation = await this.mutation(session, key, 'imports.preview', input);
    if (mutation.existing) return this.previewResult(session, mutation.existing);
    let chunk: z.infer<typeof ImportChunkDocument>;
    const header = ImportHeader.parse({ source: input.source, recovery: input.recovery });
    try {
      assertRecovery(header.source, header.recovery);
      const source =
        header.recovery.kind === 'none' ? header.source : header.recovery.previousSource;
      const parsed = await parseImport({ ...input, source });
      if (parsed.errors.length || !parsed.units.length) throw new Error('IMPORT_INVALID');
      if (input.format === 'reflection-portable-chunk.v1')
        chunk = ImportChunkDocument.parse(JSON.parse(input.document));
      else {
        const groups = await buildImportGroups(parsed.units, () => crypto.randomUUID());
        if (groups.length !== 1 || groups[0]!.chunks.length !== 1)
          throw new Error('IMPORT_INVALID');
        chunk = ImportChunkDocument.parse(JSON.parse(groups[0]!.chunks[0]!.document));
      }
    } catch (error) {
      throw new RecordError(
        error instanceof Error && error.message === 'INPUT_TOO_LARGE' ? 413 : 422,
        error instanceof Error && error.message === 'INPUT_TOO_LARGE'
          ? 'INPUT_TOO_LARGE'
          : 'IMPORT_INVALID',
      );
    }
    const hashes = await importHashers(this, session.subjectId, account.key_version),
      aliases = await this.aliases(session.subjectId);
    const natives =
      header.recovery.kind === 'none'
        ? await nativeImports(
            this,
            session,
            chunk.items.map((item) => item.unit),
          )
        : new Map();
    const existing = await q(
      this.db,
      'SELECT * FROM import_groups WHERE owner_id=? AND id=?',
      session.subjectId,
      chunk.groupId,
    ).first<GroupRow>();
    if (existing) {
      if (
        existing.state !== 'staged' ||
        existing.expires_at <= Date.now() ||
        existing.manifest_hash !== chunk.manifestHash ||
        existing.total_items !== chunk.unitCount ||
        !existing.header_enc
      )
        throw new RecordError(409, 'CONFLICT');
      const previous = await this.opened(
        this.field(session.subjectId, 'import_groups', 'header_enc', existing.id),
        existing.header_enc,
        ImportHeader,
      );
      if (!same(previous, header)) throw new RecordError(409, 'CONFLICT');
    }
    const id = crypto.randomUUID(),
      statements: D1PreparedStatement[] = [];
    let additionalBytes = 2048;
    const headerBody = !existing
      ? await this.crypt.seal(
          this.field(session.subjectId, 'import_groups', 'header_enc', chunk.groupId),
          header,
          account.key_version,
        )
      : null;
    if (headerBody) additionalBytes += 1024 + encryptedBytes(headerBody);
    if (!existing)
      statements.push(
        q(
          this.db,
          `INSERT INTO import_groups(id,owner_id,manifest_hash,total_items,state,header_enc,recovery_hmac,key_version,created_at,expires_at,outcome_expires_at) VALUES(?,?,?,?,'staged',?,?,?,${DB_NOW},${DB_NOW}+${DAY},${DB_NOW}+${7 * DAY})`,
          chunk.groupId,
          session.subjectId,
          chunk.manifestHash,
          chunk.unitCount,
          headerBody,
          await hashes.recovery(header.recovery),
          account.key_version,
        ),
      );
    else
      statements.push(
        assertion(
          this.db,
          `EXISTS(SELECT 1 FROM import_groups WHERE owner_id=? AND id=? AND state='staged' AND expires_at>${DB_NOW})`,
          session.subjectId,
          chunk.groupId,
        ),
      );
    statements.push(
      q(
        this.db,
        `INSERT INTO import_batches(id,owner_id,source_format,document_hmac,state,created_at,expires_at) VALUES(?,?,?,?,'preview',${DB_NOW},${DB_NOW}+${DAY})`,
        id,
        session.subjectId,
        input.format,
        mutation.payloadHash,
      ),
    );
    for (const [index, item] of chunk.items.entries()) {
      const disposition = await this.disposition(
        session,
        item.unit,
        header,
        hashes,
        aliases,
        natives.get(item.unit) ?? null,
      );
      const encrypted = await this.crypt.seal(
        this.field(session.subjectId, 'import_items', 'body_enc', `${id}:${index}`),
        { unit: item.unit, header },
        account.key_version,
      );
      statements.push(
        q(
          this.db,
          'INSERT INTO import_items(batch_id,owner_id,item_index,source_key_hmac,source_entity_hmac,original_hmac,body_enc,key_version,state,group_id,ordinal) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          id,
          session.subjectId,
          index,
          disposition.key,
          disposition.entity,
          disposition.content,
          encrypted,
          account.key_version,
          disposition.state,
          chunk.groupId,
          item.ordinal,
        ),
      );
      const prior = aliases.find((a) => a.source_key_hmac === disposition.key);
      const copies = copyLinks(this, session.subjectId, 'item', `${id}:${index}`, [
        ...nativeLinks(session.subjectId, item.unit),
        ...(prior ? destinationLinks(prior) : []),
      ]);
      statements.push(...copies);
      additionalBytes += 1024 + encryptedBytes(encrypted) + 1024 * copies.length;
    }
    statements.push(mutation.insert(id));
    if (account.storage_bytes + additionalBytes > 20971520)
      throw new RecordError(409, 'STORAGE_LIMIT_EXCEEDED');
    try {
      await this.atomic(session, [
        assertion(
          this.db,
          'EXISTS(SELECT 1 FROM accounts WHERE id=? AND data_revision=?)',
          session.subjectId,
          account.data_revision,
        ),
        ...statements,
      ]);
    } catch (error) {
      await this.checked(session);
      const replay = await this.mutation(session, key, 'imports.preview', input);
      if (replay.existing) return this.previewResult(session, replay.existing);
      if ((await this.account(session)).storage_bytes + additionalBytes > 20971520)
        throw new RecordError(409, 'STORAGE_LIMIT_EXCEEDED');
      throw error;
    }
    return this.previewResult(session, id);
  }
  private async previewResult(session: Session, id: string) {
    const account = await this.account(session),
      batch = await q(
        this.db,
        'SELECT * FROM import_batches WHERE owner_id=? AND id=?',
        session.subjectId,
        id,
      ).first<{ expires_at: number }>();
    if (!batch) throw new RecordError(404, 'NOT_FOUND');
    if (batch.expires_at <= Date.now()) throw new RecordError(410, 'CONTENT_UNAVAILABLE');
    const rows = (
      await q(
        this.db,
        'SELECT * FROM import_items WHERE owner_id=? AND batch_id=? ORDER BY item_index',
        session.subjectId,
        id,
      ).all<ItemRow>()
    ).results;
    if (!rows.length || rows.some((r) => !r.body_enc || r.withheld_at !== null))
      throw new RecordError(410, 'CONTENT_UNAVAILABLE');
    const bodies = await Promise.all(
      rows.map((r) =>
        this.opened(
          this.field(session.subjectId, 'import_items', 'body_enc', itemId(r)),
          r.body_enc!,
          ImportItemBody,
        ),
      ),
    );
    const header = bodies[0]!.header,
      hashes = await importHashers(this, session.subjectId, account.key_version);
    const previewHash = await hashes.acknowledgement([
      'chunk',
      session.epoch,
      id,
      header,
      bodies,
      rows.map((r) => r.state),
    ]);
    await this.checked(session, account.data_revision);
    return apiSchemas.ImportPreview.parse({
      id,
      expiresAt: iso(batch.expires_at),
      ...header,
      previewHash,
      items: rows.map((r, i) => ({
        index: r.item_index,
        status: r.state === 'imported' ? 'duplicate' : r.state,
        identity: effectiveIdentity(bodies[i]!.unit.identity, header),
        originalId:
          bodies[i]!.unit.kind === 'legacy-authored' ? null : bodies[i]!.unit.record.originalId,
        error: ['ready', 'duplicate', 'imported'].includes(r.state) ? null : r.state,
      })),
    });
  }
  private async reviewed(session: Session, group: GroupRow) {
    if (!group.header_enc || group.expires_at <= Date.now())
      throw new RecordError(410, 'CONTENT_UNAVAILABLE');
    const header = await this.opened(
        this.field(session.subjectId, 'import_groups', 'header_enc', group.id),
        group.header_enc,
        ImportHeader,
      ),
      rows = await this.items(session, group.id);
    if (
      rows.length !== group.total_items ||
      rows.some((r, i) => r.ordinal !== i || !r.body_enc || r.withheld_at !== null)
    )
      return null;
    const bodies = await Promise.all(
      rows.map((r) =>
        this.opened(
          this.field(session.subjectId, 'import_items', 'body_enc', itemId(r)),
          r.body_enc!,
          ImportItemBody,
        ),
      ),
    );
    if (bodies.some((b) => !same(b.header, header))) throw new RecordError(409, 'CONFLICT');
    const source = header.recovery.kind === 'none' ? header.source : header.recovery.previousSource;
    const chunks: ImportWrite[] = [];
    for (let offset = 0; offset < rows.length; offset += 100)
      chunks.push({
        format: 'reflection-portable-chunk.v1',
        source,
        recovery: { kind: 'none' },
        document: JSON.stringify({
          format: 'reflection-portable-chunk.v1',
          groupId: group.id,
          manifestHash: group.manifest_hash,
          unitCount: group.total_items,
          items: bodies
            .slice(offset, offset + 100)
            .map((b, i) => ({ ordinal: offset + i, unit: b.unit })),
        }),
      });
    let units: Unit[];
    try {
      units = await verifyImportGroup(chunks);
    } catch {
      throw new RecordError(422, 'IMPORT_INVALID');
    }
    const account = await this.account(session),
      hashes = await importHashers(this, session.subjectId, account.key_version);
    const hash = await hashes.acknowledgement([
      'group',
      session.epoch,
      group.id,
      group.manifest_hash,
      header,
      rows.map((r) => [r.ordinal, r.source_key_hmac, r.original_hmac, r.state]),
    ]);
    return { rows, units, header, hash, account, hashes };
  }
  async groupStatus(session: Session, id: string) {
    const group = await this.group(session, id);
    let state = group.state,
      hash = group.preview_hmac;
    if (['staged', 'committing'].includes(state)) {
      if (group.expires_at <= Date.now()) state = 'expired';
      else hash = (await this.reviewed(session, group))?.hash ?? null;
    }
    await this.checked(session);
    return apiSchemas.ImportGroupStatus.parse({
      groupId: id,
      state,
      manifestHash: group.manifest_hash,
      previewHash: hash,
      totalItems: group.total_items,
      completedItems: state === 'complete' ? group.total_items : 0,
      nextCursor:
        state === 'complete' || state === 'failed'
          ? await this.cursor(session, ['imports', id], 0)
          : null,
    });
  }
  async groupResults(session: Session, id: string, cursor: string | null) {
    const group = await this.group(session, id),
      account = await this.account(session);
    const start = cursor
      ? await this.parseCursor(session, ['imports', id], cursor, z.number().int().min(0).max(20480))
      : 0;
    const rows = (await this.items(session, id)).filter((r) => r.ordinal >= start).slice(0, 101),
      items: ItemResult[] = [];
    if (!['complete', 'failed'].includes(group.state))
      return apiSchemas.ImportGroupResultPage.parse({ groupId: id, items: [], nextCursor: null });
    for (const row of rows.slice(0, 100))
      items.push(
        row.result_enc && row.withheld_at === null && group.outcome_expires_at > Date.now()
          ? await this.opened(
              this.field(session.subjectId, 'import_items', 'result_enc', itemId(row)),
              row.result_enc,
              apiSchemas.ImportGroupResultPage.shape.items.element,
            )
          : {
              index: row.ordinal,
              identity: null,
              status:
                row.state === 'duplicate'
                  ? 'duplicate'
                  : row.state === 'imported'
                    ? 'imported'
                    : 'failed',
              sessionId: null,
              errorCode: 'CONTENT_UNAVAILABLE',
            },
      );
    await this.checked(session, account.data_revision);
    return apiSchemas.ImportGroupResultPage.parse({
      groupId: id,
      items,
      nextCursor:
        rows.length > 100
          ? await this.cursor(session, ['imports', id], rows[99]!.ordinal + 1)
          : null,
    });
  }
  async commitGroup(session: Session, id: string, key: string, input: Commit) {
    const group = await this.group(session, id),
      account = await this.account(session);
    const mutation = await this.mutation(session, key, 'imports.commit', { groupId: id, ...input });
    if (mutation.existing && mutation.existing !== id)
      throw new RecordError(409, 'IDEMPOTENCY_MISMATCH');
    const hashes = await importHashers(this, session.subjectId, account.key_version);
    if (
      input.manifestHash !== group.manifest_hash ||
      (await hashes.recovery(input.confirmedRecovery)) !== group.recovery_hmac
    )
      throw new RecordError(409, 'CONFLICT');
    if (group.state === 'complete' || group.state === 'failed') {
      if (input.previewHash !== group.preview_hmac) throw new RecordError(409, 'CONFLICT');
      if (!mutation.existing)
        await this.atomic(session, [
          mutation.insert(id),
          q(
            this.db,
            `UPDATE import_groups SET outcome_expires_at=max(outcome_expires_at,${DB_NOW}+${7 * DAY}) WHERE owner_id=? AND id=?`,
            session.subjectId,
            id,
          ),
        ]);
      return this.groupStatus(session, id);
    }
    if (!account.recovery_ack_at) throw new RecordError(403, 'FORBIDDEN');
    const reviewed = await this.reviewed(session, group);
    if (!reviewed || input.previewHash !== reviewed.hash) throw new RecordError(409, 'CONFLICT');
    const aliases = await this.aliases(session.subjectId),
      entries = [];
    const natives =
      reviewed.header.recovery.kind === 'none'
        ? await nativeImports(this, session, reviewed.units)
        : new Map();
    for (const [i, unit] of reviewed.units.entries()) {
      const row = reviewed.rows[i]!,
        actual = await this.disposition(
          session,
          unit,
          reviewed.header,
          reviewed.hashes,
          aliases,
          natives.get(unit) ?? null,
        );
      if (
        actual.state !== row.state ||
        actual.content !== row.original_hmac ||
        actual.key !== row.source_key_hmac ||
        !['ready', 'duplicate'].includes(actual.state)
      )
        throw new RecordError(409, 'CONFLICT');
      entries.push({ row, unit, duplicate: actual.duplicate });
    }
    const prepared = await materializeImport(
      this,
      session.subjectId,
      account.key_version,
      reviewed.header,
      entries,
      aliases,
    );
    const statements = [...prepared.statements];
    let additionalBytes = prepared.additionalBytes + (!mutation.existing ? 1024 : 0);
    const sealAddition = async (field: Parameters<typeof this.crypt.seal>[0], value: unknown) => {
      const body = await this.crypt.seal(field, value, account.key_version);
      additionalBytes += encryptedBytes(body);
      return body;
    };
    for (const [i, entry] of entries.entries()) {
      const dest = prepared.destinations[i]!,
        body = { unit: entry.unit, header: reviewed.header };
      if (!entry.duplicate || entry.duplicate.native) {
        additionalBytes += 1024;
        statements.push(
          q(
            this.db,
            'INSERT INTO import_identities(owner_id,source_key_hmac,source_entity_hmac,original_hmac,entity_kind,session_id,edition_id,reflection_id,reflection_revision,revisit_id,revisit_revision,source_record_enc,key_version,materialized) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            session.subjectId,
            entry.row.source_key_hmac,
            entry.row.source_entity_hmac,
            entry.row.original_hmac,
            dest.entity_kind,
            dest.session_id,
            dest.edition_id,
            dest.reflection_id,
            dest.reflection_revision,
            dest.revisit_id,
            dest.revisit_revision,
            await sealAddition(
              this.field(
                session.subjectId,
                'import_identities',
                'source_record_enc',
                entry.row.source_key_hmac,
              ),
              body,
            ),
            account.key_version,
            entry.duplicate?.native ? 0 : 1,
          ),
        );
      }
      const result: ItemResult = {
        index: entry.row.ordinal,
        identity: effectiveIdentity(entry.unit.identity, reviewed.header),
        status: entry.duplicate ? 'duplicate' : 'imported',
        sessionId: dest.session_id,
        errorCode: null,
      };
      const links = [
        ...destinationLinks(dest),
        ...nativeLinks(session.subjectId, entry.unit),
        ...prepared.provenance[i]!,
      ];
      const copies = [
        ...(!entry.duplicate || entry.duplicate.native
          ? copyLinks(this, session.subjectId, 'alias', entry.row.source_key_hmac, links)
          : []),
        ...copyLinks(this, session.subjectId, 'item', itemId(entry.row), links),
      ];
      additionalBytes += copies.length * 1024;
      statements.push(...copies);
      statements.push(
        q(
          this.db,
          'UPDATE import_items SET state=?,session_id=?,result_enc=? WHERE owner_id=? AND batch_id=? AND item_index=?',
          result.status,
          dest.session_id,
          await sealAddition(
            this.field(session.subjectId, 'import_items', 'result_enc', itemId(entry.row)),
            result,
          ),
          session.subjectId,
          entry.row.batch_id,
          entry.row.item_index,
        ),
      );
    }
    statements.push(
      q(
        this.db,
        `UPDATE import_groups SET state='complete',preview_hmac=?,outcome_expires_at=${DB_NOW}+${7 * DAY} WHERE owner_id=? AND id=?`,
        reviewed.hash,
        session.subjectId,
        id,
      ),
      q(
        this.db,
        "UPDATE import_batches SET state='complete' WHERE owner_id=? AND id IN (SELECT batch_id FROM import_items WHERE group_id=? AND owner_id=?)",
        session.subjectId,
        id,
        session.subjectId,
      ),
    );
    if (account.storage_bytes + additionalBytes > 20971520)
      throw new RecordError(409, 'STORAGE_LIMIT_EXCEEDED');
    await this.atomic(session, [
      assertion(
        this.db,
        'EXISTS(SELECT 1 FROM accounts WHERE id=? AND data_revision=?)',
        session.subjectId,
        reviewed.account.data_revision,
      ),
      assertion(
        this.db,
        `EXISTS(SELECT 1 FROM import_groups WHERE owner_id=? AND id=? AND state IN('staged','committing') AND expires_at>${DB_NOW})`,
        session.subjectId,
        id,
      ),
      q(
        this.db,
        "UPDATE import_groups SET state='committing',preview_hmac=? WHERE owner_id=? AND id=?",
        reviewed.hash,
        session.subjectId,
        id,
      ),
      ...(!mutation.existing ? [mutation.insert(id)] : []),
    ]);
    try {
      await this.atomic(session, [
        assertion(
          this.db,
          'EXISTS(SELECT 1 FROM accounts WHERE id=? AND data_revision=?)',
          session.subjectId,
          reviewed.account.data_revision + 1,
        ),
        assertion(
          this.db,
          `EXISTS(SELECT 1 FROM import_groups WHERE owner_id=? AND id=? AND state='committing' AND expires_at>${DB_NOW})`,
          session.subjectId,
          id,
        ),
        ...statements,
      ]);
    } catch {
      await this.checked(session);
      const current = await this.group(session, id);
      if (current.state === 'complete') return this.groupStatus(session, id);
      if (current.state === 'failed') return this.groupStatus(session, id);
      const failed: D1PreparedStatement[] = [];
      for (const entry of entries) {
        const result: ItemResult = {
          index: entry.row.ordinal,
          identity: effectiveIdentity(entry.unit.identity, reviewed.header),
          status: 'failed',
          sessionId: null,
          errorCode: 'CONFLICT',
        };
        failed.push(
          q(
            this.db,
            "UPDATE import_items SET state='failed',body_enc=NULL,result_enc=?,session_id=NULL,error_code='CONFLICT' WHERE owner_id=? AND batch_id=? AND item_index=?",
            await this.crypt.seal(
              this.field(session.subjectId, 'import_items', 'result_enc', itemId(entry.row)),
              result,
              account.key_version,
            ),
            session.subjectId,
            entry.row.batch_id,
            entry.row.item_index,
          ),
        );
      }
      await this.atomic(session, [
        assertion(
          this.db,
          "EXISTS(SELECT 1 FROM import_groups WHERE owner_id=? AND id=? AND state='committing')",
          session.subjectId,
          id,
        ),
        ...failed,
        q(
          this.db,
          `UPDATE import_groups SET state='failed',header_enc=NULL,outcome_expires_at=${DB_NOW}+${7 * DAY} WHERE owner_id=? AND id=?`,
          session.subjectId,
          id,
        ),
      ]);
      return this.groupStatus(session, id);
    }
    return this.groupStatus(session, id);
  }
}
