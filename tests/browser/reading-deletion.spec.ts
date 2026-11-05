import { expect, test, type Page, type Request } from '@playwright/test';
import { account, openAccount, reading, savedSnapshot } from '../fixtures/browser-reading.ts';

async function savedReading(page: Page, question: string) {
  await reading(page, question);
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  return savedSnapshot(page);
}
const unavailable = {
  error: {
    code: 'DEPENDENCY_UNAVAILABLE',
    message: 'The service is temporarily unavailable.',
    correlationId: '11111111-1111-4111-8111-111111111111',
    retry: 'after_delay',
    retryAfterSeconds: 60,
    currentRevision: null,
  },
};

for (const [width, colorScheme, ip] of [
  [320, 'light', '192.0.2.211'],
  [390, 'dark', '192.0.2.212'],
] as const) {
  test(`${width}px ${colorScheme}: confirmation identifies the reading and both safe exits preserve private drafts`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme });
    await account(page, ip);
    const question = 'What might I give myself more room to consider?';
    await savedReading(page, question);
    await page.getByLabel('Your reflection', { exact: true }).fill('Private unsaved reflection.');
    await page.getByRole('button', { name: 'Add revisit note', exact: true }).click();
    await page.getByLabel('Your revisit note', { exact: true }).fill('Private unsaved dated note.');
    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'DELETE') requests.push(r.url());
    });
    const trigger = page.getByRole('button', { name: 'Delete reading', exact: true });
    for (const exit of ['button', 'Escape']) {
      await trigger.click();
      const flow = page.getByRole('region', { name: 'Delete this reading?', exact: true });
      await expect(flow.getByText(question, { exact: true })).toBeVisible();
      await expect(flow.getByText(/dated revisit notes and all of its follow-ups/)).toBeVisible();
      await expect(flow.getByText(/There is no undo/)).toBeVisible();
      await expect(flow.getByRole('button', { name: 'Keep reading', exact: true })).toBeFocused();
      await expect(page.getByTestId('accepted-reading')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (exit === 'button') await flow.getByRole('button', { name: 'Keep reading' }).click();
      else await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await expect(page.getByLabel('Your reflection', { exact: true })).toHaveValue(
        'Private unsaved reflection.',
      );
      await expect(page.getByLabel('Your revisit note', { exact: true })).toHaveValue(
        'Private unsaved dated note.',
      );
    }
    expect(requests).toEqual([]);
    expect(
      await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
    ).toEqual({
      local: {},
      session: {},
    });
  });
}

