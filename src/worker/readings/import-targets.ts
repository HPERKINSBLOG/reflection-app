import {
  ImportedReading,
  LegacyRecord,
  Reflection,
  RevisitV2,
  type RevisitNote,
} from '../../contracts/index.ts';
import { editionContextPassages } from '../../contracts/context-reading.ts';
import { canonicalJson } from '../../domain/json.ts';
import { statement as q } from '../db/core.ts';
import { assertion } from '../identity/checkpoint.ts';
import { decodeRevisit } from './revisit-codec.ts';
import type { Identity, Unit } from '../../domain/imports/types.ts';
import { type RecordBase, RecordError } from './base.ts';
export interface ImportTarget {
  kind:
    | 'session'
    | 'edition'
    | 'reflection_revision'
    | 'revisit'
    | 'receipt'
    | 'permission'
    | 'grant';
  sessionId: string | null;
  editionId?: string | null;
  reflectionId?: string | null;
  reflectionRevision?: number | null;
  revisitId?: string | null;
  revisitRevision?: number | null;
}
interface Item {
  ordinal: number;
  unit: Unit;
  duplicate: ImportTarget | null;
}
interface Field {
  kind: 'session' | 'edition' | 'reflection' | 'revisit' | 'revisit_revision';
  targetId: string;
  meta: Record<string, string | number | null>;
  value: unknown | null;
  aadRevision: number;
}
export interface ProjectedImport {
  target: ImportTarget;
  fields: Field[];
  localSources: Identity[];
}
type Dep = Unit['dependencies'][number];

const conflict = (): never => {
  throw new RecordError(409, 'CONFLICT');
};
const invalid = (): never => {
  throw new RecordError(422, 'IMPORT_INVALID');
};
const entityKey = (d: Dep) => canonicalJson([d.source, d.kind, d.recordId]);
function nativeSources(owner: string, target: ImportTarget): Identity[] {
  const source = { namespaceId: owner, revision: 'native-v1' };
  const items: Identity[] = [];
  const add = (kind: Identity['kind'], recordId: string, recordRevision = 1) =>
    items.push({ source, kind, recordId, recordRevision });
  if (target.sessionId) add('session', target.sessionId);
  if (target.editionId) add('reading', target.editionId);
  if (target.reflectionId) add('reflection', target.reflectionId, target.reflectionRevision!);
  if (target.revisitId) {
    // Zero is an internal lookup for the whole note; external record revisions are positive.
    add('revisit', target.revisitId, 0);
    add('revisit', target.revisitId, target.revisitRevision ?? 1);
  }
  return items;
}
type Portable = Extract<Unit, { kind: 'portable' }>;
type PortableReading = Extract<Portable['record'], { kind: 'reading' }>['value'];
function historicalReading(
  unit: Portable,
  reading: Exclude<PortableReading, { kind: 'reading.unavailable.v1' }>,
) {
  if (reading.kind === 'legacy.imported.v1')
    return { ...reading.record, identity: unit.identity, parentIdentity: unit.parentIdentity };
  if (reading.kind === 'astrology.pattern.accepted.v1')
    return LegacyRecord.parse({
      format: 'reflection-import.v1',
      identity: unit.identity,
      parentIdentity: unit.parentIdentity,
      source: 'successor',
      originalId: unit.record.originalId,
      originalParentId: null,
      originalTimestamp: reading.acceptedAt,
      occurredAt: reading.acceptedAt,
      question: reading.chapter.prompt,
      generatedText: `${reading.chapter.factualLabel}\n\n${reading.chapter.title}\n\n${reading.chapter.text}`,
      userStatements: [],
      basis: {
        method: 'astrology',
        cards: [],
        sourceIds: [reading.chapter.sourceId],
        rawBasisJson: JSON.stringify(reading.basis),
        verification: 'legacy_unverified',
      },
      originalJsonText: unit.originalJsonText,
      originalSha256: unit.originalSha256,
      provenanceGaps: ['review'],
      review: 'legacy_unknown',
    });
  const generated =
    editionContextPassages(reading).find((p) => p.authorship === 'generated')?.text ?? null;
  return LegacyRecord.parse({
    format: 'reflection-import.v1',
    identity: unit.identity,
    parentIdentity: unit.parentIdentity,
    source: 'successor',
    originalId: unit.record.originalId,
    originalParentId: reading.parentEditionId,
    originalTimestamp: reading.acceptedAt,
    occurredAt: reading.acceptedAt,
    question: reading.question,
    generatedText: generated,
    userStatements: [],
    basis: {
      method: 'tarot',
      cards: reading.basis.cards.map((card, i) => ({
        name: reading.kind === 'tarot.accepted.v2' ? reading.draw[i]!.name : card.cardId,
        position: card.position,
        orientation: card.orientation,
        canonicalCardId: card.cardId,
      })),
      sourceIds: reading.sources.map((s) => s.id),
      rawBasisJson: JSON.stringify(reading.basis),
      verification: 'legacy_unverified',
    },
    originalJsonText: unit.originalJsonText,
    originalSha256: unit.originalSha256,
    provenanceGaps: ['review'],
    review: 'legacy_unknown',
  });
}

