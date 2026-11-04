import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas } from '../../src/contracts/index.ts';
import { parseImportFile } from '../../src/domain/imports/parse.ts';
import { buildImportGroups } from '../../src/domain/imports/chunks.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { readingAccount } from '../fixtures/reading-client.ts';
beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));
test('owned import HTTP enforces credential and 2 MiB streaming bounds, and commits exactly one confirmed group with AI off', async () => {
  const { client } = await readingAccount(true, false);
  const source = { namespaceId: crypto.randomUUID(), revision: 'file' };
  const recovery = { kind: 'none' as const };
  const parsed = await parseImportFile({
    source,
    recovery,
    format: 'tarot-json',
    document: JSON.stringify({
      entryCount: 1,
      entries: [{ id: 'row', question: 'File test', cards: [] }],
      exportedAt: '2026-10-13T09:00:00Z',
    }),
  });
  const [g] = await buildImportGroups(parsed.units, () => crypto.randomUUID());
  expect(
    (await client.request('/imports', g!.chunks[0], { headers: { 'X-CSRF-Token': 'forged' } }))
      .status,
  ).toBe(403);
  expect((await client.request('/imports', { padding: 'x'.repeat(2 * 1024 * 1024) })).status).toBe(
    413,
  );
  const preview = await client.request('/imports', g!.chunks[0]);
  expect(preview.status, await preview.clone().text()).toBe(201);
  expect(apiSchemas.ImportPreview.parse(await preview.json()).items).toHaveLength(1);
  const path = '/imports/groups/' + g!.id;
  const state = apiSchemas.ImportGroupStatus.parse(await (await client.request(path)).json());
  expect(state.state).toBe('staged');
  const input = {
      version: 'import-group.v1',
      manifestHash: g!.manifestHash,
      previewHash: state.previewHash,
      confirmedRecovery: recovery,
    },
    key = crypto.randomUUID();
  const other = await readingAccount(true, false);
  expect((await other.client.request(path)).status).toBe(404);
  const commit = await client.request(path + '/commit', input, { key });
  expect(commit.status, await commit.clone().text()).toBe(200);
  expect((await client.request(path + '/commit', input, { key })).status).toBe(200);
  expect(
    apiSchemas.ImportGroupResultPage.parse(await (await client.request(path + '/results')).json())
      .items[0]?.status,
  ).toBe('imported');
  expect(await env.DB.prepare('SELECT count(*) n FROM provider_dispatches').first('n')).toBe(0);
});
