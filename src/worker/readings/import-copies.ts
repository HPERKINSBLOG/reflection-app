import type { z } from 'zod';
import type { ImportRecordIdentity } from '../../contracts/index.ts';
import { importEntityInput } from '../../domain/imports/identity.ts';
import { DB_NOW, statement as q } from '../db/core.ts';
import { assertion } from '../identity/checkpoint.ts';
import type { Target } from '../recovery/ledger.ts';
import type { RecordBase } from './base.ts';
import { ContextCopies } from './context-copies.ts';
interface Destination {
  kind: string;
  id: string;
  revision: number;
  question_id: string | null;
}
const questionMaskPurpose = 'pending-import-question.v1';
async function sessionHash(base: RecordBase, owner: string, id: string, version: number) {
  return base.crypt.hashVersion(
    owner,
    'import',
    importEntityInput({
      source: { namespaceId: owner, revision: 'native-v1' },
      kind: 'session',
      recordId: id,
      recordRevision: 1,
    }),
    version,
  );
}
export async function pendingImportedQuestion(base: RecordBase, owner: string, id: string) {
  const version = await q(
    base.db,
    "SELECT key_version FROM accounts WHERE id=? AND EXISTS(SELECT 1 FROM deletion_jobs WHERE owner_id=accounts.id AND state!='complete')",
    owner,
  ).first<number>('key_version');
  if (version === null) return false;
  const hash = await sessionHash(base, owner, id, version),
    mask = await base.crypt.hashVersion(owner, questionMaskPurpose, owner, version);
  return !!(await q(
    base.db,
    'SELECT 1 FROM import_copy_sources WHERE owner_id=? AND source_entity_hmac=? AND dependent_entity_hmac=?',
    owner,
    hash,
    mask,
  ).first());
}
type RecordTarget = Exclude<Target, { scope: 'account' }>;
type Native = Pick<z.infer<typeof ImportRecordIdentity>, 'kind' | 'recordId' | 'recordRevision'>;

/** A keyed copy graph covers pending previews as well as committed records.
 * Capture its closure before detaching aliases or removing local foreign keys. */
