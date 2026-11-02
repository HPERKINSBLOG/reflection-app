import {
  ImportUnit,
  ImportChunkDocument,
  ImportRecordIdentity,
  ImportSource,
  ImportRecovery,
  LegacyRecord,
  ExportPage,
  apiSchemas,
} from '../../contracts/index.ts';
import { IMPORT_LIMITS } from '../../contracts/import-policy.ts';
import { canonicalJson } from '../json.ts';
import { identityKey, importEntityInput, sameSource } from './identity.ts';
import { readJson, raw, field, textField, projectFields, type JsonNode } from './json.ts';
import { utf8, rawHash, assertRecordSize, common, groupKey, readingUnit } from './legacy.ts';
import { normalizeTarot, assertTarotProjection } from './tarot.ts';
import type { FileInput, NormalizedImport, Unit, Identity } from './types.ts';

export async function parseImport(input: FileInput): Promise<NormalizedImport> {
  if (
    input.document.length > IMPORT_LIMITS.documentUnits ||
    utf8.encode(JSON.stringify(input)).length > IMPORT_LIMITS.bodyBytes
  )
    throw new Error('INPUT_TOO_LARGE');
  try {
    apiSchemas.ImportWrite.parse(input);
  } catch {
    throw new Error('IMPORT_INVALID');
  }
  const result = await parseImportFile(input);
  if (result.units.length > IMPORT_LIMITS.previewItems) throw new Error('INPUT_TOO_LARGE');
  return result;
}

export async function parseImportFile(input: FileInput): Promise<NormalizedImport> {
  if (utf8.encode(input.document).length > IMPORT_LIMITS.fileBytes)
    throw new Error('INPUT_TOO_LARGE');
  const source = ImportSource.parse(input.source),
    recovery = ImportRecovery.parse(input.recovery);
  const result: NormalizedImport = { source, recovery, units: [], errors: [] };
  if (input.format === 'pixel-json') throw new Error('IMPORT_INVALID: format not yet supported');
  try {
    if (input.format === 'reflection-export.v1') await normalizePortable(input.document, result);
    else {
      const root = readJson(input.document);
      if (input.format === 'reflection-portable-chunk.v1') {
        const chunk = ImportChunkDocument.parse(root.value),
          seen = new Set<number>();
        for (const item of chunk.items) {
          if (
            item.ordinal >= chunk.unitCount ||
            seen.has(item.ordinal) ||
            !sameSource(item.unit.identity.source, source)
          )
            throw new Error('IMPORT_INVALID');
          seen.add(item.ordinal);
          await validateUnit(item.unit);
          result.units.push(item.unit);
        }
      } else if (input.format === 'tarot-json')
        await normalizeTarot(input.document, root, source, result);
      else if (input.format === 'patternlike-export')
        await normalizePattern(input.document, root, result);
      else if (input.format === 'reflection-import.v1')
        await normalizeCanonical(input.document, root, result);
      else throw new Error('IMPORT_INVALID');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'INPUT_TOO_LARGE') throw error;
    throw new Error('IMPORT_INVALID');
  }
  const counts = new Map<string, number>();
  for (const unit of result.units) counts.set(unit.key, (counts.get(unit.key) ?? 0) + 1);
  result.units = result.units.filter((unit) => {
    if (counts.get(unit.key) !== 1) {
      result.errors.push({ pointer: unit.sourcePointer, code: 'IMPORT_INVALID' });
      return false;
    }
    return true;
  });
  const valid: Unit[] = [];
  for (const unit of result.units) {
    try {
      await validateUnit(unit);
      valid.push(unit);
    } catch (error) {
      result.errors.push({
        pointer: unit.sourcePointer,
        code:
          error instanceof Error && error.message === 'INPUT_TOO_LARGE'
            ? 'INPUT_TOO_LARGE'
            : 'IMPORT_INVALID',
      });
    }
  }
  result.units = valid;
  if (result.units.length > IMPORT_LIMITS.assemblyItems) throw new Error('INPUT_TOO_LARGE');
  return result;
}

