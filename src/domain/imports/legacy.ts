import {
  LegacyRecord,
  ImportUnit,
  ImportRecordIdentity,
  Instant,
  CardId,
} from '../../contracts/index.ts';
import { IMPORT_LIMITS } from '../../contracts/import-policy.ts';
import { canonicalJson } from '../json.ts';
import { identityKey } from './identity.ts';
import { field, raw, textField, type JsonNode } from './json.ts';
import type { Unit, Identity, Source } from './types.ts';
export const utf8 = new TextEncoder();
export async function rawHash(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function assertRecordSize(value: unknown, native = false): void {
  if (
    utf8.encode(JSON.stringify(value)).length >
    (native ? IMPORT_LIMITS.nativeRecordBytes : IMPORT_LIMITS.recordBytes)
  )
    throw new Error('INPUT_TOO_LARGE');
}
export async function identity(
  source: Source,
  kind: Identity['kind'],
  id: string | null,
  original: string,
): Promise<Identity> {
  return ImportRecordIdentity.parse({
    source,
    kind,
    recordId: id ?? `sha256:${await rawHash(original)}`,
    recordRevision: 1,
  });
}
export function originalTime(
  document: string,
  node: JsonNode | undefined,
): { originalTimestamp: string | null; occurredAt: string | null } {
  if (!node || node.value === null) return { originalTimestamp: null, occurredAt: null };
  const value = node.value;
  const originalTimestamp = typeof value === 'string' ? value : raw(document, node);
  let occurredAt: string | null = null;
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= -2208988800000 &&
    value <= 4102444800000
  )
    occurredAt = new Date(value).toISOString();
  else if (typeof value === 'string' && Instant.safeParse(value).success) occurredAt = value;
  return { originalTimestamp, occurredAt };
}
export const groupKey = (id: Identity) =>
  canonicalJson(['import-group.v1', id.source.namespaceId, id.source.revision, id.recordId]);
export function common(
  identity: Identity,
  parentIdentity: Identity | null,
  sourcePointer: string,
  group: string,
) {
  return {
    key: identityKey(identity),
    identity,
    parentIdentity,
    dependencies: parentIdentity ? [parentIdentity] : [],
    sourcePointer,
    groupKey: group,
  };
}
export async function readingUnit(
  document: string,
  _node: JsonNode,
  source: Source,
  pointer: string,
  originalJsonText: string,
  options: {
    originalId: string | null;
    originalParentId?: string | null;
    parent: Identity | null;
    group: string | null;
    system: 'tarot' | 'patternlike';
    question?: string | null;
    generatedText?: string | null;
    time?: JsonNode;
    cards?: JsonNode[];
  },
): Promise<Unit> {
  const id = await identity(source, 'reading', options.originalId, originalJsonText);
  const cards = (options.cards ?? []).map((card) => {
    const orientation = textField(card, 'orientation'),
      reversed = field(card, 'isReversed')?.value;
    const declared =
      orientation === 'upright' || orientation === 'reversed' ? orientation : 'unknown';
    const inferred =
      typeof reversed === 'boolean' ? (reversed ? 'reversed' : 'upright') : 'unknown';
    const direction =
      declared !== 'unknown' && inferred !== 'unknown' && declared !== inferred
        ? 'unknown'
        : declared !== 'unknown'
          ? declared
          : inferred;
    const canonical = CardId.safeParse(textField(card, 'canonicalKey'));
    return {
      name: textField(card, 'name') ?? textField(card, 'card') ?? 'Unknown card',
      position: textField(card, 'position') ?? textField(card, 'slot'),
      orientation: direction,
      canonicalCardId: canonical.success ? canonical.data : null,
    };
  });
  const record = LegacyRecord.parse({
    format: 'reflection-import.v1',
    identity: id,
    parentIdentity: options.parent,
    source: options.system,
    originalId: options.originalId,
    originalParentId:
      options.originalParentId === undefined
        ? (options.parent?.recordId ?? null)
        : options.originalParentId,
    ...originalTime(document, options.time),
    question: options.question ?? null,
    generatedText: options.generatedText ?? null,
    userStatements: [],
    basis: {
      method: options.system === 'tarot' ? 'tarot' : 'astrology',
      cards,
      sourceIds: [],
      rawBasisJson: options.system === 'patternlike' ? originalJsonText : null,
      verification: 'legacy_unverified',
    },
    originalJsonText,
    originalSha256: await rawHash(originalJsonText),
    provenanceGaps: [
      'basis',
      'content_edition',
      'model',
      'prompt',
      'validator',
      'review',
      ...(!options.time ? ['timestamp'] : []),
      ...(!options.originalId ? ['original_id'] : []),
    ],
    review: 'legacy_unknown',
  });
  assertRecordSize(record);
  return ImportUnit.parse({
    ...common(id, options.parent, pointer, options.group ?? groupKey(id)),
    kind: 'legacy-reading',
    rawScope: 'selected-fields.v1',
    record,
  });
}
