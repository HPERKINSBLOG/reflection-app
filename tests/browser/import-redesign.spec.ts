import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { account, openAccount } from '../fixtures/browser-reading.ts';
import { openImportSelection } from '../fixtures/browser-import.ts';

type Entry = {
  id: string;
  question: string;
  personalReading: string;
  cards: never[];
  reflections?: Record<string, string>;
  followUps?: { turnNumber: number; question: string; answer: string }[];
};
const first: Entry = {
  id: 'quiet-week',
  question: 'Room for a quieter week',
  personalReading: 'Give your attention to one commitment you can sustain.',
  cards: [],
};
const second: Entry = {
  id: 'second-start',
  question: 'A second independent beginning',
  personalReading: 'These separate words must not be saved by confirming another group.',
  cards: [],
};
const duplicate: Entry = {
  id: 'steady-pace',
  question: 'Finding a steadier pace',
  personalReading: 'This original reading is already in the journal.',
  cards: [],
};
const missingParent: Entry = {
  id: 'parent-not-selected',
  question: 'Parent deliberately outside this review',
  personalReading: 'This parent was not selected for upload.',
  cards: [],
  followUps: [
    {
      turnNumber: 1,
      question: 'How might I respond differently?',
      answer: 'This child needs its original parent.',
    },
  ],
};
const family = (): Entry => ({
  ...first,
  reflections: { Reflection: 'I want to stop treating every open task as urgent.' },
  followUps: [
    {
      turnNumber: 1,
      question: 'What can I leave unfinished this week?',
      answer: '<strong>Keep these original words as plain text.</strong>',
    },
  ],
});
async function review(page: Page, entries: Entry[], omitParent = false) {
  await openImportSelection(page);
  await page.getByLabel('File format').selectOption('tarot-json');
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'tarot-journal.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ exportedAt: '2026-11-01T12:00:00Z', entryCount: entries.length, entries }),
    ),
  });
  await page.getByRole('button', { name: 'Read file', exact: true }).click();
  const choices = page.getByRole('group', { name: 'Records in the file', exact: true });
  await expect(choices.getByRole('checkbox').first()).toBeVisible();
  for (const checkbox of await choices.getByRole('checkbox').all()) await checkbox.check();
  if (omitParent)
    await choices
      .getByRole('checkbox', { name: /^Parent deliberately outside this review/ })
      .uncheck();
  await page.getByRole('button', { name: 'Review selected records', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Reading groups', exact: true })).toBeVisible();
}
function preview(page: Page, question: string) {
  return page.getByRole('button', { name: `Preview ${question}`, exact: true });
}
async function history(page: Page) {
  const response = await page.request.get('/api/v1/sessions?status=saved&method=all');
  expect(response.ok()).toBe(true);
  return (await response.json()) as { items: { id: string; question: string }[] };
}

test('preview switches without importing and a mixed duplicate group commits only its new records', async ({
  page,
}) => {
  await account(page, '203.0.113.231');
  await openAccount(page);
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  await review(page, [first]);
  await page.getByRole('button', { name: /^Import \d+ records?$/ }).click();
  await expect(page.getByText('Group complete.', { exact: true })).toBeVisible();
  const original = (await history(page)).items[0]!;
  let commits = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/imports\/groups\/[^/]+\/commit$/.test(request.url()))
      commits++;
  });
  await review(page, [family(), second]);
  const panel = page.getByRole('region', { name: 'Selected group preview', exact: true });
  const summary = page.getByRole('region', { name: 'Import summary', exact: true });
  const confirm = page.getByRole('button', { name: /^Import \d+ records?$/ });
  await expect(panel).toContainText(first.personalReading);
  await expect(preview(page, first.question)).toHaveAttribute('aria-pressed', 'true');
  await expect(confirm).toHaveText('Import 2 records');
  await expect(confirm).toHaveAccessibleName('Import 2 records');
  await expect(summary).toContainText('2 records selected for this import');
  await expect(summary).toContainText(/1\s+duplicate/);
  await preview(page, second.question).click();
  await expect(preview(page, first.question)).toHaveAttribute('aria-pressed', 'false');
  await expect(preview(page, second.question)).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toContainText(second.personalReading);
  await expect(panel.getByText(first.personalReading, { exact: true })).toHaveCount(0);
  await expect(confirm).toHaveText('Import 1 record');
  await expect(confirm).toHaveAccessibleName('Import 1 record');
  await preview(page, first.question).click();
  await expect(panel.getByText(family().followUps![0]!.answer, { exact: true })).toBeVisible();
  await expect(
    panel.locator('strong').filter({ hasText: 'Keep these original words' }),
  ).toHaveCount(0);
  expect(commits).toBe(0);
  expect((await history(page)).items.map((item) => item.id)).toEqual([original.id]);
  await confirm.click();
  await expect(page.getByText('Group complete.', { exact: true })).toBeVisible();
  expect(commits).toBe(1);
  await expect(summary).toContainText('2 records imported.');
  await expect(summary).toContainText('0 records selected for this import');
  await expect(panel).toContainText('Imported and saved.');
  await expect(panel.getByText('Ready to import', { exact: true })).toHaveCount(0);
  const stored = await (await page.request.get(`/api/v1/sessions/${original.id}`)).json();
  expect(stored.editionIds).toHaveLength(2);
  expect(stored.reflectionIds).toHaveLength(1);
  expect((await history(page)).items.map((item) => item.id)).toEqual([original.id]);
  await preview(page, second.question).click();
  await expect(confirm).toBeEnabled();
  await expect(confirm).toHaveText('Import 1 record');
  await confirm.click();
  await expect(page.getByText('Group complete.', { exact: true })).toBeVisible();
  expect(commits).toBe(2);
  await expect(summary).toContainText('3 records imported.');
  await expect(summary).toContainText('0 records selected for this import');
  expect((await history(page)).items).toHaveLength(2);
});

