import { expect, test } from '@playwright/test';
import { account, authenticator, enableAi, reading } from '../fixtures/browser-reading.ts';

const localSimulation =
  'This local simulation does not contact an AI provider. Use test accounts and synthetic text only.';

test('saved history distinguishes loading, failure and a successful retry', async ({ page }) => {
  await account(page, '198.51.100.85');
  const question = 'What can I make more time for this week?';
  await reading(page, question);
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  const listUrl = '**/api/v1/sessions?status=saved';
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(listUrl, async (route) => {
    await held;
    await route.fulfill({ status: 503, body: '' });
  });
  const request = page.waitForRequest(listUrl);
  await page.goto('/');
  await request;
  const empty = page.getByText('No saved readings yet.', { exact: true });
  try {
    await expect(empty).toHaveCount(0);
    await expect(page.getByText('Loading saved readings…', { exact: true })).toBeVisible();
  } finally {
    release();
  }
  const retry = page.getByRole('button', { name: 'Retry loading saved readings', exact: true });
  await expect(retry).toBeVisible();
  await expect(empty).toHaveCount(0);
  await page.unroute(listUrl);
  await retry.click();
  await expect(page.getByRole('button', { name: question, exact: true })).toBeVisible();
  await expect(retry).toHaveCount(0);
});

test('sign-in keeps one environment notice and drops repeated chrome', async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.241' });
  await authenticator(page);
  await page.goto('/');
  await expect(page.getByText(localSimulation, { exact: true })).toBeVisible();
  await expect(page.getByText(/Draw three tarot cards or bring your own spread/)).toBeVisible();
  await expect(page.getByText(/without an email address or password/)).toBeVisible();
  await expect(page.getByText('Development build')).toHaveCount(0);
  await expect(page.getByText('A private space for reflection')).toHaveCount(0);
  await expect(page.getByText('No email or password is collected.')).toHaveCount(0);
});

test('the new-reading form keeps transmission limits without build jargon', async ({ page }) => {
  await account(page, '192.0.2.242');
  await expect(page.getByText(localSimulation, { exact: true })).toHaveCount(0);
  await enableAi(page);
  await page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Tarot', exact: true })
    .click();
  const english = page.getByLabel('Use English for this reading');
  await expect(english).toHaveAttribute('required', '');
  const spread = page.locator('summary', { hasText: 'Use my own spread' });
  await expect(page.getByRole('button', { name: 'Choose photo', exact: true })).toHaveCount(0);
  expect((await english.boundingBox())!.y).toBeLessThan((await spread.boundingBox())!.y);
  await page.getByLabel('Your question', { exact: true }).fill('Where can I begin?');
  await expect(
    page.getByRole('button', { name: 'Start reading', exact: true }),
  ).toHaveAccessibleDescription(/confirm.*English/i);
  await spread.press('Enter');
  await expect(page.getByText('Illustration only', { exact: true })).toBeVisible();
  await expect(page.getByText('Bring your own spread')).toHaveCount(0);
  const illustration = page.locator('.spread-intro-art');
  await expect(illustration).toHaveAttribute('alt', '');
  await expect(illustration).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByLabel('Photo of your spread (optional)')).toBeAttached();
  await expect(page.getByText('Offline spread photo')).toHaveCount(0);
  await expect(page.getByText(/This simulation does not recognize real cards/)).toBeVisible();
  await expect(page.getByText(/This simulation does not contact an AI provider/)).toBeVisible();
  await expect(page.getByText(/local simulated writer|Local allowance/)).toHaveCount(0);
  await expect(page.getByText(/Readings left: \d+ today/)).toBeVisible();
  await expect(page.getByText(/Start temporarily stores your question/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Choose photo', exact: true }),
  ).toHaveAccessibleDescription(/does not recognize real cards/);
});

test('saved readings are listed by date and question without a decorative thumbnail', async ({
  page,
}) => {
  await account(page, '192.0.2.247');
  const question = 'Synthetic clarity history question';
  await reading(page, question);
  let starts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/v1/requests')) starts++;
  });
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  await expect(
    page.getByText('Opening one does not start a new reading.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Return to the original reading/)).toHaveCount(0);
  const item = page.locator('.reading-history li');
  await expect(item).toHaveCount(1);
  await expect(item.locator('img')).toHaveCount(0);
  await expect(item.getByRole('button', { name: question, exact: true })).toBeVisible();
  await item.getByRole('button', { name: question, exact: true }).click();
  await expect(page.getByTestId('accepted-reading')).toBeVisible();
  const notesLink = page.getByRole('link', { name: 'Revisit notes', exact: true });
  await expect(notesLink).toBeVisible();
  await notesLink.press('Enter');
  await expect(page.getByRole('heading', { name: 'Revisit notes', exact: true })).toBeFocused();
  expect(starts).toBe(0);
});

test('browser Back returns from a saved reading to its list and Forward reopens it', async ({
  page,
}) => {
  await account(page, '198.51.100.87');
  const question = 'What should I return to this month?';
  await reading(page, question);
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  // Put a different page immediately before the library, as on a return visit.
  await page.goto('/account');
  await page.getByRole('link', { name: 'Back to readings', exact: true }).click();
  await page.getByRole('button', { name: question, exact: true }).click();
  await expect(page.getByRole('heading', { name: question })).toBeVisible();
  const detail = page.url();
  await page.goBack();
  await expect(page.getByRole('button', { name: question, exact: true })).toBeFocused();
  await page.goForward();
  await expect(page).toHaveURL(detail);
  await expect(page.getByRole('heading', { name: question })).toBeVisible();
});
