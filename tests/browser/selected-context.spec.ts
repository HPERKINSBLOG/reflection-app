import { expect, test, type Page } from '@playwright/test';
import { apiSchemas } from '../../src/contracts/index.ts';
import {
  account,
  backToReadings,
  openAccount,
  reading,
  savedSnapshot,
} from '../fixtures/browser-reading.ts';

async function savedNote(page: Page, ip: string) {
  await account(page, ip);
  await reading(page, 'Synthetic source for a deliberate excerpt');
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  const saved = await savedSnapshot(page);
  const text = `${'x'.repeat(1300)}😀e\u0301 PRIVATE TAIL`;
  const result = await page.request.post('/api/v1/revisits', {
    headers: {
      Origin: new URL(page.url()).origin,
      'X-CSRF-Token': saved.me.csrfToken,
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: { editionId: saved.reading.editionId, note: text, stance: 'disagree' },
  });
  expect(result.ok()).toBe(true);
  return { saved, note: apiSchemas.Revisit.parse(await result.json()) };
}
async function chooseNote(page: Page, family: string) {
  await page.getByRole('button', { name: 'Choose excerpts', exact: true }).click();
  await page.getByLabel('Saved reading', { exact: true }).selectOption(family);
  const source = page.getByRole('radio', { name: /Your revisit note/ });
  await expect(source).toHaveCount(1);
  await source.check();
}
test('only the explicitly reviewed range is confirmed and an edit invalidates the acknowledgement', async ({
  page,
}) => {
  const { saved, note } = await savedNote(page, '198.51.100.201');
  await page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Tarot', exact: true })
    .click();
  await page.getByLabel('Your question', { exact: true }).fill('Which change feels workable?');
  await page.getByLabel('Use English for this reading').check();
  const previews: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/context-preview')) previews.push(request.postDataJSON());
  });
  await chooseNote(page, saved.session.id);
  await expect(page.getByText('No excerpts selected.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Allow this source', exact: true }).click();
  await expect(page.getByText('No excerpts selected.', { exact: true })).toBeVisible();
  expect(previews).toEqual([]);
  await page.getByRole('button', { name: 'Choose part of passage', exact: true }).click();
  await page.getByText('Set first and last characters', { exact: true }).click();
  await page.getByLabel('First character', { exact: true }).fill('1301');
  await page.getByLabel('Last character', { exact: true }).fill('1303');
  await page.getByRole('button', { name: 'Add excerpt', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start reading', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Review selected excerpts' }).click();
  const review = page.getByRole('region', { name: 'Review selected excerpts' });
  await expect(review.locator('blockquote')).toHaveText('😀e\u0301');
  await expect(review).not.toContainText('PRIVATE TAIL');
  await expect(review).toContainText('Your revisit note');
  expect(JSON.stringify(previews)).not.toContain(note.note);
  const acknowledge = page.getByLabel('I agree to use these exact excerpts for this reading.');
  await acknowledge.check();
  await expect(page.getByRole('button', { name: 'Start reading', exact: true })).toBeEnabled();
  await page
    .getByLabel('Your question', { exact: true })
    .fill('Which change feels workable today?');
  await expect(page.getByRole('button', { name: 'Start reading', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Review selected excerpts' }).click();
  await expect(acknowledge).not.toBeChecked();
  await acknowledge.check();
  await page.getByRole('button', { name: 'Remove excerpt 1' }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByText('No excerpts selected.', { exact: true })).toBeVisible();
  const retained = await page.request.get(`/api/v1/revisits/${note.id}`);
  expect(apiSchemas.Revisit.parse(await retained.json()).note).toBe(note.note);
  await page.getByRole('button', { name: 'Add excerpt', exact: true }).click();
  const reviewed = page.waitForResponse((r) => r.url().endsWith('/api/v1/context-preview'));
  await page.getByRole('button', { name: 'Review selected excerpts' }).click();
  const proof = apiSchemas.ContextPreview.parse(await (await reviewed).json());
  await acknowledge.check();
  const submitted: unknown[] = [];
  let admitted!: () => void;
  const accepted = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  await page.route('**/api/v1/requests', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    submitted.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    await route.abort('connectionreset');
    admitted();
  });
  await page.getByRole('button', { name: 'Start reading', exact: true }).click();
  await accepted;
  await page.reload();
  await expect(page.getByTestId('accepted-reading')).toBeVisible();
  expect(submitted).toMatchObject([
    {
      question: 'Which change feels workable today?',
      parentEditionId: null,
      selection: proof.items.map((i) => i.selection),
      contextAcknowledgement: proof.acknowledgementHash,
    },
  ]);
  expect(JSON.stringify(submitted)).not.toContain('PRIVATE TAIL');
  const requestId = new URL(page.url()).pathname.split('/').at(-1)!;
  const status = apiSchemas.RequestStatus.parse(
    await (await page.request.get(`/api/v1/requests/${requestId}`)).json(),
  );
  const result = apiSchemas.Reading.parse(
    await (await page.request.get(`/api/v1/readings/${status.editionId}`)).json(),
  );
  expect(result).toMatchObject({
    kind: 'tarot.accepted.v3',
    provenance: { selected: [{ text: '😀e\u0301', sourceId: note.id, authorship: 'user' }] },
  });
});

test('AI-off saved reading ownership permits grant inspection and revocation without a new request', async ({
  page,
}) => {
  const { saved, note } = await savedNote(page, '198.51.100.202');
  const headers = {
    Origin: new URL(page.url()).origin,
    'X-CSRF-Token': saved.me.csrfToken,
    'Idempotency-Key': crypto.randomUUID(),
  };
  const result = await page.request.post('/api/v1/context-grants', {
    headers,
    data: { source: { kind: 'revisit_revision', revisitId: note.id, revision: 1 } },
  });
  expect(result.ok()).toBe(true);
  await openAccount(page);
  await page.getByRole('button', { name: 'Turn off AI readings' }).click();
  await backToReadings(page);
  const starts: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/requests')) starts.push(req.url());
  });
  await page.getByRole('button', { name: 'Sharing eligibility', exact: true }).click();
  const source = page.getByLabel('Source', { exact: true });
  const option = source.locator('option').filter({ hasText: 'Revisit note' });
  await expect(option).toHaveCount(1);
  await source.selectOption({ label: (await option.textContent())! });
  await page.getByRole('button', { name: 'Revoke eligibility', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/revoked.*future/i)).toBeVisible();
  expect(starts).toEqual([]);
});

