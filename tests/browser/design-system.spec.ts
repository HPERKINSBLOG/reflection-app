import { expect, test } from '@playwright/test';
import { account, enableAi } from '../fixtures/browser-reading.ts';
import { themeContrast } from '../fixtures/browser-journey.ts';

const palette = {
  paper: '#f7f3e8',
  ink: '#103f46',
  teal: '#126f73',
  evening: '#082f33',
  mint: '#a8d5ba',
  coral: '#f28b7b',
  butter: '#f1d27b',
  sage: '#a9b88f',
};

test('exact palette, local typography and responsive Paper and Evening landing', async ({
  page,
}) => {
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A little space to reflect.' })).toBeVisible();
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({});
  const colors = await page.evaluate((names) => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      names.map((name) => [
        name,
        style.getPropertyValue(`--reflection-${name}`).trim().toLowerCase(),
      ]),
    );
  }, Object.keys(palette));
  expect(colors).toEqual(palette);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('h1')).toHaveCSS('font-family', /Newsreader/);
  await expect(page.locator('body')).toHaveCSS('font-family', /Figtree/);
  await expect(page.locator('.brand')).toHaveCSS('font-family', /Outfit/);
  for (const theme of ['paper', 'evening']) {
    await page.getByLabel('Color theme').selectOption(theme);
    await expect(page.locator('html')).toHaveCSS(
      'background-color',
      theme === 'paper' ? 'rgb(247, 243, 232)' : 'rgb(8, 47, 51)',
    );
    const contrast = await themeContrast(page);
    for (const [name, ratio] of Object.entries(contrast)) {
      expect(ratio, `${theme}: ${name}`).toBeGreaterThanOrEqual(name.startsWith('input') ? 3 : 4.5);
    }
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(page.getByLabel('Color theme')).toBeVisible();
      const art = page.locator('.landing-layout > .auth-art');
      await expect(art).toBeVisible();
      const box = await art.boundingBox();
      expect(box!.width / box!.height).toBeCloseTo(347.649 / 422.238, 2);
      await page.screenshot({
        path: `artifacts/reflection-design/${width}-${theme}-landing.png`,
        fullPage: true,
      });
    }
  }
  expect(faults).toEqual([]);
});

test('theme follows System, persists explicit choices and synchronizes tabs', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const theme = page.getByLabel('Color theme');
  await expect(theme).toHaveValue('system');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(8, 47, 51)');
  await theme.selectOption('paper');
  await page.reload();
  await expect(theme).toHaveValue('paper');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(247, 243, 232)');
  const sibling = await context.newPage();
  await sibling.goto('/');
  await sibling.getByLabel('Color theme').selectOption('evening');
  await expect(theme).toHaveValue('evening');
  await theme.selectOption('system');
  await expect(sibling.getByLabel('Color theme')).toHaveValue('system');
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({});
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(247, 243, 232)');
  await sibling.close();
});

test('theme control works when preference storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Storage unavailable', 'SecurityError');
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('Color theme').selectOption('evening');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(8, 47, 51)');
  await page.getByLabel('Color theme').selectOption('paper');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(247, 243, 232)');
});

test('changing themes preserves the in-memory reading draft and field description', async ({
  page,
}) => {
  await account(page, '203.0.113.247');
  await enableAi(page);
  await page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Tarot', exact: true })
    .click();
  const question = page.getByLabel('Your question', { exact: true });
  await question.fill('What would make room for another perspective?');
  for (const theme of ['evening', 'paper']) {
    await page.getByLabel('Color theme').selectOption(theme);
    await expect(question).toHaveValue('What would make room for another perspective?');
    await expect(question).toHaveAccessibleDescription(/Include what you are considering/);
    await question.focus();
    await expect(question).toHaveCSS('outline-width', '2px');
    await page.screenshot({
      path: `artifacts/reflection-design/${theme}-reading-form.png`,
      fullPage: true,
    });
  }
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({ 'reflection-theme': 'paper' });
});