export async function validateUnit(unit: Unit): Promise<void> {
  ImportUnit.parse(unit);
  const kind =
    unit.kind === 'legacy-reading'
      ? 'reading'
      : unit.kind === 'legacy-authored'
        ? 'reflection'
        : unit.record.kind;
  if (unit.identity.kind !== kind) throw new Error('IMPORT_INVALID');
  if (
    unit.kind === 'portable' &&
    unit.record.kind === 'reflection' &&
    unit.record.value.revision !== unit.identity.recordRevision
  )
    throw new Error('IMPORT_INVALID');
  if (
    unit.kind === 'portable' &&
    unit.record.kind === 'revisit' &&
    ('revision' in unit.record.value ? unit.record.value.revision : 1) !==
      unit.identity.recordRevision
  )
    throw new Error('IMPORT_INVALID');
  if (
    unit.key !== identityKey(unit.identity) ||
    canonicalJson(unit.identity) !== canonicalJson(unit.record.identity)
  )
    throw new Error('IMPORT_INVALID');
  if (
    unit.kind !== 'portable' &&
    canonicalJson(unit.parentIdentity) !== canonicalJson(unit.record.parentIdentity)
  )
    throw new Error('IMPORT_INVALID');
  if (
    unit.parentIdentity &&
    !unit.dependencies.some((d) => canonicalJson(d) === canonicalJson(unit.parentIdentity))
  )
    throw new Error('IMPORT_INVALID');
  const original = unit.kind === 'portable' ? unit.originalJsonText : unit.record.originalJsonText;
  const hash = unit.kind === 'portable' ? unit.originalSha256 : unit.record.originalSha256;
  if ((await rawHash(original)) !== hash) throw new Error('IMPORT_INVALID');
  const originalNode = readJson(original);
  if (
    unit.kind === 'legacy-reading' &&
    unit.record.source === 'tarot' &&
    hasNestedChildren(originalNode)
  )
    throw new Error('IMPORT_INVALID');
  if (unit.kind === 'legacy-reading' && unit.record.source === 'tarot')
    assertTarotProjection(originalNode, unit.parentIdentity !== null);
  if (unit.kind === 'legacy-authored' && originalNode.value !== unit.record.text)
    throw new Error('IMPORT_INVALID');
  if (unit.kind === 'portable' && canonicalJson(originalNode.value) !== canonicalJson(unit.record))
    throw new Error('IMPORT_INVALID');
  if (unit.kind === 'portable' && unit.record.kind === 'reflection' && unit.record.legacyAuthored) {
    const original = unit.record.legacyAuthored;
    if (
      (await rawHash(original.originalJsonText)) !== original.originalSha256 ||
      readJson(original.originalJsonText).value !== unit.record.value.text
    )
      throw new Error('IMPORT_INVALID');
  }
  if (
    unit.kind === 'portable' &&
    unit.record.kind === 'reading' &&
    unit.record.value.kind === 'legacy.imported.v1'
  ) {
    const embedded = unit.record.value.record;
    if (
      (await rawHash(embedded.originalJsonText)) !== embedded.originalSha256 ||
      (embedded.source === 'tarot' && hasNestedChildren(readJson(embedded.originalJsonText)))
    )
      throw new Error('IMPORT_INVALID');
    if (embedded.source === 'tarot')
      assertTarotProjection(readJson(embedded.originalJsonText), embedded.parentIdentity !== null);
  }
  if (
    unit.kind === 'portable' &&
    unit.record.kind === 'reading' &&
    unit.record.value.kind.startsWith('tarot.accepted')
  )
    assertRecordSize(unit.record.value, true);
  // Include all normalized identity/provenance/transport fields in the 192 KiB admission.
  assertRecordSize(unit);
}