export class ImportCopies {
  private constructor(
    private readonly base: RecordBase,
    private readonly owner: string,
    private readonly entities: string,
    private readonly target: RecordTarget,
    readonly destinations: Destination[] = [],
    private readonly questions: { id: string; hash: string; redacted: string }[] = [],
    private readonly mask = '',
    private readonly revision: number | null = null,
  ) {}
  static async find(base: RecordBase, target: RecordTarget) {
    const owner = target.subjectId,
      db = base.db;
    const inventory = await q(
      db,
      `SELECT key_version,data_revision FROM accounts WHERE id=? AND
      (EXISTS(SELECT 1 FROM import_items WHERE owner_id=accounts.id) OR EXISTS(SELECT 1 FROM import_identities WHERE owner_id=accounts.id) OR EXISTS(SELECT 1 FROM import_copy_sources WHERE owner_id=accounts.id))`,
      owner,
    ).first<{ key_version: number; data_revision: number }>();
    if (!inventory) return new ImportCopies(base, owner, '[]', target);
    const namespace = { namespaceId: owner, revision: 'native-v1' };
    const native: Native[] = [];
    let column: string, id: string, rev: number | undefined;
    if (target.scope === 'session') {
      column = 'session_id';
      id = target.sessionId;
      native.push({ kind: 'session', recordId: id, recordRevision: 1 });
      const rows = await q(
        db,
        `SELECT 'reading' kind,id recordId,1 recordRevision FROM reading_editions WHERE owner_id=? AND session_id=?
        UNION ALL SELECT 'reflection',f.id,r.revision FROM reflections f JOIN reflection_revisions r ON r.owner_id=f.owner_id AND r.reflection_id=f.id WHERE f.owner_id=? AND f.session_id=?
        UNION ALL SELECT 'revisit',id,0 FROM revisits WHERE owner_id=? AND session_id=?
        UNION ALL SELECT 'generation_receipt',id,revision FROM generation_requests WHERE owner_id=? AND session_id=?`,
        owner,
        id,
        owner,
        id,
        owner,
        id,
        owner,
        id,
      ).all<Native>();
      native.push(...rows.results);
    } else {
      const source =
        target.scope === 'context_copy'
          ? target.source
          : target.scope === 'revisit'
            ? { kind: 'revisit_revision' as const, revisitId: target.revisitId, revision: 1 }
            : {
                kind: 'reflection_revision' as const,
                reflectionId: target.reflectionId,
                revision: target.revision,
              };
      if (source.kind === 'edition') {
        column = 'edition_id';
        id = source.editionId;
        native.push({ kind: 'reading', recordId: id, recordRevision: 1 });
      } else if (source.kind === 'reflection_revision') {
        column = 'reflection_id';
        id = source.reflectionId;
        rev = source.revision;
        native.push({ kind: 'reflection', recordId: id, recordRevision: rev });
      } else {
        column = 'revisit_id';
        id = source.revisitId;
        rev = target.scope === 'revisit' ? undefined : source.revision;
        native.push({ kind: 'revisit', recordId: id, recordRevision: rev ?? 0 });
        if (rev === undefined) {
          const versions = await q(
            db,
            'SELECT revision FROM revisit_revisions WHERE owner_id=? AND revisit_id=? UNION SELECT current_revision FROM revisits WHERE owner_id=? AND id=?',
            owner,
            id,
            owner,
            id,
          ).all<{ revision: number }>();
          for (const r of versions.results)
            native.push({ kind: 'revisit', recordId: id, recordRevision: r.revision });
        }
      }
    }
    const roots = await Promise.all(
      native.map((x) =>
        base.crypt.hashVersion(
          owner,
          'import',
          importEntityInput({ ...x, source: namespace }),
          inventory.key_version,
        ),
      ),
    );
    const filter =
      column +
      '=?' +
      (rev === undefined
        ? ''
        : column === 'revisit_id'
          ? ' AND coalesce(revisit_revision,1)=?'
          : ' AND reflection_revision=?');
    const aliases = await q(
      db,
      'SELECT source_entity_hmac h FROM import_identities WHERE owner_id=? AND ' + filter,
      owner,
      id,
      ...(rev === undefined ? [] : [rev]),
    ).all<{ h: string }>();
    for (const a of aliases.results) roots.push(a.h);
    if (target.scope === 'session') {
      const previews = await q(
        db,
        'SELECT source_entity_hmac h FROM import_items WHERE owner_id=? AND session_id=? AND source_entity_hmac IS NOT NULL',
        owner,
        id,
      ).all<{ h: string }>();
      for (const a of previews.results) roots.push(a.h);
    }
    const inspected = new Set<string>();
    let entities: string, destinations: Destination[];
    // An imported mirror can be selected for a native request, whose edition can
    // itself appear in a later import. Close both graphs before detaching either.
    for (;;) {
      const graph = await q(
        db,
        `WITH RECURSIVE affected(h) AS (SELECT value FROM json_each(?) UNION SELECT dependent_entity_hmac FROM import_copy_sources e JOIN affected a ON e.source_entity_hmac=a.h WHERE e.owner_id=?) SELECT h FROM affected`,
        JSON.stringify([...new Set(roots)]),
        owner,
      ).all<{ h: string }>();
      entities = JSON.stringify(graph.results.map((e) => e.h));
      const rows = (
        await q(
          db,
          `SELECT DISTINCT i.entity_kind kind,
      coalesce(i.edition_id,i.reflection_id,i.revisit_id,i.session_id) id,
      coalesce(i.reflection_revision,i.revisit_revision,1) revision,
      CASE WHEN i.entity_kind='session' OR (e.edition_number=1 AND e.parent_edition_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM import_identities separate WHERE separate.owner_id=i.owner_id AND separate.session_id=i.session_id AND separate.entity_kind='session'))
        THEN i.session_id END question_id
      FROM import_identities i LEFT JOIN reading_editions e ON e.owner_id=i.owner_id AND e.id=i.edition_id
      WHERE i.owner_id=? AND i.entity_kind IN ('session','edition','reflection_revision','revisit') AND i.erased_at IS NULL
      AND i.source_entity_hmac IN(SELECT value FROM json_each(?))`,
          owner,
          entities,
        ).all<Destination>()
      ).results;
      // A copy-only intent retains its original source. A caller deleting a
      // particular imported edition has explicitly included that edition too.
      const source =
        target.scope === 'context_copy' && !target.eraseImportedEdition ? target.source : null;
      destinations = rows.filter(
        (d) =>
          !(
            (source?.kind === 'edition' && d.kind === 'edition' && d.id === source.editionId) ||
            (source?.kind === 'reflection_revision' &&
              d.kind === 'reflection_revision' &&
              d.id === source.reflectionId &&
              d.revision === source.revision) ||
            (source?.kind === 'revisit_revision' &&
              d.kind === 'revisit' &&
              d.id === source.revisitId &&
              d.revision === source.revision)
          ),
      );
      const derived = (
        await new ContextCopies(base, target, destinations).affectedEditions()
      ).results.filter((e) => !inspected.has(e.id));
      if (!derived.length) break;
      for (const { id } of derived) {
        inspected.add(id);
        roots.push(
          await base.crypt.hashVersion(
            owner,
            'import',
            importEntityInput({
              source: namespace,
              kind: 'reading',
              recordId: id,
              recordRevision: 1,
            }),
            inventory.key_version,
          ),
        );
      }
    }
    const questions = [];
    const mask = await base.crypt.hashVersion(
      owner,
      questionMaskPurpose,
      owner,
      inventory.key_version,
    );
    for (const id of new Set(
      destinations.map((d) => d.question_id).filter((id): id is string => id !== null),
    )) {
      if (target.scope === 'session' && id === target.sessionId) continue;
      questions.push({
        id,
        hash: await sessionHash(base, owner, id, inventory.key_version),
        redacted: await base.crypt.seal(
          {
            ownerId: owner,
            table: 'reading_sessions',
            column: 'question_enc',
            recordId: id,
            aadRevision: 1,
          },
          { v: 1, text: null },
          inventory.key_version,
        ),
      });
    }
    return new ImportCopies(
      base,
      owner,
      entities,
      target,
      destinations,
      questions,
      mask,
      inventory.data_revision,
    );
  }
  private where = 'owner_id=? AND source_entity_hmac IN (SELECT value FROM json_each(?))';
  private get args() {
    return [this.owner, this.entities] as const;
  }
  private get items() {
    return `owner_id=? AND (source_entity_hmac IN (SELECT value FROM json_each(?)) OR source_key_hmac IN
      (SELECT source_key_hmac FROM import_identities WHERE ${this.where}))`;
  }
  admissionGuard() {
    return this.revision === null
      ? assertion(
          this.base.db,
          `NOT EXISTS(SELECT 1 FROM import_identities WHERE owner_id=?) AND NOT EXISTS(SELECT 1 FROM import_items WHERE owner_id=?)`,
          this.owner,
          this.owner,
        )
      : assertion(
          this.base.db,
          'EXISTS(SELECT 1 FROM accounts WHERE id=? AND data_revision=?)',
          this.owner,
          this.revision,
        );
  }
  private typedFields(erasing: boolean) {
    if (!this.destinations.length) return [];
    const db = this.base.db,
      owner = this.owner,
      data = JSON.stringify(this.destinations);
    const ids = (kind: string, revision: boolean) =>
      `SELECT value->>'$.id'${revision ? ",value->>'$.revision'" : ''} FROM json_each(?) WHERE value->>'$.kind'='${kind}'`;
    const rows = [
      q(
        db,
        `UPDATE reading_editions SET ${erasing ? 'body_enc=NULL,' : ''}status='withdrawn',invalidated_at=coalesce(invalidated_at,${DB_NOW}) WHERE owner_id=? AND mode='legacy' AND status!='deleted' AND id IN (${ids('edition', false)})`,
        owner,
        data,
      ),
      q(
        db,
        `UPDATE reflection_revisions SET ${erasing ? 'body_enc=NULL,' : ''}erased_at=coalesce(erased_at,${DB_NOW}) WHERE owner_id=? AND (reflection_id,revision) IN (${ids('reflection_revision', true)})`,
        owner,
        data,
      ),
      q(
        db,
        `UPDATE reflections SET deleted_at=coalesce(deleted_at,${DB_NOW}) WHERE owner_id=? AND (id,current_revision) IN (${ids('reflection_revision', true)})`,
        owner,
        data,
      ),
      q(
        db,
        `UPDATE revisit_revisions SET ${erasing ? 'body_enc=NULL,' : ''}erased_at=coalesce(erased_at,${DB_NOW}) WHERE owner_id=? AND (revisit_id,revision) IN (${ids('revisit', true)})`,
        owner,
        data,
      ),
      q(
        db,
        `UPDATE revisits SET ${erasing ? 'note_enc=NULL,' : ''}deleted_at=coalesce(deleted_at,${DB_NOW}) WHERE owner_id=? AND (id,current_revision) IN (${ids('revisit', true)})`,
        owner,
        data,
      ),
    ];
    if (this.questions.length) {
      const masks = JSON.stringify(this.questions.map((x) => x.hash));
      if (erasing)
        rows.push(
          q(
            db,
            `UPDATE reading_sessions AS s SET question_enc=q.value->>'$.redacted' FROM json_each(?) q WHERE s.owner_id=? AND s.id=q.value->>'$.id' AND s.status!='deleted'`,
            JSON.stringify(this.questions),
            owner,
          ),
          q(
            db,
            'DELETE FROM import_copy_sources WHERE owner_id=? AND dependent_entity_hmac=? AND source_entity_hmac IN (SELECT value FROM json_each(?))',
            owner,
            this.mask,
            masks,
          ),
        );
      else
        rows.push(
          q(
            db,
            'INSERT OR IGNORE INTO import_copy_sources(owner_id,source_entity_hmac,dependent_entity_hmac) SELECT ?,value,? FROM json_each(?)',
            owner,
            this.mask,
            masks,
          ),
        );
    }
    return rows;
  }
  fence() {
    return this.typedFields(false);
  }
  erase() {
    const db = this.base.db,
      args = this.args,
      items = this.items,
      itemArgs = [...args, ...args];
    return [
      q(
        db,
        `UPDATE import_groups SET state='failed',lease_token=NULL,lease_until=NULL,preview_hash=NULL WHERE owner_id=? AND state IN('staged','committing') AND id IN (SELECT group_id FROM import_items WHERE ${items})`,
        this.owner,
        ...itemArgs,
      ),
      q(db, `DELETE FROM import_staging WHERE ${this.where}`, ...args),
      q(
        db,
        `UPDATE import_items SET body_enc=NULL,result_enc=NULL,session_id=NULL,state='erased' WHERE ${items}`,
        ...itemArgs,
      ),
      ...this.typedFields(true),
      ...(this.target.scope === 'context_copy' &&
      this.target.eraseImportedEdition &&
      this.target.source.kind === 'edition'
        ? [
            q(
              db,
              `UPDATE reading_editions SET body_enc=NULL,status='deleted',invalidated_at=coalesce(invalidated_at,${DB_NOW}) WHERE owner_id=? AND id=? AND mode='legacy'`,
              this.owner,
              this.target.source.editionId,
            ),
          ]
        : []),
      q(
        db,
        `UPDATE import_identities SET source_record_enc=NULL,session_id=NULL,edition_id=NULL,reflection_id=NULL,reflection_revision=NULL,revisit_id=NULL,revisit_revision=NULL,erased_at=coalesce(erased_at,${DB_NOW}) WHERE ${this.where}`,
        ...args,
      ),
    ];
  }
  erased() {
    return assertion(
      this.base.db,
      `NOT EXISTS(SELECT 1 FROM import_items WHERE (${this.items}) AND (body_enc IS NOT NULL OR result_enc IS NOT NULL)
      UNION ALL SELECT 1 FROM import_staging WHERE ${this.where} AND field_enc IS NOT NULL
      UNION ALL SELECT 1 FROM import_identities WHERE ${this.where} AND (source_record_enc IS NOT NULL OR erased_at IS NULL))`,
      ...this.args,
      ...this.args,
      ...this.args,
      ...this.args,
    );
  }
}
