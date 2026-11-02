import { z } from 'zod';
import {
  ImportUnit,
  ImportSource,
  ImportRecovery,
  type apiSchemas,
} from '../../contracts/index.ts';
import { canonicalJson } from '../../domain/json.ts';
import { identityKey, importEntityInput, importKeyInput } from '../../domain/imports/identity.ts';
import type { Unit, Identity, Source, Recovery } from '../../domain/imports/types.ts';
import type { RecordBase } from './base.ts';

export const ImportHeader = z.strictObject({ source: ImportSource, recovery: ImportRecovery });
export const ImportItemBody = z.strictObject({ unit: ImportUnit, header: ImportHeader });
export type Header = z.infer<typeof ImportHeader>;
export type ItemResult = z.infer<typeof apiSchemas.ImportGroupResultPage>['items'][number];
export interface GroupRow {
  id: string;
  owner_id: string;
  manifest_hash: string;
  total_items: number;
  state: 'staged' | 'committing' | 'complete' | 'failed' | 'expired';
  header_enc: string | null;
  preview_hmac: string | null;
  recovery_hmac: string;
  key_version: number;
  expires_at: number;
  outcome_expires_at: number;
}
export interface ItemRow {
  withheld_at: number | null;
  batch_id: string;
  item_index: number;
  ordinal: number;
  group_id: string;
  source_key_hmac: string;
  source_entity_hmac: string;
  original_hmac: string;
  body_enc: string | null;
  result_enc: string | null;
  state: string;
  session_id: string | null;
}
export interface AliasRow {
  source_family_hmac?: string | null;
  record_revision?: number | null;
  source_key_hmac: string;
  source_entity_hmac: string;
  original_hmac: string;
  erased_at: number | null;
  entity_kind: string;
  session_id: string | null;
  edition_id: string | null;
  reflection_id: string | null;
  reflection_revision: number | null;
  revisit_id: string | null;
  revisit_revision: number | null;
  source_record_enc: string | null;
  withheld_at: number | null;
  materialized: number;
  native?: boolean;
}
export const itemId = (row: Pick<ItemRow, 'batch_id' | 'item_index'>) =>
  `${row.batch_id}:${row.item_index}`;
export function effectiveIdentity(identity: Identity, header: Header): Identity {
  return { ...identity, source: header.source };
}
/** Local transport paths and effective source remapping cannot change original content identity. */
export function originalContent(unit: Unit): unknown {
  if (unit.kind === 'portable') {
    if (unit.record.kind === 'reflection' && unit.record.legacyAuthored)
      return { text: unit.record.value.text, ...unit.record.legacyAuthored };
    if (unit.record.kind === 'reading' && unit.record.value.kind === 'legacy.imported.v1') {
      const { identity: _identity, parentIdentity: _parent, ...record } = unit.record.value.record;
      return record;
    }
    const { identity: _identity, ...record } = unit.record;
    return { record, originalJsonText: unit.originalJsonText, originalSha256: unit.originalSha256 };
  }
  const { identity: _identity, parentIdentity: _parent, ...record } = unit.record;
  return record;
}
export async function importHashers(base: RecordBase, owner: string, version: number) {
  const [key, entity, content, acknowledgement, recovery] = await Promise.all([
    base.crypt.indexHasher(owner, 'import-key', version),
    base.crypt.indexHasher(owner, 'import-entity', version),
    base.crypt.indexHasher(owner, 'import-content', version),
    base.crypt.indexHasher(owner, 'import-preview', version),
    base.crypt.indexHasher(owner, 'import-recovery', version),
  ]);
  return {
    key: (identity: Identity) => key(importKeyInput(identity)),
    family: (identity: Identity) =>
      key([
        'import-family.v1',
        identity.source.namespaceId,
        identity.source.revision,
        identity.kind,
        identity.recordId,
      ]),
    entity: (identity: Identity) => entity(importEntityInput(identity)),
    content: (unit: Unit) => content(originalContent(unit)),
    acknowledgement,
    recovery,
  };
}
export function assertRecovery(source: Source, recovery: Recovery) {
  if (recovery.kind === 'none') return;
  const previous = recovery.previousSource;
  if (
    recovery.kind === 'new_revision'
      ? source.namespaceId !== previous.namespaceId || source.revision === previous.revision
      : source.namespaceId === previous.namespaceId
  )
    throw new Error('IMPORT_INVALID');
}
export const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
export function resolvedIdentity(unit: Unit, header: Header) {
  return identityKey(effectiveIdentity(unit.identity, header));
}