async function normalizeCanonical(document: string, root: JsonNode, result: NormalizedImport) {
  if (
    field(root, 'format')?.value !== 'reflection-import.v1' ||
    !Array.isArray(field(root, 'records')?.value)
  )
    throw new Error('IMPORT_INVALID');
  for (const [index, node] of field(root, 'records')!.elements.entries()) {
    const pointer = `/records/${index}`;
    try {
      const record = LegacyRecord.parse(node.value);
      if (record.identity.kind !== 'reading' || !sameSource(record.identity.source, result.source))
        throw new Error('IMPORT_INVALID');
      const original = readJson(record.originalJsonText);
      // Older canonical Tarot envelopes containing nested children need the raw adapter,
      // not an opaque parent copy which would defeat independent child deletion.
      if (record.source === 'tarot' && hasNestedChildren(original))
        throw new Error('IMPORT_INVALID');
      const unit = ImportUnit.parse({
        ...common(
          record.identity,
          record.parentIdentity,
          pointer,
          groupKey(record.parentIdentity ?? record.identity),
        ),
        kind: 'legacy-reading',
        rawScope: 'selected-fields.v1',
        record,
      });
      await validateUnit(unit);
      result.units.push(unit);
    } catch (error) {
      result.errors.push({
        pointer,
        code:
          error instanceof Error && error.message === 'INPUT_TOO_LARGE'
            ? 'INPUT_TOO_LARGE'
            : 'IMPORT_INVALID',
      });
    }
  }
  void document;
}
function hasNestedChildren(node: JsonNode): boolean {
  return Boolean(
    field(node, 'journalContext') ||
      field(node, 'followUps')?.elements.length ||
      field(node, 'reflections')?.members.size ||
      field(node, 'cards')?.elements.some(
        (c) =>
          typeof field(c, 'userReflection')?.value === 'string' &&
          String(field(c, 'userReflection')!.value).trim(),
      ),
  );
}

async function normalizePattern(document: string, root: JsonNode, result: NormalizedImport) {
  if (!['0.7.0', '0.8.0'].includes(String(field(root, 'schema_version')?.value)))
    throw new Error('IMPORT_INVALID');
  const items = field(field(root, 'readings') ?? root, 'items');
  if (!items || !Array.isArray(items.value)) throw new Error('IMPORT_INVALID');
  const allowed = [
    'id',
    'local_date',
    'revision',
    'created_at',
    'updated_at',
    'artifact',
    'evidence',
    'status',
    'revision_reason',
    'supersedes_reading_id',
    'invalidated_at',
    'saved_at',
    'release_version',
    'contract_id',
    'assembly_mode',
  ];
  const privateKeys = new Set([
    'birth_profiles',
    'birthProfiles',
    'payments',
    'payment',
    'location',
    'location_data',
    'entitlements',
    'credentials',
    'provider_key',
    'api_key',
  ]);
  const privateField = (n: JsonNode): boolean =>
    [...n.members].some(([key, value]) => privateKeys.has(key) || privateField(value)) ||
    n.elements.some(privateField);
  for (const [index, node] of items.elements.entries()) {
    const pointer = `/readings/items/${index}`;
    try {
      if (privateField(node)) throw new Error('IMPORT_INVALID');
      const original = projectFields(document, node, allowed);
      const unit = await readingUnit(document, node, result.source, pointer, original, {
        originalId: textField(node, 'id'),
        parent: null,
        group: null,
        system: 'patternlike',
        ...(field(node, 'created_at') ? { time: field(node, 'created_at')! } : {}),
      });
      if (unit.kind === 'legacy-reading') {
        const revision = field(node, 'revision')?.value;
        if (revision !== undefined) {
          unit.identity = ImportRecordIdentity.parse({
            ...unit.identity,
            recordRevision: revision,
          });
          unit.record.identity = unit.identity;
          unit.key = identityKey(unit.identity);
        }
      }
      result.units.push(unit);
    } catch (error) {
      result.errors.push({
        pointer,
        code:
          error instanceof Error && error.message === 'INPUT_TOO_LARGE'
            ? 'INPUT_TOO_LARGE'
            : 'IMPORT_INVALID',
      });
    }
  }
}