test('duplicate and rejected missing-parent groups stay excluded beside a responsive exact-text preview', async ({
  page,
}) => {
  await account(page, '203.0.113.232');
  await openAccount(page);
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  await review(page, [duplicate]);
  await page.getByRole('button', { name: /^Import \d+ records?$/ }).click();
  await expect(page.getByText('Group complete.', { exact: true })).toBeVisible();
  const original = (await history(page)).items.map((item) => item.id);
  await review(page, [family(), duplicate, missingParent], true);
  await preview(page, missingParent.followUps![0]!.question).click();
  const confirm = page.getByRole('button', { name: /^Import \d+ records?$/ });
  // The service may resolve an external parent against an already saved reading.
  // Only a real rejection establishes this group's blocked state.
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const failedPreview = page.getByRole('region', { name: 'Selected group preview', exact: true });
  await expect(failedPreview.getByRole('alert')).toContainText('could not be confirmed');
  await expect(failedPreview).toContainText(
    'This group references a parent reading or source outside this selection.',
  );
  await expect(failedPreview).toContainText(
    'include its original reading and required records, then review the selection again.',
  );
  await expect(confirm).toBeDisabled();
  expect((await history(page)).items.map((item) => item.id)).toEqual(original);
  await preview(page, duplicate.question).click();
  await expect(
    page.getByRole('button', { name: 'Finish review — no new records', exact: true }),
  ).toBeEnabled();
  await preview(page, first.question).click();
  await expect(confirm).toHaveText('Import 3 records');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await preview(page, missingParent.followUps![0]!.question).click();
  await expect(failedPreview.getByRole('alert')).toContainText('could not be confirmed');
  await expect(confirm).toBeDisabled();
  await preview(page, first.question).click();
  await expect(confirm).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const summary = page.getByRole('region', { name: 'Import summary', exact: true });
  await expect(summary).toContainText(/1\s+duplicate/);
  await expect(summary).toContainText(/1\s+(?:record\s+)?blocked/);
  await mkdir('/tmp/reflection-import-ui', { recursive: true });
  const reviewPanel = page.locator('#import-review');
  for (const theme of ['paper', 'evening']) {
    await page.getByLabel('Color theme').selectOption(theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const groups = page.getByRole('region', { name: 'Reading groups', exact: true });
      const selectedPreview = page.getByRole('region', {
        name: 'Selected group preview',
        exact: true,
      });
      const [reviewBox, groupBox, previewBox] = await Promise.all([
        reviewPanel.boundingBox(),
        groups.boundingBox(),
        selectedPreview.boundingBox(),
      ]);
      expect(reviewBox).not.toBeNull();
      expect(groupBox).not.toBeNull();
      expect(previewBox).not.toBeNull();
      if (width === 1440) {
        expect(reviewBox!.width).toBeGreaterThan(1000);
        expect(groupBox!.width).toBeGreaterThan(400);
        expect(previewBox!.width).toBeGreaterThan(400);
        expect(previewBox!.x).toBeGreaterThan(groupBox!.x + groupBox!.width + 16);
        expect(Math.abs(previewBox!.y - groupBox!.y)).toBeLessThan(2);
      } else {
        expect(reviewBox!.width).toBeGreaterThanOrEqual(width - 64);
        expect(groupBox!.width).toBeGreaterThanOrEqual(width - 64);
        expect(previewBox!.width).toBeGreaterThanOrEqual(width - 64);
        expect(previewBox!.y).toBeGreaterThan(groupBox!.y + groupBox!.height + 16);
        expect(Math.abs(previewBox!.x - groupBox!.x)).toBeLessThan(2);
      }
      const botanical = page.locator('.import-botanical');
      await expect(botanical).toBeVisible();
      await expect
        .poll(() =>
          botanical.evaluate(
            (node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0,
          ),
        )
        .toBe(true);
      const icons = reviewPanel.locator('.import-design-icon');
      await expect(icons.first()).toBeVisible();
      const masks = await icons.evaluateAll((nodes) =>
        Promise.all(
          nodes.map(async (node) => {
            const mask = getComputedStyle(node).maskImage;
            const url = mask.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
            if (!url) return { mask, loaded: false };
            const asset = new Image();
            asset.src = url;
            const loaded = await asset
              .decode()
              .then(() => asset.naturalWidth > 0)
              .catch(() => false);
            return { mask, loaded };
          }),
        ),
      );
      for (const icon of masks) {
        expect(icon.mask).not.toBe('none');
        expect(icon.loaded, `Icon mask should load: ${icon.mask}`).toBe(true);
      }
      await reviewPanel.screenshot({
        path: `/tmp/reflection-import-ui/import-${theme}-${width}.png`,
      });
      if (width === 1440)
        await page.screenshot({
          path: `/tmp/reflection-import-ui/import-${theme}-desktop-full.png`,
          fullPage: true,
        });
    }
  }
  const long = family();
  long.id = 'long-content';
  long.question = 'A long question that should wrap without hiding the original reading. '.repeat(
    9,
  );
  long.personalReading = 'A complete sentence with room to breathe.\n'.repeat(30) + '🌱'.repeat(80);
  await review(page, [long]);
  const panel = page.getByRole('region', { name: 'Selected group preview', exact: true });
  for (const theme of ['paper', 'evening']) {
    await page.getByLabel('Color theme').selectOption(theme);
    await page.setViewportSize({ width: 320, height: 900 });
    await expect(panel.getByText(long.personalReading, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reviewPanel.screenshot({
      path: `/tmp/reflection-import-ui/import-long-${theme}-320.png`,
    });
  }
  expect((await history(page)).items.map((item) => item.id)).toEqual(original);
});
