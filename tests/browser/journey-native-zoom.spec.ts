import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { displayCapture, displayJourney, nativeZoomContext } from '../fixtures/browser-display.ts';
import { artUnderContent, journeyAccount } from '../fixtures/browser-journey.ts';

// The responsive matrix sets DPR=1. Native zoom needs an un-emulated window.
test.use({
  viewport: null,
  deviceScaleFactor: [
    async ({ browserName }, use) => {
      expect(browserName).toBe('chromium');
      await use(undefined);
    },
    { scope: 'test' },
  ],
});

for (const theme of ['light', 'dark'] as const) {
  test(`native Chromium 200% page zoom: ${theme} read, save, reflect and return`, async ({
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const { context, page, resize, screenshot } = await nativeZoomContext(baseURL!, theme);
    try {
      const faults: string[] = [];
      page.on('pageerror', (error) => faults.push(error.message));
      const { capture, finish } = displayCapture(
        page,
        `chromium-native-200-${theme}`,
        resize,
        screenshot,
      );
      await expect(page.getByRole('link', { name: 'Draw three cards', exact: true })).toBeVisible();
      await capture('landing');
      await page.goto('/sign-in');
      await expect(page.getByRole('button', { name: 'Create a test account' })).toBeEnabled();
      await capture('sign-in');
      await page.goto('/recover');
      await expect(page.getByLabel('Recovery handle', { exact: true })).toBeVisible();
      await capture('recovery');
      await journeyAccount(
        page,
        'chromium',
        baseURL,
        `198.51.100.${theme === 'light' ? 181 : 182}`,
      );
      await displayJourney(page, capture);
      await finish(faults);
    } finally {
      await context.close();
    }
  });

  // At 400% a 1280 px window is 320 CSS px wide: the narrowest layout every page must survive.
  test(`native Chromium 400% page zoom: ${theme} art stays clear of words and controls`, async ({
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const { context, page, screenshot } = await nativeZoomContext(baseURL!, theme, 4);
    try {
      await mkdir('artifacts/accessibility-pass/screens', { recursive: true });
      const faults: string[] = [];
      page.on('pageerror', (error) => faults.push(error.message));
      const check = async (state: string) => {
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => innerWidth)).toBe(320);
        expect(await artUnderContent(page), `400% ${theme} ${state}`).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `400% ${theme} ${state} horizontal overflow`,
        ).toBe(true);
        await screenshot(
          `artifacts/accessibility-pass/screens/chromium-native-400-${theme}-${state}.png`,
        );
      };
      await expect(page.getByRole('link', { name: 'Draw three cards', exact: true })).toBeVisible();
      await check('landing');
      await page.goto('/sign-in');
      await expect(page.getByRole('button', { name: 'Create a test account' })).toBeEnabled();
      await check('sign-in');
      await page.goto('/recover');
      await expect(page.getByLabel('Recovery handle', { exact: true })).toBeVisible();
      await check('recovery');
      await journeyAccount(
        page,
        'chromium',
        baseURL,
        `198.51.100.${theme === 'light' ? 185 : 186}`,
      );
      await check('saved-empty');
      await page.getByRole('link', { name: 'Account', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
      await check('account');
      expect(faults).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