export async function projectImportGroup(
  owner: string,
  _groupId: string,
  items: readonly Item[],
  resolve: (dep: Dep) => Promise<ImportTarget | null>,
  now: number,
  base: RecordBase,
): Promise<Map<number, ProjectedImport>> {
  const byIdentity = new Map<string, Item>(),
    byEntity = new Map<string, Item[]>(),
    pending = new Set<number>();
  const version = await q(
    base.db,
    'SELECT key_version FROM accounts WHERE id=?',
    owner,
  ).first<number>('key_version');
  if (version === null) throw new RecordError(401, 'UNAUTHENTICATED');
  const keyVersion = version;
  const result = new Map<number, ProjectedImport>(),
    editions = new Map<string, number>();
  const revisits = new Map<string, Array<{ item: Item; note: RevisitNote }>>();
  for (const item of items) {
    const key = canonicalJson(item.unit.identity),
      entity = entityKey(item.unit.identity);
    if (byIdentity.has(key)) invalid();
    byIdentity.set(key, item);
    const entries = byEntity.get(entity) ?? [];
    entries.push(item);
    byEntity.set(entity, entries);
  }
  async function localId(identity: Identity, purpose: string) {
    const hash = await base.crypt.hashVersion(
      owner,
      'import-target-id.v1',
      [identity.source, purpose, identity.kind, identity.recordId],
      keyVersion,
    );
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  }
  async function nextEdition(id: string) {
    const last =
      editions.get(id) ??
      (await q(
        base.db,
        'SELECT coalesce(max(edition_number),0) AS n FROM reading_editions WHERE owner_id=? AND session_id=?',
        owner,
        id,
      ).first<number>('n')) ??
      0;
    editions.set(id, last + 1);
    return last + 1;
  }
  async function dependency(d: Dep): Promise<ImportTarget> {
    let selected: Item | undefined;
    if (d.recordRevision !== null) selected = byIdentity.get(canonicalJson(d));
    else {
      const candidates = byEntity.get(entityKey(d)) ?? [];
      if (candidates.length > 1) conflict();
      selected = candidates[0];
    }
    return selected ? (await project(selected)).target : ((await resolve(d)) ?? conflict());
  }
  async function project(item: Item): Promise<ProjectedImport> {
    const ready = result.get(item.ordinal);
    if (ready) return ready;
    if (pending.has(item.ordinal)) conflict();
    pending.add(item.ordinal);
    const unit = item.unit,
      fields: Field[] = [];
    let target: ImportTarget;
    if (item.duplicate) target = item.duplicate;
    else {
      const deps: { kind: Dep['kind']; target: ImportTarget }[] = [];
      for (const d of unit.dependencies) deps.push({ kind: d.kind, target: await dependency(d) });
      function parent(kind: 'session' | 'reading', required: boolean) {
        const matches = deps.filter((d) => d.kind === kind);
        if (!matches.length && !required) return null;
        const p = matches[0]?.target;
        if (
          matches.length !== 1 ||
          !p?.sessionId ||
          (kind === 'reading' ? p.kind !== 'edition' || !p.editionId : p.kind !== 'session')
        )
          return conflict();
        return p;
      }
      const value = unit.kind === 'portable' ? unit.record : null;
      if (
        unit.kind === 'legacy-reading' ||
        (value?.kind === 'reading' && unit.kind === 'portable')
      ) {
        const legacy = unit.kind === 'legacy-reading' ? unit.record : null;
        const reading = value?.kind === 'reading' ? value.value : null;
        const needsParent =
          !!unit.parentIdentity ||
          !!(reading && 'parentEditionId' in reading && reading.parentEditionId);
        const previous = parent('reading', needsParent),
          family = parent('session', reading !== null);
        if (previous && family && previous.sessionId !== family.sessionId) conflict();
        const sessionId =
          previous?.sessionId ??
          family?.sessionId ??
          (await localId(unit.identity, 'legacy-session'));
        if (!previous && !family) {
          fields.push({
            kind: 'session',
            targetId: sessionId,
            aadRevision: 1,
            meta: {
              createdAt: legacy?.occurredAt ? Date.parse(legacy.occurredAt) : now,
              savedAt: now,
            },
            value: { v: 1, text: legacy?.question ?? null },
          });
        }
        const editionId = await localId(unit.identity, 'edition'),
          editionNumber = await nextEdition(sessionId);
        target = { kind: 'edition', sessionId, editionId };
        const unavailable = reading?.kind === 'reading.unavailable.v1' ? reading : null;
        const record =
          legacy ??
          (unit.kind === 'portable' && reading && reading.kind !== 'reading.unavailable.v1'
            ? historicalReading(unit, reading)
            : null);
        const at = record?.occurredAt ? Date.parse(record.occurredAt) : now;
        fields.push({
          kind: 'edition',
          targetId: editionId,
          aadRevision: 1,
          meta: {
            sessionId,
            editionNumber,
            parentEditionId: previous?.editionId ?? null,
            at,
            invalidatedAt: unavailable ? Date.parse(unavailable.unavailableAt) : null,
            status: unavailable ? 'withdrawn' : 'imported',
          },
          value: record
            ? ImportedReading.parse({
                kind: 'legacy.imported.v1',
                editionId,
                sessionId,
                editionNumber,
                record,
                importedAt: new Date(now).toISOString(),
              })
            : null,
        });
      } else if (value?.kind === 'session') {
        const sessionId = await localId(unit.identity, 'session');
        target = { kind: 'session', sessionId };
        fields.push({
          kind: 'session',
          targetId: sessionId,
          aadRevision: 1,
          meta: { createdAt: Date.parse(value.value.createdAt), savedAt: now },
          value: { v: 1, text: value.value.question },
        });
      } else if (
        unit.kind === 'legacy-authored' ||
        value?.kind === 'reflection' ||
        value?.kind === 'revisit'
      ) {
        const edition = parent('reading', true)!,
          sessionId = edition.sessionId!,
          editionId = edition.editionId!;
        const family = parent('session', false);
        if (family && family.sessionId !== sessionId) conflict();
        const revision = unit.identity.recordRevision;
        if (revision > 100) invalid();
        if (value?.kind === 'revisit') {
          const note = value.value,
            source = 'kind' in note ? note : null;
          if ((source?.revision ?? 1) !== revision) invalid();
          const revisitId = await localId(unit.identity, 'revisit');
          target = { kind: 'revisit', sessionId, revisitId, revisitRevision: revision };
          const group = revisits.get(revisitId) ?? [];
          group.push({
            item,
            note: RevisitV2.parse({
              ...note,
              kind: 'revisit.v2',
              id: revisitId,
              sessionId,
              editionId,
              revision,
              stance: source?.stance ?? 'unspecified',
              updatedAt: source?.updatedAt ?? note.createdAt,
            }),
          });
          revisits.set(revisitId, group);
        } else {
          const body =
            unit.kind === 'legacy-authored'
              ? {
                  text: unit.record.text,
                  stance: 'unspecified',
                  updatedAt: unit.record.occurredAt ?? new Date(now).toISOString(),
                }
              : value?.kind === 'reflection' && value.value.revision === revision
                ? value.value
                : invalid();
          const reflectionId = await localId(unit.identity, 'reflection');
          target = {
            kind: 'reflection_revision',
            sessionId,
            reflectionId,
            reflectionRevision: revision,
          };
          fields.push({
            kind: 'reflection',
            targetId: `${reflectionId}:${revision}`,
            aadRevision: revision,
            meta: {
              id: reflectionId,
              sessionId,
              editionId,
              revision,
              updatedAt: Date.parse(body.updatedAt),
            },
            value: Reflection.parse({ ...body, id: reflectionId, sessionId, editionId, revision }),
          });
        }
      } else if (
        value?.kind === 'generation_receipt' ||
        value?.kind === 'permission' ||
        value?.kind === 'grant'
      ) {
        target = {
          kind: value.kind === 'generation_receipt' ? 'receipt' : value.kind,
          sessionId: null,
        };
      } else return invalid();
    }
    const projected = { target, fields, localSources: nativeSources(owner, target) };
    result.set(item.ordinal, projected);
    pending.delete(item.ordinal);
    return projected;
  }
  for (const item of items) await project(item);
  for (const [id, versions] of revisits) {
    const current = await q(
      base.db,
      'SELECT id,session_id,edition_id,current_revision,created_at,updated_at,note_enc,key_version,deleted_at FROM revisits WHERE owner_id=? AND id=?',
      owner,
      id,
    ).first<{
      id: string;
      session_id: string;
      edition_id: string;
      current_revision: number;
      created_at: number;
      updated_at: number;
      note_enc: string;
      key_version: number;
      deleted_at: number | null;
    }>();
    const ordered = versions.sort((a, b) => a.note.revision - b.note.revision),
      highest = ordered.at(-1)!;
    if (
      current &&
      (current.deleted_at !== null ||
        !current.note_enc ||
        current.current_revision === highest.note.revision)
    )
      conflict();
    function noteField(note: RevisitNote, historical: boolean): Field {
      return {
        kind: historical ? 'revisit_revision' : 'revisit',
        targetId: historical ? `${id}:${note.revision}` : id,
        aadRevision: note.revision,
        meta: {
          id,
          sessionId: note.sessionId,
          editionId: note.editionId,
          revision: note.revision,
          createdAt: Date.parse(note.createdAt),
          updatedAt: Date.parse(note.updatedAt),
          expectedRevision: current?.current_revision ?? null,
        },
        value: note,
      };
    }
    const seen = new Set<number>();
    for (const { item, note } of ordered) {
      if (
        seen.has(note.revision) ||
        note.sessionId !== highest.note.sessionId ||
        note.editionId !== highest.note.editionId ||
        note.createdAt !== highest.note.createdAt ||
        (current &&
          (current.session_id !== note.sessionId ||
            current.edition_id !== note.editionId ||
            current.created_at !== Date.parse(note.createdAt) ||
            current.current_revision === note.revision))
      )
        conflict();
      seen.add(note.revision);
      result
        .get(item.ordinal)!
        .fields.push(
          noteField(
            note,
            note.revision < Math.max(current?.current_revision ?? 0, highest.note.revision),
          ),
        );
    }
    if (current && current.current_revision < highest.note.revision) {
      const retained = await decodeRevisit(
        base,
        owner,
        current,
        current.current_revision,
        current.note_enc,
        current.key_version,
        current.updated_at,
        false,
      );
      result.get(highest.item.ordinal)!.fields.push(noteField(retained, true));
    }
  }
  return result;
}