test('a follow-up starts its source browser at its parent while keeping every excerpt unselected', async ({
  page,
}) => {
  const { saved, note } = await savedNote(page, '198.51.100.219');
  await page.getByRole('link', { name: 'Follow up on this edition', exact: true }).click();
  const chooser = page.getByRole('region', { name: 'Selected context', exact: true });
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/(context-preview|requests)$/.test(request.url()))
      sent.push(request.url());
  });
  await chooser.getByRole('button', { name: 'Choose excerpts', exact: true }).click();
  await expect(
    chooser.getByRole('heading', { name: saved.session.question!, exact: true }),
  ).toBeVisible();
  await expect(chooser.getByText('No excerpts selected.', { exact: true })).toBeVisible();
  await expect(chooser.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(chooser.getByLabel('Saved reading', { exact: true })).not.toBeVisible();
  const source = chooser.getByRole('radio', { name: /Your revisit note/ });
  await source.check();
  const sourceRow = chooser
    .locator('.context-source-row')
    .filter({ has: page.getByRole('radio', { checked: true }) });
  await sourceRow.getByText('Read passage', { exact: true }).click();
  await expect(sourceRow.locator('blockquote')).toHaveText(note.note);
  await expect(sourceRow.locator('blockquote')).toBeVisible();
  await chooser.getByRole('button', { name: 'Allow this source', exact: true }).click();
  await expect(chooser.getByText('No excerpts selected.', { exact: true })).toBeVisible();
  expect(sent).toEqual([]);
});

test('whole-passage selection stays exact and a changed source cannot reuse its reviewed acknowledgement', async ({
  page,
}) => {
  const { saved, note } = await savedNote(page, '198.51.100.220');
  const headers = {
    Origin: new URL(page.url()).origin,
    'X-CSRF-Token': saved.me.csrfToken,
    'Idempotency-Key': crypto.randomUUID(),
  };
  const shortened = await page.request.put(`/api/v1/revisits/${note.id}`, {
    headers: { ...headers, 'If-Match': `"${note.revision}"` },
    data: { note: 'A short passage.\nA second thought.', stance: 'unsure' },
  });
  expect(shortened.ok()).toBe(true);
  const sourceNote = apiSchemas.Revisit.parse(await shortened.json());
  await page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Tarot', exact: true })
    .click();
  await page.getByLabel('Your question', { exact: true }).fill('What can remain simple?');
  await page.getByLabel('Use English for this reading').check();
  await chooseNote(page, saved.session.id);
  await page.getByRole('button', { name: 'Allow this source', exact: true }).click();
  await expect(page.getByLabel('First character', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Use whole passage', exact: true }).click();
  await page.getByRole('button', { name: 'Review selected excerpts', exact: true }).click();
  const review = page.getByRole('region', { name: 'Review selected excerpts', exact: true });
  await expect(review.locator('blockquote')).toHaveText(sourceNote.note);
  const acknowledge = page.getByLabel('I agree to use these exact excerpts for this reading.');
  await acknowledge.check();
  await expect(page.getByRole('button', { name: 'Choose excerpts', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Saved passage', { exact: true })).toHaveCount(0);
  const changed = await page.request.put(`/api/v1/revisits/${note.id}`, {
    headers: {
      ...headers,
      'Idempotency-Key': crypto.randomUUID(),
      'If-Match': `"${sourceNote.revision}"`,
    },
    data: { note: 'My later words stay private.', stance: 'unsure' },
  });
  expect(changed.ok()).toBe(true);
  await review.getByRole('button', { name: 'Change selected excerpts', exact: true }).click();
  await expect(acknowledge).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start reading', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Review selected excerpts', exact: true }).click();
  await expect(
    page.getByText(
      'A selected source changed or is unavailable. Remove the old excerpt and review your selection again.',
    ),
  ).toBeVisible();
  await expect(review).toHaveCount(0);
});
