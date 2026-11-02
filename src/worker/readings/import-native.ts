import { Id } from '../../contracts/index.ts';
import type { Unit } from '../../domain/imports/types.ts';
import type { Session } from '../identity/types.ts';
import { statement as q } from '../db/core.ts';
import { type RecordBase, RecordError } from './base.ts';
import { ReadingRecords } from './records.ts';
import { Reflections } from './reflections.ts';
import { Revisits } from './revisits.ts';
import { decodeGrant, type GrantRow } from './context.ts';
import { ReadingExports } from './export.ts';
import { emptyDestination } from './import-materialize.ts';

/** A claimed namespace never grants ownership; compare the complete owned entity and revision. */
export async function nativeImport(base: RecordBase, session: Session, unit: Unit) {
  if (
    unit.kind !== 'portable' ||
    unit.identity.source.namespaceId !== session.subjectId ||
    !/^(native-v1|snapshot-[0-9]+)$/.test(unit.identity.source.revision) ||
    !Id.safeParse(unit.identity.recordId).success
  )
    return null;
  const id = unit.identity.recordId,
    revision = unit.identity.recordRevision,
    destination = emptyDestination();
  try {
    let value: unknown;
    if (unit.record.kind === 'reading') {
      value = await new ReadingRecords(base).reading(session, id);
      const row = await q(
        base.db,
        'SELECT session_id,edition_number FROM reading_editions WHERE owner_id=? AND id=?',
        session.subjectId,
        id,
      ).first<{ session_id: string; edition_number: number }>();
      if (!row) return null;
      if (revision !== (unit.identity.source.revision === 'native-v1' ? 1 : row.edition_number))
        return { matches: false, destination };
      Object.assign(destination, {
        entity_kind: 'edition',
        edition_id: id,
        session_id: row.session_id,
      });
    } else if (unit.record.kind === 'session') {
      const record = await new ReadingRecords(base).session(session, id);
      value = record;
      if (!('retentionExpiresAt' in unit.record.value) && record.retentionExpiresAt === null) {
        const { retentionExpiresAt: _expiry, ...historical } = record;
        value = historical;
      }
      if (record.revision !== revision) return { matches: false, destination };
      Object.assign(destination, { entity_kind: 'session', session_id: id });
    } else if (unit.record.kind === 'reflection') {
      const record = await new Reflections(base).read(session, id, revision);
      value = record;
      Object.assign(destination, {
        entity_kind: 'reflection_revision',
        session_id: record.sessionId,
        reflection_id: id,
        reflection_revision: revision,
      });
    } else if (unit.record.kind === 'revisit') {
      const record = await new Revisits(base).read(session, id, revision);
      value = record;
      Object.assign(destination, {
        entity_kind: 'revisit',
        session_id: record.sessionId,
        revisit_id: id,
        revisit_revision: revision,
      });
    } else if (unit.record.kind === 'permission') {
      if (id !== session.subjectId) return null;
      const row = await q(
        base.db,
        'SELECT model_allowed,policy_version FROM permission_revisions WHERE owner_id=? AND revision=?',
        session.subjectId,
        revision,
      ).first<{ model_allowed: number; policy_version: string }>();
      if (!row) return null;
      value = {
        revision,
        modelAllowed: Boolean(row.model_allowed),
        policyVersion: row.policy_version,
      };
      destination.entity_kind = 'permission';
    } else if (unit.record.kind === 'grant') {
      const row = await q(
        base.db,
        'SELECT * FROM context_grants WHERE owner_id=? AND id=?',
        session.subjectId,
        id,
      ).first<GrantRow>();
      if (!row) return null;
      if (row.revision !== revision) return { matches: false, destination };
      value = decodeGrant(row);
      destination.entity_kind = 'grant';
    } else {
      const row = await q(
        base.db,
        'SELECT session_id,revision FROM generation_requests WHERE owner_id=? AND id=?',
        session.subjectId,
        id,
      ).first<{ session_id: string; revision: number }>();
      if (!row) return null;
      if (row.revision !== revision) return { matches: false, destination };
      value = await new ReadingExports(base).nativeReceipt(session, id);
      Object.assign(destination, { entity_kind: 'receipt', session_id: row.session_id });
    }
    // JSON key order is irrelevant; all content and source claim fields remain significant.
    const { canonicalJson } = await import('../../domain/json.ts');
    return { matches: canonicalJson(value) === canonicalJson(unit.record.value), destination };
  } catch (error) {
    if (error instanceof RecordError && [404, 410].includes(error.status))
      return { matches: false, destination, erased: error.status === 410 };
    throw error;
  }
}
