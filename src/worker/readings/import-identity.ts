import { ImportUnit, type PortableRecord } from '../../contracts/index.ts';
import { canonicalJson } from '../../domain/json.ts';
import {
  importEntityInput,
  importKeyInput,
  identityKey,
  sameSource,
} from '../../domain/imports/identity.ts';
import { field, raw, readJson } from '../../domain/imports/json.ts';
import type { Identity, Unit, Recovery, Source } from '../../domain/imports/types.ts';
import { statement as q } from '../db/core.ts';
import type { Session } from '../identity/types.ts';
import { type RecordBase, RecordError } from './base.ts';
import { ReadingExports } from './export.ts';
import type { ImportTarget } from './import-targets.ts';
import type { z } from 'zod';

export async function importIndex(base: RecordBase, owner: string, id: Identity, version?: number) {
  const hash = (value: unknown) =>
    version === undefined
      ? base.crypt.hash(owner, 'import', value)
      : base.crypt.hashVersion(owner, 'import', value, version);
  const [key, entity] = await Promise.all([hash(importKeyInput(id)), hash(importEntityInput(id))]);
  return { key, entity };
}
export function effectiveImportUnit(unit: Unit, source: Source, recovery: Recovery): Unit {
  if (sameSource(unit.identity.source, source)) return unit;
  if (recovery.kind === 'none' || !sameSource(unit.identity.source, recovery.previousSource))
    throw new RecordError(422, 'IMPORT_INVALID');
  const remap = <T extends { source: Source }>(identity: T): T =>
    sameSource(identity.source, recovery.previousSource) ? { ...identity, source } : identity;
  const identity = remap(unit.identity),
    parentIdentity = unit.parentIdentity && remap(unit.parentIdentity);
  const common = {
    identity,
    parentIdentity,
    key: identityKey(identity),
    dependencies: unit.dependencies.map(remap),
  };
  return ImportUnit.parse({
    ...unit,
    ...common,
    record: { ...unit.record, identity, ...(unit.kind === 'portable' ? {} : { parentIdentity }) },
  });
}
function originalContent(unit: Unit) {
  if (
    unit.kind === 'legacy-reading' ||
    (unit.kind === 'portable' &&
      unit.record.kind === 'reading' &&
      unit.record.value.kind === 'legacy.imported.v1')
  ) {
    const body =
      unit.kind === 'legacy-reading'
        ? unit.record
        : (
            unit.record.value as {
              kind: 'legacy.imported.v1';
              record: Extract<Unit, { kind: 'legacy-reading' }>['record'];
            }
          ).record;
    const { identity: _identity, parentIdentity: _parent, ...content } = body;
    return ['legacy-reading', content];
  }
  if (unit.kind === 'legacy-authored') {
    const { identity: _identity, parentIdentity: _parent, ...content } = unit.record;
    return ['legacy-authored', content];
  }
  if (unit.record.kind === 'reflection' && unit.record.importedOriginal) {
    const {
      identity: _identity,
      parentIdentity: _parent,
      ...content
    } = unit.record.importedOriginal;
    if (content.text !== unit.record.value.text || unit.record.value.stance !== 'unspecified')
      throw new RecordError(422, 'IMPORT_INVALID');
    return ['legacy-authored', content];
  }
  const value = field(readJson(unit.originalJsonText), 'value');
  if (!value) throw new RecordError(422, 'IMPORT_INVALID');
  return [
    'portable',
    unit.record.kind,
    unit.record.originalId,
    unit.record.value,
    raw(unit.originalJsonText, value),
  ];
}
export interface AliasRow {
  source_key_hmac: string;
  source_entity_hmac: string;
  original_hmac: string;
  erased_at: number | null;
  entity_kind: ImportTarget['kind'];
  session_id: string | null;
  edition_id: string | null;
  reflection_id: string | null;
  reflection_revision: number | null;
  revisit_id: string | null;
  revisit_revision: number | null;
  source_record_enc: string | null;
}
export function aliasTarget(row: AliasRow): ImportTarget {
  return {
    kind: row.entity_kind,
    sessionId: row.session_id,
    editionId: row.edition_id,
    reflectionId: row.reflection_id,
    reflectionRevision: row.reflection_revision,
    revisitId: row.revisit_id,
    revisitRevision: row.revisit_revision,
  };
}
function nativeTarget(record: z.infer<typeof PortableRecord>): ImportTarget {
  switch (record.kind) {
    case 'session':
      return { kind: 'session', sessionId: record.value.id };
    case 'reading':
      return {
        kind: 'edition',
        sessionId: record.value.sessionId,
        editionId: record.value.editionId,
      };
    case 'reflection':
      return {
        kind: 'reflection_revision',
        sessionId: record.value.sessionId,
        reflectionId: record.value.id,
        reflectionRevision: record.value.revision,
      };
    case 'revisit':
      return {
        kind: 'revisit',
        sessionId: 'sessionId' in record.value ? record.value.sessionId : null,
        revisitId: record.value.id,
        revisitRevision: 'revision' in record.value ? record.value.revision : 1,
      };
    case 'generation_receipt':
      return { kind: 'receipt', sessionId: null };
    case 'permission':
    case 'grant':
      return { kind: record.kind, sessionId: null };
  }
}
type Ready = 'ready' | 'duplicate' | 'conflict' | 'erased' | 'invalid';
export async function classifyImport(
  base: RecordBase,
  session: Session,
  unit: Unit,
  source: Source,
  recovery: Recovery,
  version: number,
) {
  const owner = session.subjectId,
    id = unit.identity;
  const [{ key, entity }, original] = await Promise.all([
    importIndex(base, owner, id, version),
    base.crypt.hashVersion(owner, 'import', ['import-original.v1', originalContent(unit)], version),
  ]);
  const aliases = await q(
    base.db,
    'SELECT * FROM import_identities WHERE owner_id=? AND source_entity_hmac=?',
    owner,
    entity,
  ).all<AliasRow>();
  const exact = aliases.results.find((r) => r.source_key_hmac === key);
  let state: Ready = 'ready',
    duplicate: ImportTarget | null = null;
  if (aliases.results.some((r) => r.erased_at !== null)) state = 'erased';
  else if (exact) {
    state = exact.original_hmac === original ? 'duplicate' : 'conflict';
    if (state === 'duplicate') duplicate = aliasTarget(exact);
  } else if (recovery.kind === 'none' && aliases.results.length) {
    const same = aliases.results.find((r) => r.original_hmac === original);
    if (same) {
      state = 'duplicate';
      duplicate = aliasTarget(same);
    } else state = 'conflict';
  }
  if (recovery.kind !== 'none') {
    const prior = await importIndex(
      base,
      owner,
      { ...id, source: recovery.previousSource },
      version,
    );
    if (recovery.kind === 'new_revision') {
      const priorAlias = await q(
        base.db,
        'SELECT 1 AS n FROM import_identities WHERE owner_id=? AND source_key_hmac=? AND erased_at IS NULL',
        owner,
        prior.key,
      ).first();
      if (
        source.namespaceId !== recovery.previousSource.namespaceId ||
        source.revision === recovery.previousSource.revision ||
        !priorAlias
      )
        state = 'invalid';
    } else {
      const priorErased = await q(
        base.db,
        'SELECT 1 AS n FROM import_identities WHERE owner_id=? AND source_entity_hmac=? AND erased_at IS NOT NULL',
        owner,
        prior.entity,
      ).first();
      if (source.namespaceId === recovery.previousSource.namespaceId || !priorErased)
        state = 'invalid';
    }
  }
  const ownNative =
    source.namespaceId === owner &&
    (source.revision === 'native-v1' || /^snapshot-\d+$/.test(source.revision));
  if (
    state === 'ready' &&
    !exact &&
    unit.kind === 'portable' &&
    (unit.record.kind === 'session' || ownNative)
  ) {
    const native = await new ReadingExports(base).nativeRecord(session, id);
    if (native) {
      if (
        native.originalId === unit.record.originalId &&
        canonicalJson(native.value) === canonicalJson(unit.record.value)
      ) {
        state = 'duplicate';
        duplicate = nativeTarget(native);
      } else
        state =
          native.kind === 'reading' && native.value.kind === 'reading.unavailable.v1'
            ? 'erased'
            : 'conflict';
    } else if (ownNative) state = 'conflict';
  }
  return { key, entity, original, state, duplicate, alreadyAliased: !!exact };
}
export function importCopySources(unit: Unit): Identity[] {
  const { source } = unit.identity;
  const refs: Identity[] = [];
  const add = (kind: Identity['kind'], recordId: string, recordRevision: number) =>
    refs.push({ source, kind, recordId, recordRevision });
  if (unit.kind === 'portable') {
    const r = unit.record;
    if (r.kind === 'session') add('session', r.value.id, 1);
    if (
      r.kind === 'reading' ||
      r.kind === 'reflection' ||
      (r.kind === 'revisit' && 'sessionId' in r.value)
    ) {
      const value = r.value as { sessionId: string };
      add('session', value.sessionId, 1);
    }
    if (r.kind === 'revisit') {
      add('revisit', r.value.id, 0);
      add('revisit', r.value.id, 'revision' in r.value ? r.value.revision : 1);
    }
    if (r.kind === 'reading') add('reading', r.value.editionId, 1);
    const selected =
      r.kind === 'generation_receipt'
        ? r.value.selectedFragments
        : r.kind === 'reading' && 'provenance' in r.value
          ? r.value.provenance.selected
          : undefined;
    for (const f of selected ?? [])
      if ('sourceKind' in f) {
        if (f.sourceKind === 'revisit_revision') add('revisit', f.sourceId, 0);
        add(
          f.sourceKind === 'edition'
            ? 'reading'
            : f.sourceKind === 'reflection_revision'
              ? 'reflection'
              : 'revisit',
          f.sourceId,
          f.sourceKind === 'edition' ? 1 : f.sourceRevision,
        );
      }
  }
  return refs;
}
