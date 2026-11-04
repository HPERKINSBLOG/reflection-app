import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import nested from '../fixtures/imports/tarot-nested.json';
import { parseImportFile } from '../../src/domain/imports/parse.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { fixture, edited } from '../fixtures/revisits.ts';
import { ReadingImports } from '../../src/worker/readings/imports.ts';
import { OfflineRestore } from '../../src/worker/recovery/restore.ts';
import { cleanupBindings } from '../fixtures/cleanup.ts';
import { objects } from '../../src/worker/recovery/ledger.ts';
import { statement as q } from '../../src/worker/db/core.ts';
import { buildImportGroups } from '../../src/domain/imports/chunks.ts';
import { projectImportGroup } from '../../src/worker/readings/import-targets.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(async () => {
  await clearDatabase(env.DB);
  for (const o of await objects(env.RECOVERY, '')) await env.RECOVERY.delete(o.key);
});
const source = { namespaceId: '22222222-2222-4222-8222-222222222222', revision: 'imported' };
test('nested Tarot projects a saved session, its exact imported editions and separate authored revisions regardless of row order', async () => {
  const f = await fixture(),
    now = Date.UTC(2026, 10, 3);
  const parsed = await parseImportFile({
    format: 'tarot-json',
    document: JSON.stringify(nested),
    source,
    recovery: { kind: 'none' },
  });
  const items = [...parsed.units]
    .reverse()
    .map((unit, ordinal) => ({ unit, ordinal, duplicate: null }));
  const group = crypto.randomUUID();
  const projections = await projectImportGroup(
    f.session.subjectId,
    group,
    items,
    async () => null,
    now,
    f.base,
  );
  const root = items.find((i) => i.unit.kind === 'legacy-reading' && !i.unit.parentIdentity)!;
  const primary = projections.get(root.ordinal)!;
  expect(primary.target).toMatchObject({
    kind: 'edition',
    editionId: expect.any(String),
    sessionId: expect.any(String),
  });
  expect(primary.fields.map((f) => f.kind).sort()).toEqual(['edition', 'session']);
  expect(primary.localSources.map((s) => s.kind).sort()).toEqual(['reading', 'session']);
  const edition = primary.fields.find((v) => v.kind === 'edition')!.value as {
    kind: string;
    record: { generatedText: string; review: string; originalJsonText: string; question: string };
  };
  expect(edition).toMatchObject({
    kind: 'legacy.imported.v1',
    record: {
      generatedText: 'PARENT_PROSE',
      review: 'legacy_unknown',
      question: ' parent question 😀 ',
    },
  });
  expect(edition.record.originalJsonText).not.toContain('DESELECTED_CARD_NOTE');
  expect(projections.size).toBe(items.length);
  for (const item of items.filter((i) => i !== root)) {
    const p = projections.get(item.ordinal)!;
    expect(p.target.sessionId).toBe(primary.target.sessionId);
    if (item.unit.kind === 'legacy-authored') {
      expect(p.fields[0]!.value).toMatchObject({
        editionId: primary.target.editionId,
        text: item.unit.record.text,
        revision: 1,
      });
      expect(p.fields[0]!.targetId).toBe(p.target.reflectionId + ':1');
    } else if (item.unit.kind === 'legacy-reading') {
      expect(p.fields.find((field) => field.kind === 'edition')!.meta.parentEditionId).toBe(
        primary.target.editionId,
      );
    }
  }
  const orphan = items.find((i) => i.unit.kind === 'legacy-authored')!;
  await expect(
    projectImportGroup(
      f.session.subjectId,
      group,
      [orphan],
      async () => ({ kind: 'session', sessionId: primary.target.sessionId }),
      now,
      f.base,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});

test.each(['exact', 'whole'] as const)(
  '%s note replay reaches encrypted group outcomes after its local rows and aliases are lost, preserving other revisions unless the whole note was erased',
  async (scope) => {
    const f = await fixture(),
      author = await fixture();
    const { first, second } = await edited(author);
    const ticket = await author.exports.create(author.session, crypto.randomUUID());
    const page = await author.exports.page(author.session, ticket.id, null);
    const records = page.records.filter((r) => ['session', 'reading', 'revisit'].includes(r.kind));
    const parsed = await parseImportFile({
      format: 'reflection-export.v1',
      source: records[0]!.identity.source,
      recovery: { kind: 'none' },
      document: JSON.stringify({ ...page, records }),
    });
    const [group] = await buildImportGroups(parsed.units, () => crypto.randomUUID());
    const imports = new ReadingImports(env.DB, f.base.identity);
    for (const chunk of group!.chunks) await imports.preview(f.session, crypto.randomUUID(), chunk);
    const status = await imports.groupStatus(f.session, group!.id);
    expect(
      (
        await imports.commitGroup(f.session, group!.id, crypto.randomUUID(), {
          version: 'import-group.v1',
          manifestHash: group!.manifestHash,
          previewHash: status.previewHash!,
          confirmedRecovery: { kind: 'none' },
        })
      ).state,
    ).toBe('complete');
    const rows = (
      await q(
        env.DB,
        "SELECT revisit_id,revisit_revision,source_entity_hmac FROM import_identities WHERE owner_id=? AND entity_kind='revisit' ORDER BY revisit_revision",
        f.session.subjectId,
      ).all<{ revisit_id: string; revisit_revision: number; source_entity_hmac: string }>()
    ).results;
    expect(rows.map((r) => r.revisit_revision)).toEqual([1, 2]);
    const local = rows[0]!.revisit_id;
    expect((await f.notes.read(f.session, local, 1)).note).toBe(first.note);
    expect((await f.notes.read(f.session, local, 2)).note).toBe(second.note);
    const erased = (entity: string) =>
      q(
        env.DB,
        'SELECT result_enc IS NULL AS erased FROM import_items WHERE owner_id=? AND source_entity_hmac=?',
        f.session.subjectId,
        entity,
      ).first('erased');
    expect(await erased(rows[0]!.source_entity_hmac)).toBe(0);
    expect(await erased(rows[1]!.source_entity_hmac)).toBe(0);
    await env.DB.batch([
      q(
        env.DB,
        'DELETE FROM import_identities WHERE owner_id=? AND revisit_id=?',
        f.session.subjectId,
        local,
      ),
      q(env.DB, 'DELETE FROM revisits WHERE owner_id=? AND id=?', f.session.subjectId, local),
    ]);
    const id = crypto.randomUUID();
    const target =
      scope === 'exact'
        ? {
            scope: 'context_copy' as const,
            subjectId: f.session.subjectId,
            source: { kind: 'revisit_revision' as const, revisitId: local, revision: 1 },
          }
        : { scope: 'revisit' as const, subjectId: f.session.subjectId, revisitId: local };
    await f.erase.ledger.putIntent(await f.erase.ledger.create(target, id, null, Date.now()));
    expect((await new OfflineRestore(cleanupBindings()).replay()).status).toBe('verified');
    expect(await erased(rows[0]!.source_entity_hmac)).toBe(1);
    expect(await erased(rows[1]!.source_entity_hmac)).toBe(scope === 'whole' ? 1 : 0);
  },
);
