import { mkdir } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { artUnderContent, spreadPhotoPath } from '../fixtures/browser-journey.ts';
import {
  account,
  enableAi,
  openAccount,
  openTarot,
  reading,
  startFromReview,
} from '../fixtures/browser-reading.ts';

/** Design-review screens, written only when REFLECTION_SCREENS names a folder. */
const output = process.env.REFLECTION_SCREENS;

async function capture(page: Page, name: string, widths = [320, 390, 768, 1280]) {
  for (const theme of ['paper', 'evening'] as const) {
    await page.getByLabel('Color theme').selectOption(theme);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(async () => {
        await document.fonts.ready;
        // A full-page capture includes lazy images below the fold.
        for (const image of document.images) image.loading = 'eager';
        await Promise.all(
          [...document.images].map((image) => image.decode().catch(() => undefined)),
        );
      });
      expect(await artUnderContent(page), `${name} ${theme} ${width}px`).toEqual([]);
      await page.screenshot({ path: `${output}/${name}-${width}-${theme}.png`, fullPage: true });
    }
  }
}

test('design review screens in Paper and Evening at four widths', async ({ page }) => {
  test.skip(!output, 'Set REFLECTION_SCREENS to the folder that receives the screens.');
  test.setTimeout(300_000);
  await mkdir(output!, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Draw three cards', exact: true })).toBeVisible();
  await capture(page, 'landing');
  await page.goto('/sign-in');
  await expect(page.getByRole('button', { name: 'Create a test account' })).toBeEnabled();
  await capture(page, 'sign-in');
  await page.goto('/recover');
  await expect(page.getByLabel('Recovery handle', { exact: true })).toBeVisible();
  await capture(page, 'recover');
  await page.setViewportSize({ width: 1280, height: 900 });
  await account(page, '203.0.113.250');
  await expect(page.getByText(/^No saved readings yet\./)).toBeVisible();
  await capture(page, 'readings-empty');
  await reading(page, 'What deserves more space in my week?');
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible();
  await capture(page, 'readings-entries');
  await page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Tarot', exact: true })
    .click();
  await expect(page.getByLabel('Your question')).toBeVisible();
  await capture(page, 'new-reading');
  await openAccount(page);
  await capture(page, 'account');
});

test('tarot steps in Paper and Evening at 1440 and 390 px', async ({ page }) => {
  test.skip(!output, 'Set REFLECTION_SCREENS to the folder that receives the screens.');
  test.setTimeout(300_000);
  await mkdir(output!, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  const widths = [1440, 390];
  await account(page, '203.0.113.251');
  await enableAi(page);
  await openTarot(page);
  await capture(page, 'tarot-question', widths);
  await page
    .getByLabel('Your question', { exact: true })
    .fill('What deserves more space in my week?');
  await page.getByRole('button', { name: 'Choose your spread', exact: true }).click();
  await capture(page, 'tarot-spread', widths);
  await page.getByRole('button', { name: 'Use my physical spread', exact: true }).click();
  await page.getByLabel('Photo of your spread', { exact: true }).setInputFiles(spreadPhotoPath);
  await expect(
    page.getByRole('button', { name: 'Review your reading', exact: true }),
  ).toBeEnabled();
  await capture(page, 'tarot-photo', widths);
  await page.getByRole('button', { name: 'Use an app draw instead', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Ready when you are.', exact: true }),
  ).toBeVisible();
  await capture(page, 'tarot-review', widths);
  await startFromReview(page);
  await expect(
    page.getByRole('heading', { name: 'Take a moment with the spread.', exact: true }),
  ).toBeVisible();
  await capture(page, 'tarot-cards', widths);
});
