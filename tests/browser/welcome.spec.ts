import { expect, type Page, test } from '@playwright/test';
import { artUnderContent, themeContrast } from '../fixtures/browser-journey.ts';
import { account, openSignIn } from '../fixtures/browser-reading.ts';

const localNotice =
  'This local simulation does not contact an AI provider. Use test accounts and synthetic text only.';
const welcomeHeading = (page: Page) =>
  page.getByRole('heading', { name: 'A little space to reflect.', exact: true });
const signInHeading = (page: Page) =>
  page.getByRole('heading', { name: 'Sign in or create an account', exact: true });

test('the welcome page invites a first reading with two actions, three positions and the runtime notice', async ({
  page,
}) => {
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));
  await page.goto('/');
  const headline = welcomeHeading(page);
  const lead = page.getByText('Bring a question. Make room for another perspective.', {
    exact: true,
  });
  const draw = page.getByRole('link', { name: 'Draw three cards', exact: true });
  const returning = page.getByRole('link', { name: 'I have an account', exact: true });
  const positions = page.getByRole('list', { name: 'Reflection positions' });
  const closing = page.getByText(
    'Reflection, not prediction. Save what’s useful, write what it means to you, and return with time.',
    { exact: true },
  );
  const notice = page.getByText(localNotice, { exact: true });
  await expect(headline).toBeVisible();
  await expect(draw).toHaveAttribute('href', '/sign-in?start=new');
  await expect(returning).toHaveAttribute('href', '/sign-in');
  await expect(positions.getByRole('listitem')).toHaveText([
    /^1\s*Situation\s*What’s here now$/,
    /^2\s*Tension\s*What pulls against it$/,
    /^3\s*Possibility\s*What could open up$/,
  ]);
  await expect(page.getByRole('heading', { name: 'Reflection positions', level: 2 })).toBeVisible();
  await expect(closing).toBeVisible();
  await expect(notice).toBeVisible();
  // The page reads in this order: headline, lead, actions, positions, closing line, notice.
  const tops = [];
  for (const part of [headline, lead, draw, positions, closing, notice])
    tops.push((await part.boundingBox())!.y);
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  // The actions are inline pills, side by side, not full-width buttons.
  const [first, second] = [(await draw.boundingBox())!, (await returning.boundingBox())!];
  expect(Math.abs(first.y - second.y)).toBeLessThan(1);
  expect(first.x + first.width).toBeLessThan(second.x);
  expect(first.width).toBeLessThan(260);
  expect(first.height).toBeGreaterThanOrEqual(48);
  await expect(draw).toHaveCSS('border-radius', '9999px');
  // Sign-in controls live on /sign-in.
  await expect(
    page.getByRole('button', { name: /^Sign in with a (password|passkey)$/ }),
  ).toHaveCount(0);
  // Decorative art stays decorative and behind the words.
  await expect(page.locator('main img')).toHaveCount(4);
  for (const image of await page.locator('main img').all()) {
    await expect(image).toHaveAttribute('alt', '');
    await expect(image).toHaveAttribute('aria-hidden', 'true');
    await expect(image).toHaveCSS('position', 'absolute');
    await expect(image).toHaveCSS('pointer-events', 'none');
  }
  for (const width of [320, 390, 640, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${width}px horizontal overflow`,
    ).toBe(true);
    expect(await artUnderContent(page), `${width}px art under content`).toEqual([]);
  }
  expect(faults).toEqual([]);
});

test('a direct load of /sign-in shows the sign-in and new-account controls', async ({ page }) => {
  const response = await page.goto('/sign-in');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-type']).toContain('text/html');
  await expect(signInHeading(page)).toBeVisible();
  await expect(
    page.getByText(
      'Draw three tarot cards or bring your own spread. Save your reading and return with a note.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(localNotice, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sign in with a password', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sign in with a passkey', exact: true }),
  ).toBeVisible();
  const signup = page.getByRole('group', { name: 'New to Reflection?' });
  await expect(
    signup.getByRole('button', { name: 'Create a password account', exact: true }),
  ).toBeVisible();
  await expect(
    signup.getByRole('button', { name: 'Create a test account with a passkey', exact: true }),
  ).toBeVisible();
  await expect(
    signup.getByText('A passkey lets you join without an email address or password.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Recover with your saved kit', exact: true }),
  ).toHaveAttribute('href', '/recover');
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await artUnderContent(page), `${width}px art under content`).toEqual([]);
  }
});

test('?start=new focuses the new-account choices, on a direct load and from the welcome page', async ({
  page,
}) => {
  const signup = page.getByRole('group', { name: 'New to Reflection?' });
  await page.goto('/sign-in?start=new');
  await expect(signup).toBeFocused();
  await page.goto('/');
  await page.getByRole('link', { name: 'Draw three cards', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/sign-in\?start=new$/);
  await expect(signup).toBeFocused();
  // Without ?start=new the page heading takes focus, as on every other page change.
  await page.goBack();
  await expect(welcomeHeading(page)).toBeVisible();
  await page.getByRole('link', { name: 'I have an account', exact: true }).click();
  await expect(signInHeading(page)).toBeFocused();
});

test('Back and Forward move between the welcome page and /sign-in and close the password form', async ({
  page,
}) => {
  await page.goto('/');
  await openSignIn(page);
  await page.getByRole('button', { name: 'Sign in with a password', exact: true }).click();
  await expect(page.getByLabel('Username or email')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('http://localhost:8787/');
  await expect(welcomeHeading(page)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL('http://localhost:8787/sign-in');
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByLabel('Username or email')).toHaveCount(0);
  await page.goBack();
  await expect(welcomeHeading(page)).toBeVisible();
});

test('"Back to sign in" on /recover opens /sign-in and forgets the typed kit', async ({ page }) => {
  await page.goto('/recover');
  await page.getByLabel('Recovery handle').fill('synthetic-handle');
  await page.getByLabel('Unused recovery code').fill('synthetic-code');
  await page.getByRole('link', { name: 'Back to sign in', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:8787/sign-in');
  await expect(signInHeading(page)).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL('http://localhost:8787/recover');
  await expect(page.getByLabel('Recovery handle')).toHaveValue('');
  await expect(page.getByLabel('Unused recovery code')).toHaveValue('');
});

test('a signed-in reader who opens /sign-in lands on their readings at /', async ({ page }) => {
  await account(page, '203.0.113.231');
  // Creating the account from /sign-in replaced that address.
  await expect(page).toHaveURL('http://localhost:8787/');
  for (const path of ['/sign-in', '/sign-in?start=new']) {
    await page.goto(path);
    await expect(page).toHaveURL('http://localhost:8787/');
    await expect(page.getByRole('region', { name: 'Your readings', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeVisible();
  }
});

for (const theme of ['paper', 'evening'] as const) {
  test(`${theme}: cards, tiles, sign-in and the header keep their contrast`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('reflection-theme', value), theme);
    await page.goto('/');
    await expect(page.getByRole('list', { name: 'Reflection positions' })).toBeVisible();
    // The rose starts under the header rule, so the header always sits on the page fill.
    const header = (await page.locator('.site-header').boundingBox())!;
    const welcome = (await page.locator('main.invitation').boundingBox())!;
    expect(welcome.y).toBeGreaterThanOrEqual(header.y + header.height - 0.5);
    await expect(page.locator('main.invitation')).toHaveCSS('overflow', 'clip');
    const ratios: Record<string, number> = {};
    const measure = async (name: string, selector: string) => {
      // A missing measurement counts as failing contrast.
      ratios[name] = (await themeContrast(page, selector)).selectedText ?? 0;
    };
    await measure('header wordmark', '.brand');
    await measure('header theme control', '.theme-control select');
    await measure('welcome headline', '.invitation-title');
    await measure('positions label', '.positions-title');
    await measure('tile number', '.position-tile-number');
    await measure('tile title', '.position-tile-name');
    await measure('tile line', '.position-tile-detail');
    await measure('closing line', '.invitation-closing');
    await page.goto('/sign-in');
    await expect(signInHeading(page)).toBeVisible();
    // The controls replace "Checking your session…" once the session check settles.
    await expect(
      page.getByRole('link', { name: 'Recover with your saved kit', exact: true }),
    ).toBeVisible();
    await measure('sign-in title', '.sign-in-card h1');
    await measure('sign-in promise', '.sign-in-card .brand-promise');
    await measure('sign-in link', '.sign-in-card .text-link');
    await measure('sign-in hint', '.sign-in-card .field-hint');
    for (const [name, ratio] of Object.entries({ ...ratios, ...(await themeContrast(page)) }))
      expect(ratio, `${theme}: ${name}`).toBeGreaterThanOrEqual(name.startsWith('input') ? 3 : 4.5);
  });
}
