import { Id, ImportChunkDocument } from '../../contracts/index.ts';
import { IMPORT_LIMITS } from '../../contracts/import-policy.ts';
import { canonicalJson } from '../json.ts';
import { utf8, rawHash } from './legacy.ts';
import { sameSource } from './identity.ts';
import { identityKey } from './identity.ts';
import { validateUnit } from './parse.ts';
import type { ImportGroup, Unit, ImportWrite, Recovery } from './types.ts';

export async function buildImportGroups(
  units: readonly Unit[],
  id: () => string,
  recovery: Recovery = { kind: 'none' },
): Promise<ImportGroup[]> {
  if (units.length > IMPORT_LIMITS.assemblyItems) throw new Error('INPUT_TOO_LARGE');
  const grouped = new Map<string, Unit[]>(),
    keys = new Set<string>(),
    ids = new Set<string>();
  for (const unit of units) {
    await validateUnit(unit);
    if (keys.has(unit.key)) throw new Error('IMPORT_INVALID');
    keys.add(unit.key);
    const group = grouped.get(unit.groupKey) ?? [];
    group.push(unit);
    grouped.set(unit.groupKey, group);
  }
  const result: ImportGroup[] = [];
  for (const candidates of grouped.values()) {
    const ordered = [...candidates].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      source = ordered[0]!.identity.source;
    if (ordered.some((unit) => !sameSource(unit.identity.source, source)))
      throw new Error('IMPORT_INVALID');
    const groupId = Id.parse(id());
    if (ids.has(groupId)) throw new Error('IMPORT_INVALID');
    ids.add(groupId);
    const manifestHash = await rawHash(canonicalJson(ordered)),
      chunks: ImportWrite[] = [];
    const carrier = {
      format: 'reflection-portable-chunk.v1' as const,
      groupId,
      manifestHash,
      unitCount: ordered.length,
    };
    type Item = { ordinal: number; unit: Unit };
    let items: Item[] = [];
    const request = (values: Item[]): ImportWrite => ({
      format: carrier.format,
      source,
      recovery,
      document: JSON.stringify({ ...carrier, items: values }),
    });
    const fits = (values: Item[]) =>
      values.length <= IMPORT_LIMITS.previewItems &&
      request(values).document.length <= IMPORT_LIMITS.documentUnits &&
      utf8.encode(JSON.stringify(request(values))).length <= IMPORT_LIMITS.bodyBytes;
    for (const [ordinal, unit] of ordered.entries()) {
      const item = { ordinal, unit };
      if (!fits([...items, item])) {
        if (!items.length) throw new Error('INPUT_TOO_LARGE');
        chunks.push(request(items));
        items = [];
        if (!fits([item])) throw new Error('INPUT_TOO_LARGE');
      }
      items.push(item);
    }
    if (items.length) chunks.push(request(items));
    const unresolved = ordered
      .flatMap((u) => u.dependencies)
      .filter(
        (d) =>
          d.recordRevision === null ||
          !keys.has(identityKey({ ...d, recordRevision: d.recordRevision })),
      );
    result.push({ id: groupId, manifestHash, units: ordered, chunks, unresolved });
  }
  return result;
}

export async function verifyImportGroup(chunks: readonly ImportWrite[]): Promise<Unit[]> {
  const parsed = chunks.map((c) => ImportChunkDocument.parse(JSON.parse(c.document)));
  if (!parsed.length) throw new Error('IMPORT_INVALID');
  const first = parsed[0]!,
    items = parsed.flatMap((c) => c.items).sort((a, b) => a.ordinal - b.ordinal);
  if (
    parsed.some(
      (c) =>
        c.groupId !== first.groupId ||
        c.manifestHash !== first.manifestHash ||
        c.unitCount !== first.unitCount,
    ) ||
    items.length !== first.unitCount ||
    items.some((item, i) => item.ordinal !== i)
  )
    throw new Error('IMPORT_INVALID');
  const units = items.map((item) => item.unit);
  const seen = new Set<string>();
  for (const unit of units) {
    await validateUnit(unit);
    if (
      seen.has(unit.key) ||
      !sameSource(unit.identity.source, chunks[0]!.source) ||
      unit.groupKey !== units[0]!.groupKey
    )
      throw new Error('IMPORT_INVALID');
    seen.add(unit.key);
  }
  if ((await rawHash(canonicalJson(units))) !== first.manifestHash)
    throw new Error('IMPORT_INVALID');
  return units;
}

/** One group per submission. Lost acknowledgement is reconciled by stable group ID.
 * Callbacks must resolve a final outcome; unresolved state throws and stops this run.
 */
export async function runImportGroups(
  ids: readonly string[],
  signal: AbortSignal,
  submit: (id: string) => Promise<unknown>,
  reconcile: (id: string) => Promise<string>,
): Promise<{ groupId: string; outcome: string }[]> {
  const results = [];
  for (const groupId of ids) {
    if (signal.aborted) break;
    try {
      await submit(groupId);
    } catch {
      /* Outcome may already be durable; never resend here. */
    }
    const outcome = await reconcile(groupId);
    if (!['complete', 'failed'].includes(outcome)) throw new Error('IMPORT_UNRESOLVED');
    results.push({ groupId, outcome });
  }
  return results;
}
