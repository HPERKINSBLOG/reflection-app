import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { account, openAccount, backToReadings } from '../fixtures/browser-reading.ts';
import { apiSchemas } from '../../src/contracts/index.ts';
import { openImportSelection } from '../fixtures/browser-import.ts';
import pattern7 from '../fixtures/imports/patternlike-0.7.0.json' with { type: 'json' };
import pattern8 from '../fixtures/imports/patternlike-0.8.0.json' with { type: 'json' };

test('review, interrupted commit, resume and exact reopen of an imported Tarot reading with AI off', async ({
  page,
}) => {
  await account(page, '203.0.113.213');
  await openAccount(page);
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  const question = 'x'.repeat(499) + '🌱';
  const text = '<script>window.importRan=true</script> Original interpretation.';
  const raw = {
    exportedAt: '2026-11-01T12:00:00Z',
    entryCount: 1,
    entries: [{ id: 'one', question, personalReading: text, cards: [] }],
  };
  await page.getByLabel('File format').selectOption('tarot-json');
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'journal.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(raw)),
  });
  await page.getByRole('button', { name: 'Read file', exact: true }).click();
  const rows = page.getByRole('group', { name: 'Records in the file' });
  await expect(rows.getByRole('checkbox')).not.toBeChecked();
  await rows.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Review selected records', exact: true }).click();
  const commit = page.getByRole('button', { name: /^Import \d+ records?$/ });
  await expect(commit).toBeEnabled();
  let calls = 0;
  await page.route('**/api/v1/imports/groups/*/commit', async (route) => {
    calls++;
    const r = await route.fetch();
    expect(r.ok(), await r.text()).toBeTruthy();
    await route.abort('failed');
  });
  await commit.click();
  await expect(page.getByText('Group complete.', { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  const id = await page.getByLabel('Import ID', { exact: true }).inputValue();
  await page.reload();
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  await page.getByLabel('Import ID', { exact: true }).fill(id);
  await page.getByRole('button', { name: 'Check import status', exact: true }).click();
  await expect(page.getByText('Group complete.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(
    question,
  );
  await backToReadings(page);
  await page.locator('.history-link').first().click();
  await expect(page.getByRole('heading', { name: question, exact: true })).toBeVisible();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.hasOwn(window, 'importRan'))).toBe(false);
  const me = apiSchemas.SessionView.parse(await (await page.request.get('/api/v1/me')).json());
  expect(me.permission.modelAllowed).toBe(false);
  const savedPath = new URL(page.url()).pathname;
  await openAccount(page);
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my records', exact: true }).click();
  const downloaded = await readFile((await (await pendingDownload).path())!, 'utf8');
  const pages = downloaded
    .trim()
    .split('\n')
    .map((line) => apiSchemas.ExportPage.parse(JSON.parse(line)));
  const archived = pages.flatMap((p) => p.records).find((r) => r.kind === 'reading');
  if (archived?.kind !== 'reading' || archived.value.kind !== 'legacy.imported.v1')
    throw new Error('Expected original imported reading');
  expect(archived.value.record.question).toBe(question);
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  const format = page.getByLabel('File format'),
    file = page.getByLabel('Import file', { exact: true });
  for (const [kind, document] of [
    [
      'reflection-import.v1',
      JSON.stringify({ format: 'reflection-import.v1', records: [archived.value.record] }),
    ],
    ['reflection-export.v1', downloaded],
  ] as const) {
    await openImportSelection(page);
    await format.selectOption(kind);
    await file.setInputFiles({
      name: 'canonical.json',
      mimeType: 'application/json',
      buffer: Buffer.from(document),
    });
    await page.getByRole('button', { name: 'Read file', exact: true }).click();
    const choice = page
      .getByRole('group', { name: 'Records in the file' })
      .getByRole('checkbox')
      .filter({ visible: true });
    await choice.first().check();
    await page.getByRole('button', { name: 'Review selected records' }).click();
    await expect(page.locator('.import-group').first()).toContainText('Already saved — skipped');
  }
  await page.goto(savedPath);
  await page.getByRole('button', { name: 'Delete reading', exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(page.getByText(/^No saved readings yet\./)).toBeVisible();
  expect((await page.request.get('/api/v1/readings/' + archived.value.editionId)).status()).toBe(
    410,
  );
  await page.unroute('**/api/v1/imports/groups/*/commit');
  await openAccount(page);
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'journal.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(raw)),
  });
  await page.getByRole('button', { name: 'Read file', exact: true }).click();
  await page.getByRole('group', { name: 'Records in the file' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Review selected records' }).click();
  await expect(
    page.getByRole('region', { name: 'Selected group preview', exact: true }),
  ).toContainText('previously deleted');
  await expect(page.getByRole('button', { name: /^Import \d+ records?$/ })).toBeDisabled();
  await openImportSelection(page);
  await page.getByText('Resolve a conflict or erased record', { exact: true }).click();
  await page.getByLabel('Recovery action').selectOption('reimport_erased');
  await page.getByRole('button', { name: 'Review selected records' }).click();
  await expect(page.locator('.import-group')).toContainText('Recreation in a new namespace');
  await page.getByRole('button', { name: /^Import \d+ records?$/ }).click();
  await expect(page.getByText('Group complete.', { exact: true })).toBeVisible();
});
test('versioned Patternlike files, native Pixel and invalid input are distinguishable before staging', async ({
  page,
}) => {
  await account(page, '203.0.113.214');
  await openAccount(page);
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  const format = page.getByLabel('File format'),
    file = page.getByLabel('Import file', { exact: true });
  for (const sample of [pattern7, pattern8]) {
    await format.selectOption('patternlike-export');
    await file.setInputFiles({
      name: 'pattern.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(sample)),
    });
    await page.getByRole('button', { name: 'Read file', exact: true }).click();
    await expect(
      page.getByRole('group', { name: 'Records in the file' }).getByRole('checkbox'),
    ).toHaveCount(1);
  }
  await format.selectOption('pixel-json');
  await expect(page.getByText(/Native Pixel files are unsupported/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read file', exact: true })).toBeDisabled();
  await format.selectOption('patternlike-export');
  await file.setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schema_version":"9.9"}'),
  });
  await page.getByRole('button', { name: 'Read file', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not read');
});

test('a staged group reopens by ID after reload and shows its original selection before confirmation', async ({
  page,
}) => {
  await account(page, '203.0.113.215');
  await openAccount(page);
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  await page.getByLabel('File format').selectOption('patternlike-export');
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'saved.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(pattern8)),
  });
  await page.getByRole('button', { name: 'Read file', exact: true }).click();
  await page.getByRole('group', { name: 'Records in the file' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Review selected records' }).click();
  await expect(page.getByRole('button', { name: /^Import \d+ records?$/ })).toBeEnabled();
  const group = await page.getByLabel('Import ID', { exact: true }).inputValue();
  await page.reload();
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  await page.getByLabel('Import ID', { exact: true }).fill(group);
  await page.getByRole('button', { name: 'Check import status', exact: true }).click();
  await expect(page.locator('.import-group')).toContainText('Ready to import');
  await expect(
    page.getByRole('region', { name: 'Selected group preview', exact: true }),
  ).toContainText(group);
  await page.getByRole('button', { name: /^Import \d+ records?$/ }).click();
  await expect(page.getByText('Group complete.', { exact: true })).toBeVisible();
});

test('changed journal content needs an explicit new source revision and expired review clears private file state', async ({
  page,
}) => {
  await account(page, '203.0.113.216');
  await openAccount(page);
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  const original = {
    exportedAt: '2026-11-01T00:00:00Z',
    entryCount: 1,
    entries: [
      {
        id: 'stable',
        question: 'What first helped?',
        personalReading: 'Private import text',
        cards: [],
      },
    ],
  };
  const choose = async (changed: boolean) => {
    await openImportSelection(page);
    const doc = structuredClone(original);
    if (changed) doc.entries[0]!.question = 'What changed?';
    await page.getByLabel('Import file', { exact: true }).setInputFiles({
      name: 'original.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(doc)),
    });
    await page.getByRole('button', { name: 'Read file', exact: true }).click();
    await page.getByRole('group', { name: 'Records in the file' }).getByRole('checkbox').check();
  };
  await choose(false);
  await page.getByRole('button', { name: 'Review selected records' }).click();
  await page.getByRole('button', { name: /^Import \d+ records?$/ }).click();
  await expect(page.getByText('Group complete.', { exact: true })).toBeVisible();
  await choose(true);
  await page.getByRole('button', { name: 'Review selected records' }).click();
  await expect(
    page.getByRole('region', { name: 'Selected group preview', exact: true }),
  ).toContainText('different content');
  await expect(page.getByRole('button', { name: /^Import \d+ records?$/ })).toBeDisabled();
  await openImportSelection(page);
  await page.getByText('Resolve a conflict or erased record', { exact: true }).click();
  await page.getByLabel('Recovery action').selectOption('new_revision');
  await page.getByLabel('New source revision', { exact: true }).fill('revision-2');
  await page.getByRole('button', { name: 'Review selected records' }).click();
  await expect(page.getByRole('button', { name: /^Import \d+ records?$/ })).toBeEnabled();
  await expect(page.locator('.import-group')).toContainText('New source revision');
  await page.context().clearCookies();
  await page.getByRole('button', { name: 'Check import status' }).click();
  await expect(
    page.getByText('Your session ended. Please sign in again.', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(
    'Private import text',
  );
  await expect(page.getByLabel('Import file', { exact: true })).toHaveCount(0);
});

test('an imported deletion reopens as the recorded unavailable edition without offering a follow-up', async ({
  page,
}) => {
  await account(page, '203.0.113.217');
  await openAccount(page);
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  const session = crypto.randomUUID(),
    edition = crypto.randomUUID(),
    source = { namespaceId: crypto.randomUUID(), revision: 'native-v1' },
    at = '2026-10-28T12:34:00.000Z';
  const records = [
    {
      kind: 'session',
      originalId: session,
      identity: { source, kind: 'session', recordId: session, recordRevision: 1 },
      value: {
        id: session,
        revision: 1,
        status: 'saved',
        question: 'Archived unavailable edition',
        editionIds: [edition],
        reflectionIds: [],
        savedAt: at,
        createdAt: at,
        requests: [],
      },
    },
    {
      kind: 'reading',
      originalId: edition,
      identity: { source, kind: 'reading', recordId: edition, recordRevision: 1 },
      value: {
        kind: 'reading.unavailable.v1',
        editionId: edition,
        sessionId: session,
        editionNumber: 1,
        parentEditionId: null,
        reason: 'deleted',
        unavailableAt: at,
      },
    },
  ];
  const file = apiSchemas.ExportPage.parse({
    format: 'reflection-export.v1',
    exportId: crypto.randomUUID(),
    snapshotRevision: 1,
    records,
    nextCursor: null,
    exportedAt: at,
    account: null,
  });
  await page.getByLabel('File format').selectOption('reflection-export.v1');
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'unavailable.ndjson',
    mimeType: 'application/x-ndjson',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await page.getByRole('button', { name: 'Read file' }).click();
  const choices = page.getByRole('group', { name: 'Records in the file' }).getByRole('checkbox');
  await choices.nth(0).check();
  await choices.nth(1).check();
  await page.getByRole('button', { name: 'Review selected records' }).click();
  await page.getByRole('button', { name: /^Import \d+ records?$/ }).click();
  await expect(page.getByText('Group complete.', { exact: true })).toBeVisible();
  await backToReadings(page);
  await page.locator('.history-link').click();
  await expect(page.getByText(/The import records this edition as deleted/)).toBeVisible();
  await expect(page.locator('time[datetime="2026-10-28T12:34:00.000Z"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Follow up on this edition' })).toHaveCount(0);
});
