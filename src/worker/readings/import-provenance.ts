import type { Unit, Identity } from '../../domain/imports/types.ts';
import { sameSource } from '../../domain/imports/identity.ts';
import { type RecordBase, RecordError } from './base.ts';
import { effectiveIdentity, importHashers, type AliasRow, type Header } from './import-model.ts';
import { destinationLinks, unitLinks, type Link } from './import-lifecycle.ts';
import { statement as q, DB_NOW } from '../db/core.ts';

/** Resolve already-owned foreign references before retaining their private copies. */
export async function resolvedImportLinks(
  base: RecordBase,
  owner: string,
  version: number,
  unit: Unit,
  header: Header,
  aliases: AliasRow[],
): Promise<Link[]> {
  const hashes = await importHashers(base, owner, version),
    links: Link[] = [];
  const identities: Identity[] = unit.dependencies.flatMap((d) =>
    d.recordRevision === null ? [] : [{ ...d, recordRevision: d.recordRevision }],
  );
  for (const reference of unitLinks(unit)) {
    const kind = (
      {
        session: 'session',
        edition: 'reading',
        reflection_revision: 'reflection',
        revisit_revision: 'revisit',
      } as const
    )[reference.kind];
    if (
      kind === unit.identity.kind &&
      reference.id === unit.identity.recordId &&
      (kind === 'reading' || reference.revision === unit.identity.recordRevision)
    )
      continue;
    identities.push({
      source: unit.identity.source,
      kind,
      recordId: reference.id,
      recordRevision: reference.revision,
    });
  }
  for (const original of identities) {
    const previous =
      header.recovery.kind === 'none' ? header.source : header.recovery.previousSource;
    const identity = sameSource(original.source, previous)
      ? effectiveIdentity(original, header)
      : original;
    const key = await hashes.key(identity),
      family = await hashes.family(identity);
    const matches = aliases.filter(
      (a) =>
        a.source_key_hmac === key ||
        (identity.kind === 'reading' && a.source_family_hmac === family),
    );
    if (matches.some((a) => a.erased_at !== null || a.withheld_at !== null))
      throw new RecordError(410, 'CONTENT_UNAVAILABLE');
    for (const alias of matches) links.push(...destinationLinks(alias));
  }
  return [...new Map(links.map((link) => [JSON.stringify(link), link])).values()];
}

// Source identities deliberately have no FK: a missing primary row is unavailable too.
export const unavailableImportSource = `(p.source_kind='session' AND NOT EXISTS(SELECT 1 FROM reading_sessions s WHERE s.owner_id=p.owner_id AND s.id=p.source_id AND s.status!='deleted' AND (s.status='saved' OR s.retention_expires_at>${DB_NOW})))
 OR (p.source_kind='edition' AND NOT EXISTS(SELECT 1 FROM reading_editions e LEFT JOIN content_editions c ON c.hash=e.content_hash WHERE e.owner_id=p.owner_id AND e.id=p.source_id AND e.status IN('accepted','imported') AND e.body_enc IS NOT NULL AND (c.state IS NULL OR c.state!='withdrawn')))
 OR (p.source_kind='reflection_revision' AND NOT EXISTS(SELECT 1 FROM reflection_revisions r WHERE r.owner_id=p.owner_id AND r.reflection_id=p.source_id AND r.revision=p.source_revision AND r.erased_at IS NULL AND r.body_enc IS NOT NULL))
 OR (p.source_kind='revisit_revision' AND NOT EXISTS(SELECT 1 FROM revisits n LEFT JOIN revisit_revisions r ON r.owner_id=n.owner_id AND r.revisit_id=n.id AND r.revision=p.source_revision WHERE n.owner_id=p.owner_id AND n.id=p.source_id AND n.deleted_at IS NULL AND ((n.current_revision=p.source_revision AND n.note_enc IS NOT NULL) OR (r.body_enc IS NOT NULL AND r.erased_at IS NULL))))`;

export async function importCopyUnavailable(
  base: RecordBase,
  owner: string,
  kind: 'item' | 'alias',
  id: string,
) {
  return !!(await q(
    base.db,
    `SELECT 1 FROM import_copy_sources p WHERE p.owner_id=? AND p.copy_kind=? AND p.copy_id=? AND (${unavailableImportSource}) LIMIT 1`,
    owner,
    kind,
    id,
  ).first());
}
export async function importedReadingUnavailable(base: RecordBase, owner: string, edition: string) {
  return !!(await q(
    base.db,
    `SELECT 1 FROM import_identities a JOIN import_copy_sources p ON p.owner_id=a.owner_id AND p.copy_kind='alias' AND p.copy_id=a.source_key_hmac WHERE a.owner_id=? AND a.edition_id=? AND a.materialized=1 AND (${unavailableImportSource}) LIMIT 1`,
    owner,
    edition,
  ).first());
}
export async function importGroupUnavailable(base: RecordBase, owner: string, group: string) {
  return !!(await q(
    base.db,
    `SELECT 1 FROM import_copy_sources p JOIN import_items i ON i.owner_id=p.owner_id AND p.copy_kind='item' AND p.copy_id=i.batch_id || ':' || i.item_index WHERE i.owner_id=? AND i.group_id=? AND (${unavailableImportSource}) LIMIT 1`,
    owner,
    group,
  ).first());
}
