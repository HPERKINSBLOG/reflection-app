import { ImportedReading, Reflection, LegacyRecord, RevisitV2 } from '../../contracts/index.ts';
import { identityKey } from '../../domain/imports/identity.ts';
import { sameSource } from '../../domain/imports/identity.ts';
import type { Unit } from '../../domain/imports/types.ts';
import { statement as q, DB_NOW } from '../db/core.ts';
import { type RecordBase, RecordError, iso } from './base.ts';
import {
  effectiveIdentity,
  importHashers,
  type Header,
  type AliasRow,
  type ItemRow,
} from './import-model.ts';
import { editionContextText } from '../../domain/tarot/continuity.ts';
import { revisitField } from './revisit-codec.ts';
import { destinationLinks, unitLinks, type Link } from './import-lifecycle.ts';
import { encryptedBytes } from './crypto.ts';

export type Destination = Pick<
  AliasRow,
  | 'entity_kind'
  | 'session_id'
  | 'edition_id'
  | 'reflection_id'
  | 'reflection_revision'
  | 'revisit_id'
  | 'revisit_revision'
>;
export const emptyDestination = (): Destination => ({
  entity_kind: 'receipt',
  session_id: null,
  edition_id: null,
  reflection_id: null,
  reflection_revision: null,
  revisit_id: null,
  revisit_revision: null,
});
export async function materializeImport(
  base: RecordBase,
  owner: string,
  version: number,
  header: Header,
  entries: { row: ItemRow; unit: Unit; duplicate: AliasRow | null }[],
  aliases: AliasRow[],
): Promise<{
  statements: D1PreparedStatement[];
  destinations: Destination[];
  provenance: Link[][];
  additionalBytes: number;
}> {
  const statements: D1PreparedStatement[] = [],
    destinations: Destination[] = [];
  const known = new Map<string, Destination>();
  const entityIds = new Map<string, string>();
  const hashes = await importHashers(base, owner, version),
    unitKeys = new Set(entries.map((e) => e.unit.key));
  for (const entry of entries)
    for (const dependency of entry.unit.dependencies) {
      if (dependency.recordRevision === null) throw new RecordError(422, 'IMPORT_INVALID');
      const identity = { ...dependency, recordRevision: dependency.recordRevision },
        key = identityKey(identity);
      if (unitKeys.has(key) || known.has(key)) continue;
      const previous =
        header.recovery.kind === 'none' ? header.source : header.recovery.previousSource;
      const effective = sameSource(identity.source, previous)
        ? effectiveIdentity(identity, header)
        : identity;
      const hash = await hashes.key(effective),
        alias = aliases.find(
          (a) => a.source_key_hmac === hash && a.erased_at === null && a.withheld_at === null,
        );
      const kind =
        { reading: 'edition', reflection: 'reflection_revision', generation_receipt: 'receipt' }[
          identity.kind as 'reading'
        ] ?? identity.kind;
      if (!alias || alias.entity_kind !== kind) throw new RecordError(422, 'IMPORT_INVALID');
      known.set(key, alias);
    }
  const existingFamily =
    entries.map((e) => e.duplicate?.session_id).find(Boolean) ??
    [...known.values()].map((d) => d.session_id).find(Boolean);
  const family = existingFamily ?? crypto.randomUUID();
  let ciphertextBytes = 0;
  const sealField = async (field: Parameters<typeof base.crypt.seal>[0], value: unknown) => {
    const body = await base.crypt.seal(field, value, version);
    ciphertextBytes += encryptedBytes(body);
    return body;
  };
  const seal = (table: string, column: string, recordId: string, value: unknown, aadRevision = 1) =>
    sealField({ ownerId: owner, table, column, recordId, aadRevision }, value);
  const roots = entries.filter((e) => e.unit.kind === 'legacy-reading' && !e.unit.parentIdentity);
  if (roots.length > 1) throw new RecordError(422, 'IMPORT_INVALID');
  if (!existingFamily && entries.some((e) => !e.duplicate && e.unit.kind !== 'portable')) {
    const root = roots[0]?.unit;
    if (!root || root.kind !== 'legacy-reading') throw new RecordError(422, 'IMPORT_INVALID');
    const question = await seal('reading_sessions', 'question_enc', family, {
      v: 1,
      text: root.record.question,
    });
    statements.push(
      q(
        base.db,
        `INSERT INTO reading_sessions(id,owner_id,status,question_enc,created_at,saved_at) VALUES(?,?,'saved',?,${DB_NOW},${DB_NOW})`,
        family,
        owner,
        question,
      ),
    );
  }
  for (const entry of entries) {
    const { unit, duplicate } = entry;
    const destination: Destination = duplicate ? { ...duplicate } : emptyDestination();
    if (!duplicate) {
      if (unit.kind === 'legacy-reading')
        Object.assign(destination, {
          entity_kind: 'edition',
          session_id: family,
          edition_id: crypto.randomUUID(),
        });
      else if (unit.kind === 'legacy-authored')
        Object.assign(destination, {
          entity_kind: 'reflection_revision',
          session_id: family,
          reflection_id: crypto.randomUUID(),
          reflection_revision: unit.identity.recordRevision,
        });
      else {
        const record = unit.record;
        const entityKey = JSON.stringify([
          unit.identity.source,
          record.kind,
          unit.identity.recordId,
        ]);
        const id = entityIds.get(entityKey) ?? crypto.randomUUID();
        entityIds.set(entityKey, id);
        if (record.kind === 'session')
          Object.assign(destination, { entity_kind: 'session', session_id: id });
        else if (record.kind === 'reading')
          Object.assign(destination, { entity_kind: 'edition', edition_id: id });
        else if (record.kind === 'reflection')
          Object.assign(destination, {
            entity_kind: 'reflection_revision',
            reflection_id: id,
            reflection_revision: record.value.revision,
          });
        else if (record.kind === 'revisit')
          Object.assign(destination, {
            entity_kind: 'revisit',
            revisit_id: id,
            revisit_revision: 'revision' in record.value ? record.value.revision : 1,
          });
        else
          destination.entity_kind = record.kind === 'generation_receipt' ? 'receipt' : record.kind;
      }
    }
    known.set(identityKey(unit.identity), destination);
    destinations.push(destination);
  }
  const ordered: typeof entries = [],
    pending = [...entries],
    done = new Set<string>([...known.keys()].filter((key) => !unitKeys.has(key)));
  while (pending.length) {
    const next = pending.findIndex((e) =>
      e.unit.dependencies.every(
        (d) =>
          d.recordRevision !== null &&
          done.has(identityKey({ ...d, recordRevision: d.recordRevision })),
      ),
    );
    if (next < 0) throw new RecordError(422, 'IMPORT_INVALID');
    const entry = pending.splice(next, 1)[0]!;
    ordered.push(entry);
    done.add(entry.unit.key);
  }
  let editionNumber = Number(
    await q(
      base.db,
      'SELECT coalesce(max(edition_number),0) n FROM reading_editions WHERE owner_id=? AND session_id=?',
      owner,
      family,
    ).first('n'),
  );
  const editionNumbers = new Map<string, number>([[family, editionNumber]]),
    authored = new Set<string>();
  for (const { unit, duplicate } of ordered) {
    if (duplicate) continue;
    const destination = known.get(unit.key)!;
    if (unit.kind === 'legacy-reading') {
      const record = LegacyRecord.parse({
        ...unit.record,
        identity: effectiveIdentity(unit.identity, header),
        parentIdentity: unit.parentIdentity ? effectiveIdentity(unit.parentIdentity, header) : null,
      });
      const body = ImportedReading.parse({
        kind: 'legacy.imported.v1',
        editionId: destination.edition_id,
        sessionId: family,
        editionNumber: ++editionNumber,
        importedAt: iso(Date.now()),
        record,
      });
      const encrypted = await seal('reading_editions', 'body_enc', destination.edition_id!, body);
      statements.push(
        q(
          base.db,
          `INSERT INTO reading_editions(id,owner_id,session_id,edition_number,parent_edition_id,status,mode,body_enc,key_version,accepted_at) VALUES(?,?,?,?,?,'imported','legacy',?,?,${DB_NOW})`,
          destination.edition_id,
          owner,
          family,
          editionNumber,
          unit.parentIdentity
            ? (known.get(identityKey(unit.parentIdentity))?.edition_id ?? null)
            : null,
          encrypted,
          version,
        ),
      );
    } else if (unit.kind === 'legacy-authored') {
      const parent = known.get(identityKey(unit.parentIdentity!));
      if (!parent?.edition_id || parent.session_id !== family)
        throw new RecordError(422, 'IMPORT_INVALID');
      const revision = destination.reflection_revision!;
      const body = Reflection.parse({
        id: destination.reflection_id,
        sessionId: family,
        editionId: parent.edition_id,
        revision,
        text: unit.record.text,
        stance: 'unspecified',
        updatedAt: iso(Date.now()),
      });
      const encrypted = await seal(
        'reflection_revisions',
        'body_enc',
        `${destination.reflection_id}:${revision}`,
        body,
        revision,
      );
      statements.push(
        q(
          base.db,
          'INSERT INTO reflections(id,owner_id,session_id,edition_id,current_revision) VALUES(?,?,?,?,?)',
          destination.reflection_id,
          owner,
          family,
          parent.edition_id,
          revision,
        ),
        q(
          base.db,
          `INSERT INTO reflection_revisions(reflection_id,owner_id,revision,body_enc,key_version,created_at) VALUES(?,?,?,?,?,${DB_NOW})`,
          destination.reflection_id,
          owner,
          revision,
          encrypted,
          version,
        ),
      );
    } else if (unit.kind === 'portable') {
      const record = unit.record;
      const dependency = (kind: string) =>
        unit.dependencies
          .filter((d) => d.kind === kind && d.recordRevision !== null)
          .map((d) => known.get(identityKey({ ...d, recordRevision: d.recordRevision! })))
          .find(Boolean);
      if (record.kind !== 'session')
        destination.session_id =
          dependency('session')?.session_id ?? dependency('reading')?.session_id ?? null;
      if (record.kind === 'session') {
        const encrypted = await seal('reading_sessions', 'question_enc', destination.session_id!, {
          v: 1,
          text: record.value.question,
        });
        statements.push(
          q(
            base.db,
            `INSERT INTO reading_sessions(id,owner_id,status,question_enc,created_at,saved_at) VALUES(?,?,'saved',?,${DB_NOW},${DB_NOW})`,
            destination.session_id,
            owner,
            encrypted,
          ),
        );
        editionNumbers.set(destination.session_id!, 0);
      } else if (record.kind === 'reading') {
        if (!destination.session_id) throw new RecordError(422, 'IMPORT_INVALID');
        if (!editionNumbers.has(destination.session_id))
          editionNumbers.set(
            destination.session_id,
            Number(
              await q(
                base.db,
                'SELECT coalesce(max(edition_number),0) n FROM reading_editions WHERE owner_id=? AND session_id=?',
                owner,
                destination.session_id,
              ).first('n'),
            ),
          );
        const number = (editionNumbers.get(destination.session_id) ?? 0) + 1;
        editionNumbers.set(destination.session_id, number);
        const parent = unit.parentIdentity
          ? (known.get(identityKey(unit.parentIdentity))?.edition_id ?? null)
          : null;
        if (unit.parentIdentity && !parent) throw new RecordError(422, 'IMPORT_INVALID');
        if (record.value.kind === 'reading.unavailable.v1') {
          statements.push(
            q(
              base.db,
              `INSERT INTO reading_editions(id,owner_id,session_id,edition_number,parent_edition_id,status,mode,body_enc,key_version,accepted_at,invalidated_at) VALUES(?,?,?,?,?,'withdrawn','legacy',NULL,?,${DB_NOW},${DB_NOW})`,
              destination.edition_id,
              owner,
              destination.session_id,
              number,
              parent,
              version,
            ),
          );
        } else {
          const legacy =
            record.value.kind === 'legacy.imported.v1'
              ? { ...record.value.record, identity: effectiveIdentity(unit.identity, header) }
              : LegacyRecord.parse({
                  format: 'reflection-import.v1',
                  identity: effectiveIdentity(unit.identity, header),
                  parentIdentity: unit.parentIdentity,
                  source: 'successor',
                  originalId: record.originalId,
                  originalParentId: record.value.parentEditionId,
                  originalTimestamp: record.value.acceptedAt,
                  occurredAt: record.value.acceptedAt,
                  question: record.value.question,
                  generatedText: editionContextText(record.value),
                  userStatements: [],
                  basis: {
                    method: 'tarot',
                    cards: [],
                    sourceIds: [],
                    rawBasisJson: JSON.stringify(record.value.basis),
                    verification: 'legacy_unverified',
                  },
                  originalJsonText: unit.originalJsonText,
                  originalSha256: unit.originalSha256,
                  provenanceGaps: ['review'],
                  review: 'legacy_unknown',
                });
          const body = ImportedReading.parse({
            kind: 'legacy.imported.v1',
            editionId: destination.edition_id,
            sessionId: destination.session_id,
            editionNumber: number,
            record: legacy,
            importedAt: iso(Date.now()),
          });
          const encrypted = await seal(
            'reading_editions',
            'body_enc',
            destination.edition_id!,
            body,
          );
          statements.push(
            q(
              base.db,
              `INSERT INTO reading_editions(id,owner_id,session_id,edition_number,parent_edition_id,status,mode,body_enc,key_version,accepted_at) VALUES(?,?,?,?,?,'imported','legacy',?,?,${DB_NOW})`,
              destination.edition_id,
              owner,
              destination.session_id,
              number,
              parent,
              encrypted,
              version,
            ),
          );
        }
      } else if (record.kind === 'reflection') {
        const parent = dependency('reading');
        if (!parent?.edition_id || !destination.session_id)
          throw new RecordError(422, 'IMPORT_INVALID');
        const revision = record.value.revision,
          id = destination.reflection_id!;
        const max = Math.max(
          ...entries
            .filter(
              (e) =>
                e.unit.identity.kind === 'reflection' &&
                e.unit.identity.recordId === unit.identity.recordId,
            )
            .map((e) => e.unit.identity.recordRevision),
        );
        if (!authored.has(id)) {
          statements.push(
            q(
              base.db,
              'INSERT INTO reflections(id,owner_id,session_id,edition_id,current_revision) VALUES(?,?,?,?,?)',
              id,
              owner,
              destination.session_id,
              parent.edition_id,
              max,
            ),
          );
          authored.add(id);
        }
        const body = Reflection.parse({
          ...record.value,
          id,
          sessionId: destination.session_id,
          editionId: parent.edition_id,
        });
        statements.push(
          q(
            base.db,
            'INSERT INTO reflection_revisions(reflection_id,owner_id,revision,body_enc,key_version,created_at) VALUES(?,?,?,?,?,?)',
            id,
            owner,
            revision,
            await seal('reflection_revisions', 'body_enc', `${id}:${revision}`, body, revision),
            version,
            Date.parse(body.updatedAt),
          ),
        );
      } else if (record.kind === 'revisit') {
        const parent = dependency('reading');
        if (!parent?.edition_id || !destination.session_id)
          throw new RecordError(422, 'IMPORT_INVALID');
        const id = destination.revisit_id!,
          revision = destination.revisit_revision!;
        const revisions = entries
          .map((e) => e.unit)
          .filter(
            (u): u is Extract<Unit, { kind: 'portable' }> =>
              u.kind === 'portable' &&
              u.record.kind === 'revisit' &&
              u.identity.recordId === unit.identity.recordId,
          );
        const latest = revisions.reduce((a, b) =>
          a.identity.recordRevision > b.identity.recordRevision ? a : b,
        );
        const bodyFor = (candidate: typeof record) =>
          RevisitV2.parse({
            ...candidate.value,
            kind: 'revisit.v2',
            id,
            sessionId: destination.session_id,
            editionId: parent.edition_id,
            revision: 'revision' in candidate.value ? candidate.value.revision : 1,
            stance: 'stance' in candidate.value ? candidate.value.stance : 'unspecified',
            updatedAt:
              'updatedAt' in candidate.value
                ? candidate.value.updatedAt
                : candidate.value.createdAt,
          });
        if (!authored.has(id)) {
          if (latest.record.kind !== 'revisit') throw new RecordError(422, 'IMPORT_INVALID');
          const body = bodyFor(latest.record),
            encrypted = await sealField(revisitField(owner, id, body.revision), body);
          statements.push(
            q(
              base.db,
              'INSERT INTO revisits(id,owner_id,edition_id,note_enc,key_version,created_at,session_id,current_revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
              id,
              owner,
              parent.edition_id,
              encrypted,
              version,
              Date.parse(body.createdAt),
              destination.session_id,
              body.revision,
              Date.parse(body.updatedAt),
            ),
          );
          authored.add(id);
        }
        if (revision !== latest.identity.recordRevision) {
          const body = bodyFor(record),
            encrypted = await sealField(revisitField(owner, id, revision, true), body);
          statements.push(
            q(
              base.db,
              'INSERT INTO revisit_revisions(revisit_id,owner_id,revision,body_enc,key_version,created_at) VALUES(?,?,?,?,?,?)',
              id,
              owner,
              revision,
              encrypted,
              version,
              Date.parse(body.updatedAt),
            ),
          );
        }
      }
    }
  }
  const provenance: Link[][] = [];
  for (const entry of entries) {
    const links: Link[] = [];
    for (const dependency of entry.unit.dependencies) {
      if (dependency.recordRevision === null) continue;
      const destination = known.get(
        identityKey({ ...dependency, recordRevision: dependency.recordRevision }),
      );
      if (destination) links.push(...destinationLinks(destination));
    }
    for (const reference of unitLinks(entry.unit)) {
      const kind = (
        {
          edition: 'reading',
          reflection_revision: 'reflection',
          revisit_revision: 'revisit',
          session: 'session',
        } as const
      )[reference.kind];
      const candidate = entries.find(
        (e) =>
          sameSource(e.unit.identity.source, entry.unit.identity.source) &&
          e.unit.identity.kind === kind &&
          (kind === 'session' ||
            kind === 'reading' ||
            e.unit.identity.recordRevision === reference.revision) &&
          (e.unit.identity.recordId === reference.id ||
            (e.unit.kind === 'portable' &&
              ('id' in e.unit.record.value
                ? e.unit.record.value.id
                : 'editionId' in e.unit.record.value
                  ? e.unit.record.value.editionId
                  : null) === reference.id)),
      );
      const existing = candidate ? known.get(candidate.unit.key) : undefined;
      if (existing) links.push(...destinationLinks(existing));
      else {
        const key = await hashes.key({
          source: header.source,
          kind,
          recordId: reference.id,
          recordRevision: reference.revision,
        });
        const alias = aliases.find(
          (a) => a.source_key_hmac === key && a.erased_at === null && a.withheld_at === null,
        );
        if (alias) links.push(...destinationLinks(alias));
      }
    }
    provenance.push(links);
  }
  return {
    statements,
    destinations,
    provenance,
    additionalBytes: statements.length * 1024 + ciphertextBytes,
  };
}