/** Run inside the caller's fenced publication transaction. Stage data is private
 * final-AAD ciphertext; metadata contains only local identities, dates and versions. */
export function publishImportTargets(
  db: D1Database,
  owner: string,
  groupId: string,
): D1PreparedStatement[] {
  const where = 's.owner_id=? AND s.group_id=?';
  const meta = (key: string) => `json_extract(s.meta_json,'$.${key}')`;
  const sql = (query: string) => q(db, query, owner, groupId);
  const id = meta('id'),
    sid = meta('sessionId'),
    eid = meta('editionId'),
    rev = meta('revision');
  return [
    sql(`INSERT INTO reading_sessions(id,owner_id,status,method,question_enc,created_at,saved_at)
      SELECT s.target_id,s.owner_id,'saved','imported',s.field_enc,${meta('createdAt')},${meta('savedAt')} FROM import_staging s WHERE ${where} AND s.kind='session'`),
    assertion(
      db,
      `NOT EXISTS(SELECT 1 FROM import_staging s LEFT JOIN reading_sessions family ON family.owner_id=s.owner_id AND family.id=${sid}
      WHERE ${where} AND s.kind IN('edition','reflection','revisit','revisit_revision') AND (family.id IS NULL OR family.status!='saved'))`,
      owner,
      groupId,
    ),
    sql(`INSERT INTO reading_editions(id,owner_id,session_id,edition_number,parent_edition_id,status,mode,body_enc,key_version,accepted_at,invalidated_at)
      SELECT s.target_id,s.owner_id,${sid},${meta('editionNumber')},${meta('parentEditionId')},${meta('status')},'legacy',s.field_enc,s.key_version,${meta('at')},${meta('invalidatedAt')}
      FROM import_staging s WHERE ${where} AND s.kind='edition' ORDER BY ${meta('editionNumber')}`),
    assertion(
      db,
      `NOT EXISTS(SELECT 1 FROM import_staging s LEFT JOIN reading_editions e ON e.owner_id=s.owner_id AND e.id=${eid} AND e.session_id=${sid}
      WHERE ${where} AND s.kind IN('reflection','revisit','revisit_revision') AND (e.id IS NULL OR e.status='deleted'))`,
      owner,
      groupId,
    ),
    assertion(
      db,
      `NOT EXISTS(SELECT 1 FROM import_staging s JOIN reflections f ON f.id=${id} WHERE ${where} AND s.kind='reflection' AND (f.owner_id!=s.owner_id OR f.session_id!=${sid} OR f.edition_id!=${eid} OR f.deleted_at IS NOT NULL))`,
      owner,
      groupId,
    ),
    sql(`INSERT INTO reflections(id,owner_id,session_id,edition_id,current_revision)
      SELECT ${id},s.owner_id,${sid},${eid},max(${rev}) FROM import_staging s WHERE ${where} AND s.kind='reflection' GROUP BY ${id},s.owner_id,${sid},${eid}
      ON CONFLICT(id) DO UPDATE SET current_revision=max(reflections.current_revision,excluded.current_revision)`),
    sql(`INSERT INTO reflection_revisions(reflection_id,owner_id,revision,body_enc,key_version,created_at)
      SELECT ${id},s.owner_id,${rev},s.field_enc,s.key_version,${meta('updatedAt')} FROM import_staging s WHERE ${where} AND s.kind='reflection'`),
    assertion(
      db,
      `NOT EXISTS(SELECT 1 FROM import_staging s LEFT JOIN revisits n ON n.id=${id}
      WHERE ${where} AND s.kind IN ('revisit','revisit_revision') AND (n.current_revision IS NOT ${meta('expectedRevision')} OR n.deleted_at IS NOT NULL OR n.owner_id!=s.owner_id OR n.session_id!=${sid} OR n.edition_id!=${eid}))`,
      owner,
      groupId,
    ),
    sql(`INSERT INTO revisits(id,owner_id,session_id,edition_id,current_revision,note_enc,key_version,created_at,updated_at)
      SELECT s.target_id,s.owner_id,${sid},${eid},${rev},s.field_enc,s.key_version,${meta('createdAt')},${meta('updatedAt')} FROM import_staging s WHERE ${where} AND s.kind='revisit'
      ON CONFLICT(id) DO UPDATE SET current_revision=excluded.current_revision,note_enc=excluded.note_enc,key_version=excluded.key_version,updated_at=excluded.updated_at`),
    sql(`INSERT INTO revisit_revisions(revisit_id,owner_id,revision,body_enc,key_version,created_at)
      SELECT ${id},s.owner_id,${rev},s.field_enc,s.key_version,${meta('updatedAt')} FROM import_staging s WHERE ${where} AND s.kind='revisit_revision'`),
  ];
}
