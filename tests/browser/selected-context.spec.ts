import { expect, test, type Page } from '@playwright/test';
import {
  account,
  reading,
  savedSnapshot,
  openAccount,
  backToReadings,
} from '../fixtures/browser-reading.ts';
async function fixture(page: Page, ip: string) {
  await account(page, ip);
  await reading(page, 'Synthetic continuity parent');
  await page
    .getByLabel('Your reflection', { exact: true })
    .fill('Unselected beginning. 😀é reviewed fragment. ' + 'Long private note. '.repeat(90));
  await page.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(page.getByText('Reflection saved.', { exact: true })).toBeVisible();
  const saved = await savedSnapshot(page);
  await page.getByRole('button', { name: 'New reading', exact: true }).click();
  await page.getByLabel('Your question', { exact: true }).fill('Current synthetic question');
  return saved;
}
async function chooseReflection(page: Page) {
  await page.getByRole('button', { name: 'Browse saved context', exact: true }).click();
  await page.getByRole('button', { name: 'Open context sources', exact: true }).first().click();
  await page.getByRole('button', { name: 'Review reflection revision 1', exact: true }).click();
  await page.getByRole('button', { name: 'Allow this source as context', exact: true }).click();
  await page.getByLabel('Excerpt start (code points)', { exact: true }).fill('22');
  await page.getByLabel('Excerpt end (code points)', { exact: true }).fill('24');
  await page.getByRole('button', { name: 'Add excerpt to this request', exact: true }).click();
}
test('context starts empty, reviews complete exact range, invalidates acknowledgement and removes without deletion', async ({
  page,
}) => {
  const saved = await fixture(page, '192.0.2.201');
  await expect(page.getByText('No context selected.', { exact: true })).toBeVisible();
  await chooseReflection(page);
  await page.getByRole('button', { name: 'Review complete request', exact: true }).click();
  const review = page.getByRole('region', { name: 'Complete context review', exact: true });
  await expect(review).toContainText('😀e');
  await expect(review).not.toContainText('Unselected beginning.');
  await page
    .getByLabel('I reviewed this question and every selected excerpt for this request.', {
      exact: true,
    })
    .check();
  await expect(page.getByText('Context review acknowledged.', { exact: true })).toBeVisible();
  await page.getByLabel('Your question', { exact: true }).fill('Changed current question');
  await expect(page.getByText('Context review acknowledged.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove from this request', exact: true }).click();
  await expect(page.getByText('No context selected.', { exact: true })).toBeVisible();
  expect(
    (await page.request.get(`/api/v1/reflections/${saved.session.reflectionIds[0]}`)).ok(),
  ).toBe(true);
  expect((await page.request.get(`/api/v1/context-grants`)).ok()).toBe(true);
});
test('stale source preview fails safely and retains the current question', async ({ page }) => {
  const saved = await fixture(page, '192.0.2.202');
  await chooseReflection(page);
  const id = saved.session.reflectionIds[0]!;
  const reflection = await (await page.request.get(`/api/v1/reflections/${id}`)).json();
  const response = await page.request.put(`/api/v1/reflections/${id}`, {
    headers: {
      Origin: 'http://localhost:8787',
      'X-CSRF-Token': saved.me.csrfToken,
      'If-Match': `"${reflection.revision}"`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: { text: 'Changed elsewhere', stance: 'unspecified', editionId: reflection.editionId },
  });
  expect(response.ok()).toBe(true);
  await page.getByRole('button', { name: 'Review complete request', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Review the source again');
  await expect(page.getByLabel('Your question', { exact: true })).toHaveValue(
    'Current synthetic question',
  );
  await expect(
    page.getByLabel('I reviewed this question and every selected excerpt for this request.', {
      exact: true,
    }),
  ).toHaveCount(0);
});
test('revoke keeps source, AI-off browsing works, and private selection does not survive reload', async ({
  page,
}) => {
  const saved = await fixture(page, '192.0.2.203');
  await chooseReflection(page);
  await page.getByRole('button', { name: 'Revoke context eligibility', exact: true }).click();
  await expect(page.getByText('No context selected.', { exact: true })).toBeVisible();
  expect(
    (await page.request.get(`/api/v1/reflections/${saved.session.reflectionIds[0]}`)).ok(),
  ).toBe(true);
  await page.getByLabel('Your question', { exact: true }).fill('');
  await openAccount(page);
  await page.getByRole('button', { name: 'Turn off AI readings', exact: true }).click();
  await backToReadings(page);
  await page.getByRole('button', { name: 'Browse saved context', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open context sources', exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('No context selected.', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        url: location.href,
      }),
    ),
  ).not.toContain('reviewed fragment');
});
test('keyboard range preserves Unicode boundaries, focuses review and invalidates when range or submission inputs change', async ({
  page,
}) => {
  await fixture(page, '192.0.2.204');
  await chooseReflection(page);
  await page.getByRole('button', { name: 'Review complete request', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Complete context review', exact: true }),
  ).toBeFocused();
  await page
    .getByLabel('I reviewed this question and every selected excerpt for this request.', {
      exact: true,
    })
    .check();
  const end = page.getByLabel('Excerpt end (code points)', { exact: true });
  await end.focus();
  await end.press('ArrowDown');
  await expect(page.getByLabel('Excerpt start (code points)', { exact: true })).toHaveValue('22');
  await expect(page.getByLabel('Excerpt end (code points)', { exact: true })).toHaveValue('23');
  await expect(page.getByText('Context review acknowledged.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add excerpt to this request', exact: true }).click();
  await page.getByRole('button', { name: 'Review complete request', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Complete context review', exact: true })
      .locator('blockquote')
      .last(),
  ).toHaveText('😀');
  await page
    .getByLabel('I reviewed this question and every selected excerpt for this request.', {
      exact: true,
    })
    .check();
  await page.getByLabel('Include reversed cards', { exact: true }).check();
  await expect(page.getByText('Context review acknowledged.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove from this request', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Browse saved context', exact: true }),
  ).toBeFocused();
});
test('offline and delayed previews keep the draft and cannot restore stale acknowledgement', async ({
  page,
}) => {
  await fixture(page, '192.0.2.205');
  await chooseReflection(page);
  let generations = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/requests')) generations++;
  });
  await page.route('**/api/v1/context-preview', (route) => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'Review complete request', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Your question', { exact: true })).toHaveValue(
    'Current synthetic question',
  );
  await page.unroute('**/api/v1/context-preview');
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    requested = new Promise<void>((resolve) => {
      reached = resolve;
    });
  await page.route('**/api/v1/context-preview', async (route) => {
    reached();
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Review complete request', exact: true }).click();
  await requested;
  await page
    .getByLabel('Your question', { exact: true })
    .fill('Newest question remains private in memory');
  const response = page.waitForResponse((r) => r.url().endsWith('/context-preview'));
  release();
  await response;
  await expect(
    page.getByRole('button', { name: 'Review complete request', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('region', { name: 'Complete context review', exact: true }),
  ).toHaveCount(0);
  expect(generations).toBe(0);
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        url: location.href,
      }),
    ),
  ).not.toContain('Newest question');
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel('Your question', { exact: true })).toHaveValue('');
  await expect(page.getByText('No context selected.', { exact: true })).toBeVisible();
});
test('retrying an eligibility write after a lost response reuses its mutation identity', async ({
  page,
}) => {
  await fixture(page, '192.0.2.206');
  await page.getByRole('button', { name: 'Browse saved context', exact: true }).click();
  await page.getByRole('button', { name: 'Open context sources', exact: true }).first().click();
  await page.getByRole('button', { name: 'Review reflection revision 1', exact: true }).click();
  await page.route('**/api/v1/context-grants', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fetch();
      await route.abort('connectionclosed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Allow this source as context', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/api/v1/context-grants');
  await page.getByRole('button', { name: 'Allow this source as context', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Revoke context eligibility', exact: true }),
  ).toBeVisible();
  const grants = await (await page.request.get('/api/v1/context-grants')).json();
  expect(grants.items).toHaveLength(1);
});
test('complete context controls retain readable Paper and Evening tokens on a narrow screen', async ({
  page,
}) => {
  await fixture(page, '192.0.2.207');
  await chooseReflection(page);
  await page.getByRole('button', { name: 'Review complete request', exact: true }).click();
  for (const theme of ['paper', 'evening']) {
    await page.getByLabel('Color theme').selectOption(theme);
    await page.setViewportSize({ width: 390, height: 900 });
    const review = page.getByRole('region', { name: 'Complete context review', exact: true });
    await expect(review).toBeVisible();
    await expect(review.locator('blockquote').first()).toHaveCSS(
      'color',
      theme === 'paper' ? 'rgb(16, 63, 70)' : 'rgb(247, 243, 232)',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await review.screenshot({ path: `artifacts/m3-implementation/c3-context-${theme}.png` });
  }
});
test('DOM-selected CRLF, lone-CR and Unicode ranges preserve exact server text', async ({
  page,
}) => {
  const saved = await fixture(page, '192.0.2.208'),
    id = saved.session.reflectionIds[0]!;
  const original = 'first\r\n😀é\rsecond';
  const updated = await page.request.put(`/api/v1/reflections/${id}`, {
    headers: {
      Origin: 'http://localhost:8787',
      'X-CSRF-Token': saved.me.csrfToken,
      'If-Match': '"1"',
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: { text: original, stance: 'unspecified', editionId: saved.reading.editionId },
  });
  expect(updated.ok()).toBe(true);
  await page.getByRole('button', { name: 'Browse saved context', exact: true }).click();
  await page.getByRole('button', { name: 'Open context sources', exact: true }).first().click();
  await page.getByRole('button', { name: 'Review reflection revision 2', exact: true }).click();
  await page.getByRole('button', { name: 'Allow this source as context', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Revoke context eligibility', exact: true }),
  ).toBeVisible();
  const field = page.getByLabel('Complete source text', { exact: true });
  expect(await field.inputValue()).toBe('first\n😀é\nsecond');
  await field.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(6, 10);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(page.getByLabel('Excerpt start (code points)', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('Excerpt end (code points)', { exact: true })).toHaveValue('10');
  await page.getByRole('button', { name: 'Add excerpt to this request', exact: true }).click();
  await page.getByRole('button', { name: 'Review complete request', exact: true }).click();
  expect(
    await page
      .getByRole('region', { name: 'Complete context review', exact: true })
      .locator('blockquote')
      .last()
      .textContent(),
  ).toBe('😀é');
  await page
    .getByLabel('I reviewed this question and every selected excerpt for this request.', {
      exact: true,
    })
    .check();
  await field.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(6, 6);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(page.getByText('Context review acknowledged.', { exact: true })).toHaveCount(0);
  await field.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(5, 11);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: 'Add excerpt to this request', exact: true }).click();
  await page.getByRole('button', { name: 'Review complete request', exact: true }).click();
  expect(
    await page
      .getByRole('region', { name: 'Complete context review', exact: true })
      .locator('blockquote')
      .last()
      .textContent(),
  ).toBe('\r\n😀é\r');
  await page.getByLabel('Excerpt start (code points)', { exact: true }).fill('6');
  await page.getByLabel('Excerpt end (code points)', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Add excerpt to this request', exact: true }).click();
  await page.getByRole('button', { name: 'Review complete request', exact: true }).click();
  expect(
    await page
      .getByRole('region', { name: 'Complete context review', exact: true })
      .locator('blockquote')
      .last()
      .textContent(),
  ).toBe('\n');
});
