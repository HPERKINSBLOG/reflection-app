import { expect, test, type Page } from '@playwright/test';
import { account, openAccount } from '../fixtures/browser-reading.ts';

const journal = {
  exportedAt: '2026-11-01T12:00:00Z',
  entryCount: 1,
  entries: [
    {
      id: 'practice',
      question: 'What made a smaller beginning possible?',
      personalReading: '<strong>Keep these original words as text.</strong>',
      cards: [],
    },
  ],
};
async function choose(page: Page, doc = journal) {
  await page.getByLabel('File format').selectOption('tarot-json');
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'practice.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await page.getByRole('button', { name: 'Read file', exact: true }).click();
  await page.getByRole('group', { name: 'Records in the file' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Review selected records', exact: true }).click();
  await expect(page.locator('.import-group')).toHaveCount(1);
}

test('confirmation and resumed review keep the question and exact original words recognizable', async ({
  page,
}) => {
  await account(page, '203.0.113.221');
  await openAccount(page);
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  await choose(page);
  const group = page.locator('.import-group');
  await expect(
    group.getByRole('heading', { name: journal.entries[0]!.question, exact: true }),
  ).toBeVisible();
  await expect(group.getByText(journal.entries[0]!.personalReading, { exact: true })).toBeVisible();
  await expect(group).toContainText('Original date unavailable');
  const id = await page.getByLabel('Import ID', { exact: true }).inputValue();
  await expect(group.getByText(id, { exact: true })).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  await page.getByLabel('Import ID', { exact: true }).fill(id);
  await page.getByRole('button', { name: 'Check import status', exact: true }).click();
  await expect(
    group.getByRole('heading', { name: journal.entries[0]!.question, exact: true }),
  ).toBeVisible();
  await expect(group.getByText(journal.entries[0]!.personalReading, { exact: true })).toBeVisible();
  expect(
    await group.locator('strong').filter({ hasText: 'Keep these original words' }).count(),
  ).toBe(0);
  await expect(
    group.getByRole('button', { name: 'Confirm this group', exact: true }),
  ).toBeEnabled();
});

test('an unchanged duplicate is explicitly skipped and never automatically committed or written twice', async ({
  page,
}) => {
  await account(page, '203.0.113.222');
  await openAccount(page);
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  await choose(page);
  await page.getByRole('button', { name: 'Confirm this group', exact: true }).click();
  await expect(page.getByText('Group complete.', { exact: true })).toBeVisible();
  const before = await (await page.request.get('/api/v1/sessions?status=saved')).json();
  let commits = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/imports\/groups\/[^/]+\/commit$/.test(request.url()))
      commits++;
  });
  await choose(page);
  const group = page.locator('.import-group');
  await expect(group.getByText('Already saved — skipped', { exact: true })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Confirm this group', exact: true })).toHaveCount(
    0,
  );
  expect(commits).toBe(0);
  await group.getByRole('button', { name: 'Finish review — no new records', exact: true }).click();
  await expect(page.getByText('Group complete.', { exact: true })).toBeVisible();
  expect(commits).toBe(1);
  const after = await (await page.request.get('/api/v1/sessions?status=saved')).json();
  expect(after.items.map((i: { id: string }) => i.id)).toEqual(
    before.items.map((i: { id: string }) => i.id),
  );
});

test('a changed import explains its remedy beside the disabled confirmation and previews the changed text', async ({
  page,
}) => {
  await account(page, '203.0.113.223');
  await openAccount(page);
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  await choose(page);
  await page.getByRole('button', { name: 'Confirm this group', exact: true }).click();
  await expect(page.getByText('Group complete.', { exact: true })).toBeVisible();
  const changed = structuredClone(journal);
  changed.entries[0]!.personalReading = 'A later interpretation needs deliberate review.';
  await choose(page, changed);
  const group = page.locator('.import-group');
  await expect(group.getByText(changed.entries[0]!.personalReading, { exact: true })).toBeVisible();
  await expect(group).toContainText('different content');
  await expect(group).toContainText('new source revision');
  await expect(
    group.getByRole('button', { name: 'Confirm this group', exact: true }),
  ).toBeDisabled();
  await expect(
    group.getByRole('button', { name: 'Review recovery options', exact: true }),
  ).toBeVisible();
});
