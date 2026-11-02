import { ImportedReading, Reflection, PortableRecord } from '../../contracts/index.ts';
import type { RecordBase } from './base.ts';
import { RecordError } from './base.ts';
import { statement as q } from '../db/core.ts';
import { ImportItemBody, effectiveIdentity } from './import-model.ts';
import { importCopyUnavailable } from './import-provenance.ts';

export async function exportImport(
  base: RecordBase,
  owner: string,
  key: string,
  encrypted: string,
) {
  const { unit, header } = await base.opened(
    {
      ownerId: owner,
      table: 'import_identities',
      column: 'source_record_enc',
      recordId: key,
      aadRevision: 1,
    },
    encrypted,
    ImportItemBody,
  );
  const identity = effectiveIdentity(unit.identity, header);
  if (unit.kind === 'portable') {
    if (await importCopyUnavailable(base, owner, 'alias', key)) {
      if (unit.record.kind === 'reading') {
        const value = unit.record.value;
        const at = await q(
          base.db,
          'SELECT coalesce(e.invalidated_at,c.withdrawn_at,e.accepted_at) at FROM import_identities a JOIN reading_editions e ON e.owner_id=a.owner_id AND e.id=a.edition_id LEFT JOIN content_editions c ON c.hash=e.content_hash WHERE a.owner_id=? AND a.source_key_hmac=?',
          owner,
          key,
        ).first<number>('at');
        return PortableRecord.parse({
          ...unit.record,
          identity,
          value: {
            kind: 'reading.unavailable.v1',
            editionId: value.editionId,
            sessionId: value.sessionId,
            editionNumber: value.editionNumber,
            parentEditionId: 'parentEditionId' in value ? value.parentEditionId : null,
            reason: 'content_withdrawn',
            unavailableAt: new Date(at ?? 0).toISOString(),
          },
        });
      }
      if (unit.record.kind === 'generation_receipt')
        return PortableRecord.parse({
          ...unit.record,
          identity,
          value: {
            ...unit.record.value,
            transmission: null,
            selected: [],
            contextReceipt: undefined,
            redactedSelectionCount: unit.record.value.selected?.length ?? 0,
            reproduction: 'redacted',
          },
        });
      throw new RecordError(410, 'CONTENT_UNAVAILABLE');
    }
    return PortableRecord.parse({ ...unit.record, identity });
  }
  const alias = await q(
    base.db,
    'SELECT * FROM import_identities WHERE owner_id=? AND source_key_hmac=? AND erased_at IS NULL AND withheld_at IS NULL',
    owner,
    key,
  ).first<{ edition_id: string; reflection_id: string; reflection_revision: number }>();
  if (!alias) throw new RecordError(409, 'EXPORT_CHANGED');
  if (unit.kind === 'legacy-reading') {
    const body = await q(
      base.db,
      'SELECT body_enc FROM reading_editions WHERE owner_id=? AND id=?',
      owner,
      alias.edition_id,
    ).first<string>('body_enc');
    if (!body) throw new RecordError(409, 'EXPORT_CHANGED');
    const value = await base.opened(
      {
        ownerId: owner,
        table: 'reading_editions',
        column: 'body_enc',
        recordId: alias.edition_id,
        aadRevision: 1,
      },
      body,
      ImportedReading,
    );
    return PortableRecord.parse({
      kind: 'reading',
      identity,
      originalId: unit.record.originalId ?? unit.identity.recordId,
      value: { ...value, record: { ...value.record, identity } },
    });
  }
  const body = await q(
    base.db,
    'SELECT body_enc FROM reflection_revisions WHERE owner_id=? AND reflection_id=? AND revision=?',
    owner,
    alias.reflection_id,
    alias.reflection_revision,
  ).first<string>('body_enc');
  if (!body) throw new RecordError(409, 'EXPORT_CHANGED');
  const value = await base.opened(
    {
      ownerId: owner,
      table: 'reflection_revisions',
      column: 'body_enc',
      recordId: `${alias.reflection_id}:${alias.reflection_revision}`,
      aadRevision: alias.reflection_revision,
    },
    body,
    Reflection,
  );
  const { label, originalTimestamp, occurredAt, originalJsonText, originalSha256 } = unit.record;
  return PortableRecord.parse({
    kind: 'reflection',
    identity,
    originalId: unit.identity.recordId,
    value,
    legacyAuthored: { label, originalTimestamp, occurredAt, originalJsonText, originalSha256 },
  });
}