test('a deletion rejected before admission can be kept or retried with the same receipt and revision', async ({
  page,
}) => {
  await account(page, '192.0.2.213');
  const saved = await savedReading(page, 'A reading with a rejected deletion.');
  const requests: Request[] = [];
  let deny = true;
  await page.route(`**/api/v1/sessions/${saved.session.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    requests.push(route.request());
    if (deny) {
      deny = false;
      return route.fulfill({
        status: 403,
        json: { error: { ...unavailable.error, code: 'FORBIDDEN' } },
      });
    }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Delete reading', exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Reading not deleted', exact: true }),
  ).toBeFocused();
  await expect(page.getByRole('button', { name: 'Keep reading', exact: true })).toBeVisible();
  const proof = requests[0]!.postDataJSON() as { receiptId: string };
  const check = page.waitForResponse(`**/api/v1/deletions/${proof.receiptId}`);
  await page.getByRole('button', { name: 'Retry deletion', exact: true }).click();
  expect((await check).status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Reading deleted', exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]!.postData()).toBe(requests[0]!.postData());
  expect(requests[1]!.headers()['idempotency-key']).toBe(requests[0]!.headers()['idempotency-key']);
  expect(requests[1]!.headers()['if-match']).toBe(requests[0]!.headers()['if-match']);
});

test('an offline request checks its receipt before resending and preserves an unrelated reading with AI off', async ({
  page,
}) => {
  await account(page, '192.0.2.214');
  const other = await savedReading(page, 'Keep this unrelated reading.');
  await page.getByRole('button', { name: 'Saved readings', exact: true }).click();
  await page.getByRole('button', { name: 'New reading', exact: true }).click();
  await page.getByLabel('Your question', { exact: true }).fill('Delete only this reading.');
  await page.getByLabel('Use English for this reading').check();
  await page.getByRole('button', { name: 'Start reading', exact: true }).click();
  await expect(page.getByTestId('accepted-reading')).toBeVisible();
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  const saved = await savedSnapshot(page);
  await openAccount(page);
  await page.getByRole('button', { name: 'Turn off AI readings', exact: true }).click();
  await page.getByRole('link', { name: 'Back to readings', exact: true }).click();
  const requests: Request[] = [];
  await page.route(`**/api/v1/sessions/${saved.session.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    requests.push(route.request());
    if (requests.length === 1) return route.abort('internetdisconnected');
    return route.continue();
  });
  await page.getByRole('button', { name: 'Delete reading', exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Deletion not confirmed' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Keep reading', exact: true })).toHaveCount(0);
  const first = requests[0]!,
    proof = first.postDataJSON() as { receiptId: string };
  const status = page.waitForResponse(`**/api/v1/deletions/${proof.receiptId}`);
  await page.getByRole('button', { name: 'Retry deletion', exact: true }).click();
  expect((await status).status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Reading deleted', exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]!.postData()).toBe(first.postData());
  expect(requests[1]!.headers()['idempotency-key']).toBe(first.headers()['idempotency-key']);
  expect(requests[1]!.headers()['if-match']).toBe(first.headers()['if-match']);
  await expect(
    page.getByRole('button', { name: 'Delete only this reading.', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Keep this unrelated reading.', exact: true }).click();
  await expect(page.getByTestId('accepted-reading')).toContainText(other.session.question!);
});

test('pending deletion, unavailable status and missing backup expiry keep the receipt without resubmitting', async ({
  page,
}) => {
  await account(page, '192.0.2.215');
  const saved = await savedReading(page, 'A deletion that takes time to confirm.');
  let deletionRequests = 0,
    statusChecks = 0;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/v1/sessions/${saved.session.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    deletionRequests++;
    await hold;
    const response = await route.fetch();
    const receipt = await response.json();
    await route.fulfill({
      response,
      json: { ...receipt, state: 'erasing', backupExpiresBy: null },
    });
  });
  await page.route('**/api/v1/deletions/*', async (route) => {
    statusChecks++;
    if (statusChecks === 1)
      return route.fulfill({ json: { state: 'erasing', backupExpiresBy: null } });
    if (statusChecks === 2) return route.fulfill({ status: 503, json: unavailable });
    if (statusChecks === 3)
      return route.fulfill({ json: { state: 'complete', backupExpiresBy: null } });
    return route.continue();
  });
  await page.getByRole('button', { name: 'Delete reading', exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  try {
    await expect(
      page.getByRole('heading', { name: 'Deleting reading…', exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole('button', { name: 'Deleting reading…', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('accepted-reading')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Keep reading', exact: true })).toHaveCount(0);
    expect(deletionRequests).toBe(1);
  } finally {
    release();
  }
  await expect(page.getByText('Deletion has been accepted.', { exact: true })).toBeVisible();
  const check = page.getByRole('button', { name: 'Check deletion status', exact: true });
  await check.click();
  await expect(page.getByText('Deletion has been accepted.', { exact: true })).toBeVisible();
  await check.click();
  await expect(page.getByRole('heading', { name: 'Deletion not confirmed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry deletion', exact: true })).toHaveCount(0);
  await check.click();
  await expect(page.getByRole('heading', { name: 'Saved readings', exact: true })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Reading deleted', exact: true })).toBeVisible();
  await expect(page.getByText(/A backup expiry date has not been confirmed yet/)).toBeVisible();
  const statusResponse = page.waitForResponse('**/api/v1/deletions/*');
  await check.click();
  const final = await (await statusResponse).json();
  expect(final.state).toBe('complete');
  expect(final.backupExpiresBy).toBeTruthy();
  await expect(page.locator('.receipt-content time')).toHaveAttribute(
    'datetime',
    final.backupExpiresBy,
  );
  await expect(page.getByText(/A backup expiry date has not been confirmed yet/)).toHaveCount(0);
  expect(deletionRequests).toBe(1);
});

test('a request timeout shows an unconfirmed deletion and its retry checks the same receipt first', async ({
  page,
}) => {
  await account(page, '192.0.2.216');
  const saved = await savedReading(page, 'A reading with a timed-out deletion.');
  await page.clock.install();
  const requests: Request[] = [];
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/v1/sessions/${saved.session.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    requests.push(route.request());
    if (requests.length === 1) {
      await hold;
      return route.abort('timedout');
    }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Delete reading', exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  try {
    await expect(
      page.getByRole('heading', { name: 'Deleting reading…', exact: true }),
    ).toBeVisible();
    await page.clock.fastForward(31_000);
    await expect(
      page.getByRole('heading', { name: 'Deletion not confirmed', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keep reading', exact: true })).toHaveCount(0);
  } finally {
    release();
  }
  const proof = requests[0]!.postDataJSON() as { receiptId: string };
  const check = page.waitForResponse(`**/api/v1/deletions/${proof.receiptId}`);
  await page.getByRole('button', { name: 'Retry deletion', exact: true }).click();
  expect((await check).status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Reading deleted', exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]!.postData()).toBe(requests[0]!.postData());
  expect(requests[1]!.headers()['idempotency-key']).toBe(requests[0]!.headers()['idempotency-key']);
});
