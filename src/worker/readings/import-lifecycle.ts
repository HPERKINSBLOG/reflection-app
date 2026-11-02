import type { Target } from '../recovery/ledger.ts';
import type { RecordBase } from './base.ts';
import type { Destination } from './import-materialize.ts';
import { statement as q, DB_NOW } from '../db/core.ts';
import type { Unit } from '../../domain/imports/types.ts';

export type Link = {
  kind: 'session' | 'edition' | 'reflection_revision' | 'revisit_revision';
  id: string;
  revision: number;
};
export function destinationLinks(dest: Destination): Link[] {
  return [
    ...(dest.session_id ? [{ kind: 'session' as const, id: dest.session_id, revision: 1 }] : []),
    ...(dest.edition_id ? [{ kind: 'edition' as const, id: dest.edition_id, revision: 1 }] : []),
    ...(dest.reflection_id
      ? [
          {
            kind: 'reflection_revision' as const,
            id: dest.reflection_id,
            revision: dest.reflection_revision!,
          },
        ]
      : []),
    ...(dest.revisit_id
      ? [
          {
            kind: 'revisit_revision' as const,
            id: dest.revisit_id,
            revision: dest.revisit_revision ?? 1,
          },
        ]
      : []),
  ];
}
export function nativeLinks(owner: string, unit: Unit): Link[] {
  if (
    unit.identity.source.namespaceId !== owner ||
    !/^(native-v1|snapshot-[0-9]+)$/.test(unit.identity.source.revision)
  )
    return [];
  return unitLinks(unit);
}
/** Typed references are copy-erasure provenance only; they never confer ownership or grants. */
export function unitLinks(unit: Unit): Link[] {
  const links: Link[] = [];
  const kind = (
    {
      session: 'session',
      reading: 'edition',
      reflection: 'reflection_revision',
      revisit: 'revisit_revision',
    } as const
  )[unit.identity.kind as 'session'];
  if (kind)
    links.push({ kind, id: unit.identity.recordId, revision: unit.identity.recordRevision });
  if (unit.kind !== 'portable') return links;
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const row = value as Record<string, unknown>;
    if (typeof row.sessionId === 'string')
      links.push({ kind: 'session', id: row.sessionId, revision: 1 });
    if (typeof row.editionId === 'string')
      links.push({ kind: 'edition', id: row.editionId, revision: 1 });
    if (
      typeof row.sourceId === 'string' &&
      ['edition', 'reflection_revision', 'revisit_revision'].includes(String(row.sourceKind))
    )
      links.push({
        kind: row.sourceKind as Link['kind'],
        id: row.sourceId,
        revision: Number(row.sourceRevision ?? 1),
      });
    if (row.kind === 'edition' && typeof row.editionId === 'string')
      links.push({ kind: 'edition', id: row.editionId, revision: 1 });
    if (row.kind === 'reflection_revision' && typeof row.reflectionId === 'string')
      links.push({
        kind: 'reflection_revision',
        id: row.reflectionId,
        revision: Number(row.revision),
      });
    if (row.kind === 'revisit_revision' && typeof row.revisitId === 'string')
      links.push({ kind: 'revisit_revision', id: row.revisitId, revision: Number(row.revision) });
    Object.values(row).forEach(visit);
  };
  visit(unit.record.value);
  return links;
}
export function copyLinks(
  base: RecordBase,
  owner: string,
  kind: 'item' | 'alias',
  id: string,
  links: Link[],
) {
  return [...new Map(links.map((l) => [JSON.stringify(l), l])).values()].map((l) =>
    q(
      base.db,
      'INSERT OR IGNORE INTO import_copy_sources(owner_id,copy_kind,copy_id,source_kind,source_id,source_revision) VALUES(?,?,?,?,?,?)',
      owner,
      kind,
      id,
      l.kind,
      l.id,
      l.revision,
    ),
  );
}
function targetCondition(target: Exclude<Target, { scope: 'account' }>) {
  if (target.scope === 'session')
    return {
      copy: "source_kind='session' AND source_id=?",
      copyArgs: [target.sessionId],
      alias: 'session_id=?',
      aliasArgs: [target.sessionId],
    };
  if (target.scope === 'revisit')
    return {
      copy: "source_kind='revisit_revision' AND source_id=?",
      copyArgs: [target.revisitId],
      alias: 'revisit_id=?',
      aliasArgs: [target.revisitId],
    };
  const source =
    target.scope === 'context_copy'
      ? target.source
      : {
          kind: 'reflection_revision' as const,
          reflectionId: target.reflectionId,
          revision: target.revision,
        };
  if (source.kind === 'edition')
    return {
      copy: "source_kind='edition' AND source_id=?",
      copyArgs: [source.editionId],
      alias: 'edition_id=?',
      aliasArgs: [source.editionId],
    };
  if (source.kind === 'reflection_revision')
    return {
      copy: "source_kind='reflection_revision' AND source_id=? AND source_revision=?",
      copyArgs: [source.reflectionId, source.revision],
      alias: 'reflection_id=? AND reflection_revision=?',
      aliasArgs: [source.reflectionId, source.revision],
    };
  return {
    copy: "source_kind='revisit_revision' AND source_id=? AND source_revision=?",
    copyArgs: [source.revisitId, source.revision],
    alias: 'revisit_id=? AND (revisit_revision=? OR revisit_revision IS NULL)',
    aliasArgs: [source.revisitId, source.revision],
  };
}
function selection(owner: string, target: Exclude<Target, { scope: 'account' }>) {
  const s = targetCondition(target);
  // Erasing shared copies must preserve the primary source and its own portable provenance.
  const primary =
    target.scope === 'context_copy' ? `NOT coalesce((${s.alias}),0) AND` : `(${s.alias}) OR`;
  const aliases = `SELECT source_key_hmac FROM import_identities WHERE owner_id=? AND (${primary} source_key_hmac IN(SELECT copy_id FROM import_copy_sources WHERE owner_id=? AND copy_kind='alias' AND (${s.copy})))`;
  const aliasArgs = [owner, ...s.aliasArgs, owner, ...s.copyArgs];
  const items = `SELECT batch_id || ':' || item_index FROM import_items WHERE owner_id=? AND (source_entity_hmac IN(SELECT source_entity_hmac FROM import_identities WHERE owner_id=? AND source_key_hmac IN(${aliases})) OR batch_id || ':' || item_index IN(SELECT copy_id FROM import_copy_sources WHERE owner_id=? AND copy_kind='item' AND (${s.copy})))`;
  const itemArgs = [owner, owner, ...aliasArgs, owner, ...s.copyArgs];
  return { aliases, aliasArgs, items, itemArgs };
}
export function importFence(base: RecordBase, target: Exclude<Target, { scope: 'account' }>) {
  const s = selection(target.subjectId, target);
  return [
    ...materializedFence(base, target, s),
    q(
      base.db,
      `UPDATE import_items SET withheld_at=coalesce(withheld_at,${DB_NOW}) WHERE owner_id=? AND batch_id || ':' || item_index IN(${s.items})`,
      target.subjectId,
      ...s.itemArgs,
    ),
    q(
      base.db,
      `UPDATE import_identities SET withheld_at=coalesce(withheld_at,${DB_NOW}) WHERE owner_id=? AND source_key_hmac IN(${s.aliases})`,
      target.subjectId,
      ...s.aliasArgs,
    ),
    q(
      base.db,
      `UPDATE import_groups SET state='failed' WHERE owner_id=? AND state IN('staged','committing') AND id IN(SELECT group_id FROM import_items WHERE owner_id=? AND batch_id || ':' || item_index IN(${s.items}))`,
      target.subjectId,
      target.subjectId,
      ...s.itemArgs,
    ),
  ];
}
function materializedFence(
  base: RecordBase,
  target: Exclude<Target, { scope: 'account' }>,
  s: ReturnType<typeof selection>,
) {
  const selected = `owner_id=? AND materialized=1 AND source_key_hmac IN(${s.aliases})`,
    args = [target.subjectId, ...s.aliasArgs];
  return [
    q(
      base.db,
      `UPDATE reading_sessions SET status='deleted' WHERE owner_id=? AND id IN(SELECT session_id FROM import_identities WHERE ${selected} AND entity_kind='session')`,
      target.subjectId,
      ...args,
    ),
    q(
      base.db,
      `UPDATE reading_editions SET status='withdrawn',invalidated_at=coalesce(invalidated_at,${DB_NOW}) WHERE owner_id=? AND id IN(SELECT edition_id FROM import_identities WHERE ${selected})`,
      target.subjectId,
      ...args,
    ),
    q(
      base.db,
      `UPDATE reflection_revisions SET erased_at=coalesce(erased_at,${DB_NOW}) WHERE owner_id=? AND (reflection_id,revision) IN(SELECT reflection_id,reflection_revision FROM import_identities WHERE ${selected})`,
      target.subjectId,
      ...args,
    ),
    q(
      base.db,
      `UPDATE revisits SET deleted_at=coalesce(deleted_at,${DB_NOW}) WHERE owner_id=? AND (id,current_revision) IN(SELECT revisit_id,revisit_revision FROM import_identities WHERE ${selected})`,
      target.subjectId,
      ...args,
    ),
    q(
      base.db,
      `UPDATE revisit_revisions SET erased_at=coalesce(erased_at,${DB_NOW}) WHERE owner_id=? AND (revisit_id,revision) IN(SELECT revisit_id,revisit_revision FROM import_identities WHERE ${selected})`,
      target.subjectId,
      ...args,
    ),
  ];
}
export function eraseImportCopies(base: RecordBase, target: Exclude<Target, { scope: 'account' }>) {
  const owner = target.subjectId,
    s = selection(owner, target);
  const selected = `owner_id=? AND source_key_hmac IN(${s.aliases})`,
    args = [owner, ...s.aliasArgs];
  const selectedItems = `owner_id=? AND batch_id || ':' || item_index IN(${s.items})`,
    itemArgs = [owner, ...s.itemArgs];
  return [
    ...materializedFence(base, target, s),
    q(
      base.db,
      `UPDATE import_groups SET header_enc=NULL,state=CASE WHEN state='complete' THEN state ELSE 'failed' END WHERE owner_id=? AND id IN(SELECT group_id FROM import_items WHERE ${selectedItems})`,
      owner,
      ...itemArgs,
    ),
    q(
      base.db,
      `UPDATE import_items SET body_enc=NULL,result_enc=NULL,session_id=NULL WHERE ${selectedItems}`,
      ...itemArgs,
    ),
    q(
      base.db,
      `UPDATE reading_editions SET body_enc=NULL,status='withdrawn',invalidated_at=coalesce(invalidated_at,${DB_NOW}) WHERE owner_id=? AND id IN(SELECT edition_id FROM import_identities WHERE ${selected} AND materialized=1)`,
      owner,
      ...args,
    ),
    q(
      base.db,
      `UPDATE reflection_revisions SET body_enc=NULL,erased_at=coalesce(erased_at,${DB_NOW}) WHERE owner_id=? AND (reflection_id,revision) IN(SELECT reflection_id,reflection_revision FROM import_identities WHERE ${selected} AND materialized=1)`,
      owner,
      ...args,
    ),
    q(
      base.db,
      `UPDATE reading_sessions SET question_enc=NULL WHERE owner_id=? AND id IN(SELECT session_id FROM import_identities WHERE ${selected} AND entity_kind='session' AND materialized=1)`,
      owner,
      ...args,
    ),
    q(
      base.db,
      `UPDATE revisits SET note_enc=NULL WHERE owner_id=? AND (id,current_revision) IN(SELECT revisit_id,revisit_revision FROM import_identities WHERE ${selected} AND materialized=1)`,
      owner,
      ...args,
    ),
    q(
      base.db,
      `UPDATE revisit_revisions SET body_enc=NULL WHERE owner_id=? AND (revisit_id,revision) IN(SELECT revisit_id,revisit_revision FROM import_identities WHERE ${selected} AND materialized=1)`,
      owner,
      ...args,
    ),
    q(
      base.db,
      `UPDATE import_identities SET source_record_enc=NULL,session_id=NULL,edition_id=NULL,reflection_id=NULL,reflection_revision=NULL,revisit_id=NULL,revisit_revision=NULL,erased_at=coalesce(erased_at,${DB_NOW}) WHERE ${selected}`,
      ...args,
    ),
  ];
}
export function importCopyViolations(
  base: Pick<RecordBase, 'db'>,
  target: Exclude<Target, { scope: 'account' }>,
) {
  const s = selection(target.subjectId, target);
  return [
    q(
      base.db,
      `SELECT 1 FROM import_identities WHERE owner_id=? AND source_key_hmac IN(${s.aliases}) AND source_record_enc IS NOT NULL LIMIT 1`,
      target.subjectId,
      ...s.aliasArgs,
    ),
    q(
      base.db,
      `SELECT 1 FROM import_items WHERE owner_id=? AND batch_id || ':' || item_index IN(${s.items}) AND (body_enc IS NOT NULL OR result_enc IS NOT NULL) LIMIT 1`,
      target.subjectId,
      ...s.itemArgs,
    ),
  ];
}
