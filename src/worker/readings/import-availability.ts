import type { z } from 'zod';
import { PortableRecordV2, UnavailableReading } from '../../contracts/index.ts';
import { statement as q } from '../db/core.ts';
import { assertion } from '../identity/checkpoint.ts';
import { availableSession, type RecordBase, RecordError } from './base.ts';

const availableNative = `${availableSession} AND e.status IN('accepted','imported')
  AND e.body_enc IS NOT NULL AND (c.state IS NULL OR c.state!='withdrawn')
  AND (p.state IS NULL OR p.state!='withdrawn')`;

/** Legacy projections retain the original portable record as exact JSON. Follow
 * only bounded, same-owner native references; this never grants import authority. */
export function nativeImportSource(owner: string, record: z.infer<typeof PortableRecordV2>) {
  for (let depth = 0; depth < 4; depth++) {
    if (record.identity.source.namespaceId !== owner || record.kind !== 'reading') return null;
    const value = record.value;
    if (value.kind === 'reading.unavailable.v1') return null;
    if (value.kind !== 'legacy.imported.v1') return value;
    const original = importedNativeRecord(value.record.originalJsonText);
    if (!original) return null;
    record = original;
  }
  // Exhausting the inspection budget is not evidence that the copy is independent.
  throw new RecordError(410, 'CONTENT_UNAVAILABLE');
}

export function nativeImportGuard(base: RecordBase, owner: string, ids: string[]) {
  const unique = [...new Set(ids)];
  return assertion(
    base.db,
    `(SELECT count(*) FROM reading_editions e
      JOIN reading_sessions s ON s.owner_id=e.owner_id AND s.id=e.session_id
      LEFT JOIN content_editions c ON c.hash=e.content_hash
      LEFT JOIN pattern_content_releases p ON p.hash=e.pattern_content_hash
      WHERE e.owner_id=? AND e.id IN (SELECT value FROM json_each(?)) AND ${availableNative})=?`,
    owner,
    JSON.stringify(unique),
    unique.length,
  );
}

/** A same-account native snapshot cannot bypass withdrawal by becoming an import.
 * Foreign snapshots retain their historical identity and confer no native authority. */
export async function unavailableNativeImport(
  base: RecordBase,
  owner: string,
  record: z.infer<typeof PortableRecordV2>,
): Promise<z.infer<typeof UnavailableReading> | null> {
  if (record.kind !== 'reading' || record.value.kind === 'reading.unavailable.v1') return null;
  const source = nativeImportSource(owner, record);
  if (!source) return null;
  const value = record.value;
  const row = await q(
    base.db,
    `SELECT coalesce(c.state,p.state) content_state,
      coalesce(c.withdrawn_at,p.withdrawn_at,e.invalidated_at,e.accepted_at) unavailable_at,
      (${availableNative}) available
    FROM reading_editions e JOIN reading_sessions s ON s.owner_id=e.owner_id AND s.id=e.session_id
    LEFT JOIN content_editions c ON c.hash=e.content_hash
    LEFT JOIN pattern_content_releases p ON p.hash=e.pattern_content_hash
    WHERE e.owner_id=? AND e.id=?`,
    owner,
    source.editionId,
  ).first<{
    content_state: string | null;
    unavailable_at: number;
    available: number;
  }>();
  if (row?.available) return null;
  return UnavailableReading.parse({
    kind: 'reading.unavailable.v1',
    editionId: value.editionId,
    sessionId: value.sessionId,
    editionNumber: value.editionNumber,
    parentEditionId: 'parentEditionId' in value ? value.parentEditionId : null,
    reason: row?.content_state === 'withdrawn' ? 'content_withdrawn' : 'source_erased',
    unavailableAt: new Date(row?.unavailable_at ?? Date.parse(source.acceptedAt)).toISOString(),
  });
}

export function importedNativeRecord(originalJsonText: string) {
  try {
    const parsed = PortableRecordV2.safeParse(JSON.parse(originalJsonText));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