async function normalizePortable(document: string, result: NormalizedImport) {
  let exportId: string | undefined, snapshot: number | undefined;
  const records: { node: JsonNode; line: string; pointer: string }[] = [];
  for (const [lineIndex, line] of document.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    if (utf8.encode(line).length > IMPORT_LIMITS.exportPageBytes)
      throw new Error('INPUT_TOO_LARGE');
    const root = readJson(line),
      page = ExportPage.parse(root.value);
    exportId ??= page.exportId;
    snapshot ??= page.snapshotRevision;
    if (exportId !== page.exportId || snapshot !== page.snapshotRevision)
      throw new Error('IMPORT_INVALID');
    for (const [index, node] of field(root, 'records')!.elements.entries())
      records.push({ node, line, pointer: `/pages/${lineIndex}/records/${index}` });
  }
  if (exportId === undefined) throw new Error('IMPORT_INVALID');
  const editions = new Map<string, string>(),
    identities = new Map<string, Identity>();
  const globalReferences = new Map<string, Identity | null>();
  const globalKey = (kind: string, id: string) => canonicalJson([kind, id]);
  const referenceKey = (source: Identity['source'], kind: string, id: string) =>
    canonicalJson([source, kind, id]);
  for (const { node } of records) {
    const record = node.value as {
      kind: string;
      identity: Identity;
      value: { id?: string; editionId?: string; sessionId?: string };
    };
    identities.set(
      referenceKey(
        record.identity.source,
        record.kind,
        record.value.id ?? record.value.editionId ?? record.identity.recordId,
      ),
      record.identity,
    );
    const global = globalKey(
      record.kind,
      record.value.id ?? record.value.editionId ?? record.identity.recordId,
    );
    const prior = globalReferences.get(global);
    globalReferences.set(
      global,
      prior === undefined ||
        (prior !== null &&
          sameSource(prior.source, record.identity.source) &&
          prior.recordId === record.identity.recordId)
        ? record.identity
        : null,
    );
    if (record.kind === 'reading' && record.value.sessionId && record.value.editionId)
      editions.set(
        canonicalJson([record.identity.source, record.value.editionId]),
        record.value.sessionId,
      );
  }
  for (const { node, line, pointer } of records) {
    const record = ExportPage.shape.records.element.parse(node.value),
      id = record.identity;
    if (record.kind !== id.kind) throw new Error('IMPORT_INVALID');
    const value = record.value as {
      sessionId?: string;
      editionId?: string;
      parentEditionId?: string | null;
      id?: string;
    };
    const session =
      record.kind === 'session'
        ? value.id
        : (value.sessionId ??
          (value.editionId
            ? editions.get(canonicalJson([id.source, value.editionId]))
            : undefined));
    const parentIdentity =
      record.kind === 'reading' && record.value.kind === 'legacy.imported.v1'
        ? record.value.record.parentIdentity
        : value.parentEditionId
          ? (identities.get(referenceKey(id.source, 'reading', value.parentEditionId)) ?? null)
          : null;
    const originalJsonText = raw(line, node);
    if (
      record.kind === 'reading' &&
      record.value.kind === 'legacy.imported.v1' &&
      record.value.record.source === 'tarot' &&
      hasNestedChildren(readJson(record.value.record.originalJsonText))
    ) {
      result.errors.push({ pointer, code: 'IMPORT_INVALID' });
      continue;
    }
    const unit = ImportUnit.parse({
      ...common(
        id,
        parentIdentity,
        pointer,
        canonicalJson(['portable-group.v1', id.source, session ?? id.recordId]),
      ),
      kind: 'portable',
      rawScope: 'whole-record.v1',
      record,
      originalJsonText,
      originalSha256: await rawHash(originalJsonText),
    });
    const add = (kind: Identity['kind'], recordId: string) => {
      const exact =
        identities.get(referenceKey(id.source, kind, recordId)) ??
        globalReferences.get(globalKey(kind, recordId));
      const dependency = exact ?? { source: id.source, kind, recordId, recordRevision: null };
      if (!unit.dependencies.some((d) => canonicalJson(d) === canonicalJson(dependency)))
        unit.dependencies.push(dependency);
    };
    if (record.kind !== 'session' && value.sessionId) add('session', value.sessionId);
    if (record.kind !== 'reading' && value.editionId) add('reading', value.editionId);
    if (value.parentEditionId) add('reading', value.parentEditionId);
    await validateUnit(unit);
    result.units.push(unit);
  }
}

/** Selection happens before transport; never retain an enclosing upload as provenance. */
export function selectImportUnits(input: NormalizedImport, keys: readonly string[]): Unit[] {
  if (new Set(keys).size !== keys.length) throw new Error('IMPORT_INVALID');
  const units = keys.map((key) => input.units.find((unit) => unit.key === key));
  if (units.some((unit) => !unit)) throw new Error('IMPORT_INVALID');
  return units as Unit[];
}
/** Pure projection only: P2 must apply the same ownership traversal to encrypted copies. */
export function eraseImportUnits(units: readonly Unit[], identity: Identity): Unit[] {
  const entity = canonicalJson(importEntityInput(identity));
  return units.filter((unit) => canonicalJson(importEntityInput(unit.identity)) !== entity);
}
