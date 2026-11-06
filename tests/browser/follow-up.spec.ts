import { expect, test, type Page } from '@playwright/test';
import { account, openAccount, reading, savedSnapshot } from '../fixtures/browser-reading.ts';

async function original(page: Page, ip: string) {
  await account(page, ip);
  await reading(page, 'How might I protect a little time for practice?');
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  return savedSnapshot(page);
}
async function compose(page: Page, question: string) {
  await page.getByRole('link', { name: 'Ask a follow-up', exact: true }).click();
  await expect(page.getByText('No new draw', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Include reversed cards')).toHaveCount(0);
  await expect(page.getByLabel('Photo of your spread')).toHaveCount(0);
  await page.getByLabel('Your follow-up question', { exact: true }).fill(question);
  await page.getByLabel('Use English for this reading').check();
}
test('follow-ups keep their exact parents, questions and saved family across reload and deletion', async ({
  page,
}) => {
  const saved = await original(page, '198.51.100.206');
  const starts: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/requests'))
      starts.push(request.postDataJSON());
  });
  await compose(page, 'What changed after a week?');
  await page.getByRole('button', { name: 'Review follow-up', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Review follow-up', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start follow-up', exact: true }).click();
  await expect(
    page
      .getByTestId('accepted-reading')
      .getByRole('heading', { name: 'What changed after a week?' }),
  ).toBeVisible();
  const second = await savedSnapshot(page);
  expect(second.reading).toMatchObject({
    kind: 'tarot.accepted.v3',
    parentEditionId: saved.reading.editionId,
  });
  await compose(page, 'What shall I make room for now?');
  await page.getByRole('button', { name: 'Review follow-up', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Review follow-up', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start follow-up', exact: true }).click();
  await expect(
    page
      .getByTestId('accepted-reading')
      .getByRole('heading', { name: 'What shall I make room for now?' }),
  ).toBeVisible();
  expect(starts).toMatchObject([
    { parentEditionId: saved.reading.editionId, selection: [] },
    { parentEditionId: second.reading.editionId, selection: [] },
  ]);
  const third = await savedSnapshot(page);
  expect(third.session.editionIds).toHaveLength(3);
  expect(third.reading).toMatchObject({ parentEditionId: second.reading.editionId });
  await page.reload();
  await expect(page.getByTestId('accepted-reading')).toBeVisible();
  await openAccount(page);
  await page.getByRole('button', { name: 'Turn off AI readings', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'AI readings are off', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeVisible();
  for (const [id, title] of [
    [second.reading.editionId, 'What changed after a week?'],
    [third.reading.editionId, 'What shall I make room for now?'],
  ]) {
    await page.goto(`/saved/${saved.session.id}/${id}`);
    await expect(
      page.getByTestId('accepted-reading').getByRole('heading', { name: title!, exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Reading actions' })
        .getByRole('button', { name: 'Tarot', exact: true }),
    ).toBeDisabled();
  }
  await page.getByText('Parent and original reading', { exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Open parent edition', exact: true }),
  ).toHaveAttribute('href', `/saved/${saved.session.id}/${second.reading.editionId}`);
  await page.getByRole('link', { name: 'Back to original reading', exact: true }).click();
  await expect(
    page
      .getByTestId('accepted-reading')
      .getByRole('heading', { name: 'How might I protect a little time for practice?' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete reading', exact: true }).click();
  await expect(
    page
      .getByText(/deletes all three editions|deletes all follow-ups|all of its follow-ups/i)
      .first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible();
  for (const edition of third.session.editionIds) {
    const response = await page.request.get(`/api/v1/readings/${edition}`);
    expect([404, 410]).toContain(response.status());
  }
  expect(starts).toHaveLength(2);
});
test('concurrent family deletion returns to the follow-up draft and reconnect never resubmits it', async ({
  page,
}) => {
  const saved = await original(page, '198.51.100.207');
  await compose(page, 'What changed when I tried a shorter practice?');
  const receipt = await page.request.delete(`/api/v1/sessions/${saved.session.id}`, {
    headers: {
      Origin: new URL(page.url()).origin,
      'X-CSRF-Token': saved.me.csrfToken,
      'Idempotency-Key': crypto.randomUUID(),
      'If-Match': `"${saved.session.revision}"`,
    },
    data: {
      receiptId: crypto.randomUUID(),
      receiptToken: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
    },
  });
  expect(receipt.status()).toBe(202);
  let posts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/requests')) posts++;
  });
  await page.getByRole('button', { name: 'Review follow-up', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Review follow-up', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start follow-up', exact: true }).click();
  await expect(page.getByLabel('Your follow-up question', { exact: true })).toHaveValue(
    'What changed when I tried a shorter practice?',
  );
  await expect(page).toHaveURL(`/saved/${saved.session.id}/${saved.reading.editionId}/follow-up`);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  expect(posts).toBe(1);
  expect(
    await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).length,
      caches: (await caches.keys()).length,
    })),
  ).toEqual({ local: 0, session: 0, databases: 0, caches: 0 });
});

test('a revoked source reports confirmed pre-dispatch or possible prior sending from the request events', async ({
  page,
}) => {
  await account(page, '198.51.100.208');
  const id = crypto.randomUUID(),
    sessionId = crypto.randomUUID(),
    now = new Date().toISOString();
  let first = 1,
    writing = false;
  await page.route(`**/api/v1/requests/${id}?*`, (route) => {
    const events = [
      { sequence: first, state: 'prepared', code: 'QUEUED', errorCode: null },
      ...(writing
        ? [{ sequence: first + 1, state: 'dispatching', code: 'WRITING', errorCode: null }]
        : []),
      {
        sequence: first + (writing ? 2 : 1),
        state: 'blocked',
        code: 'STOPPED',
        errorCode: 'CONTEXT_CHANGED',
      },
    ].map((event) => ({ ...event, at: now, editionId: null }));
    return route.fulfill({
      json: {
        requestId: id,
        sessionId,
        state: 'blocked',
        revision: 5,
        events,
        nextSequence: events.at(-1)!.sequence,
        editionId: null,
        errorCode: 'CONTEXT_CHANGED',
        expiresAt: now,
      },
    });
  });
  const status = page.getByRole('region', { name: 'Reading request' }).getByRole('status');
  await page.goto(`/requests/${id}`);
  await expect(status).toContainText('The writer was not sent your selected excerpts.');
  writing = true;
  await page.reload();
  await expect(status).toContainText('Sending to the writer had started');
  first = 4;
  writing = false;
  await page.reload();
  await expect(status).toContainText(
    'The remaining request history cannot confirm whether sending had started.',
  );
});
