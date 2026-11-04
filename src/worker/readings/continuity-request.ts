import type { z } from 'zod';
import { SelectedFragment, type StartRequest } from '../../contracts/index.ts';
import { continuityGuardValues, statement as q } from '../db/statements.ts';
import type { Session } from '../identity/types.ts';
import { RecordError, type RecordBase } from './base.ts';
import { ReadingRecords } from './records.ts';

type Fragment = z.infer<typeof SelectedFragment>;
export function capturedContext(parent: string | null, selected: readonly Fragment[]) {
  return continuityGuardValues(
    parent,
    selected.map((f) => ({
      ...f,
      fragmentHmac: f.textHash ?? '',
    })),
  );
}

export async function captureStatements(
  base: RecordBase,
  owner: string,
  requestId: string,
  version: number,
  selected: Fragment[],
) {
  return Promise.all(
    selected.map(async (fragment) => {
      const enc = await base.crypt.seal(
        {
          ownerId: owner,
          table: 'generation_context',
          column: 'fragment_enc',
          recordId: requestId + ':' + fragment.ordinal,
          aadRevision: 1,
        },
        fragment,
        version,
      );
      return q(
        base.db,
        'INSERT INTO generation_context(request_id,owner_id,ordinal,grant_id,grant_revision,fragment_enc,fragment_hmac,key_version) VALUES (?,?,?,?,?,?,?,?)',
        requestId,
        owner,
        fragment.ordinal,
        fragment.grantId,
        fragment.grantRevision,
        enc,
        fragment.textHash,
        version,
      );
    }),
  );
}

/** Before photo recognition there is no draw or writer plan. Recover the reviewed
 * snapshots by ordinal, bound to the immutable encrypted submission and owner. */
export async function readCaptures(
  base: RecordBase,
  owner: string,
  requestId: string,
  input: z.infer<typeof StartRequest>,
) {
  const rows = (
    await q(
      base.db,
      'SELECT ordinal,fragment_enc FROM generation_context WHERE request_id=? AND owner_id=? ORDER BY ordinal',
      requestId,
      owner,
    ).all<{ ordinal: number; fragment_enc: string | null }>()
  ).results;
  if (rows.length !== input.selection.length) throw new RecordError(409, 'CONTEXT_CHANGED');
  return Promise.all(
    rows.map(async (row, index) => {
      if (!row.fragment_enc || row.ordinal !== index) throw new RecordError(409, 'CONTEXT_CHANGED');
      const fragment = await base.crypt.open(
        {
          ownerId: owner,
          table: 'generation_context',
          column: 'fragment_enc',
          recordId: requestId + ':' + index,
          aadRevision: 1,
        },
        row.fragment_enc,
        SelectedFragment,
      );
      const selected = input.selection[index]!;
      if (
        fragment.ordinal !== index ||
        fragment.grantId !== selected.grantId ||
        fragment.grantRevision !== selected.grantRevision ||
        fragment.start !== selected.start ||
        fragment.end !== selected.end ||
        fragment.textHash !== selected.previewHash ||
        fragment.availability !== 'retained'
      )
        throw new RecordError(409, 'CONTEXT_CHANGED');
      return fragment;
    }),
  );
}
export async function savedParent(
  base: RecordBase,
  session: Session,
  input: z.infer<typeof StartRequest>,
) {
  if (input.parentEditionId === null) return null;
  const reading = await new ReadingRecords(base).reading(session, input.parentEditionId);
  if (!('provenance' in reading)) throw new RecordError(410, 'CONTENT_UNAVAILABLE');
  const family = await base.ownedSession(session, reading.sessionId);
  if (family.status !== 'saved') throw new RecordError(410, 'CONTENT_UNAVAILABLE');
  if (input.spreadPhoto || input.reversals !== reading.basis.reversals)
    throw new RecordError(422, 'BAD_INPUT');
  return reading;
}

/** Failed and cancelled attempts release their slot. A published edition counts
 * even after its text becomes unavailable, so numbers and history stay stable. */
export const familyHasRoom = `(SELECT count(*) FROM reading_editions WHERE owner_id=? AND session_id=? AND parent_edition_id IS NOT NULL)
  +(SELECT count(*) FROM generation_requests WHERE owner_id=? AND session_id=? AND operation='followup'
    AND state NOT IN ('published','cancelled','expired','blocked','failed')) < 50`;
