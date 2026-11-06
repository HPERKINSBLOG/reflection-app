import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { apiSchemas } from '../../src/contracts/index.ts';
import { account, openAccount, reading, savedSnapshot } from '../fixtures/browser-reading.ts';

async function captureReturn(page: Page, variant: string, widths = [1440, 390, 320]) {
  await mkdir('/tmp/reflection-return-ui', { recursive: true });
  for (const theme of ['paper', 'evening']) {
    await page.getByLabel('Color theme').selectOption(theme);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const workspace = page.locator('.reading-return');
      const interpretation = page.locator('.reading-return-interpretation');
      const writing = page.locator('.reading-personal-writing');
      const title = page.getByTestId('accepted-reading').getByRole('heading', { level: 2 });
      const art = page.locator('.reading-return-art');
      await expect(art).toBeVisible();
      await expect
        .poll(() =>
          art.evaluate(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
        )
        .toBe(true);
      const [outer, left, right, heading, illustration] = await Promise.all([
        workspace.boundingBox(),
        interpretation.boundingBox(),
        writing.boundingBox(),
        title.boundingBox(),
        art.boundingBox(),
      ]);
      expect([outer, left, right, heading, illustration].every(Boolean)).toBe(true);
      if (width === 1440) {
        expect(outer!.width).toBeGreaterThan(1000);
        expect(left!.width).toBeGreaterThan(400);
        expect(right!.width).toBeGreaterThan(400);
        expect(right!.x).toBeGreaterThan(left!.x + left!.width + 16);
        expect(Math.abs(right!.y - left!.y)).toBeLessThan(2);
        const savedHeading = writing.locator('.saved-reflection-heading');
        if (await savedHeading.isVisible()) {
          const [labelBox, savedHeadingBox] = await Promise.all([
            interpretation.locator('.return-section-label').boundingBox(),
            savedHeading.boundingBox(),
          ]);
          expect(Math.abs(labelBox!.y - savedHeadingBox!.y)).toBeLessThan(4);
        }
      } else {
        expect(outer!.width).toBeGreaterThanOrEqual(width - 64);
        expect(left!.width).toBeGreaterThanOrEqual(width - 64);
        expect(right!.width).toBeGreaterThanOrEqual(width - 64);
        expect(right!.y).toBeGreaterThanOrEqual(left!.y + left!.height);
        expect(Math.abs(right!.x - left!.x)).toBeLessThan(2);
      }
      const overlaps =
        heading!.x < illustration!.x + illustration!.width &&
        heading!.x + heading!.width > illustration!.x &&
        heading!.y < illustration!.y + illustration!.height &&
        heading!.y + heading!.height > illustration!.y;
      expect(overlaps).toBe(false);
      expect(left!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height);
      await expect(interpretation.locator('.return-position')).toHaveCount(3);
      for (const note of await page.locator('.revisit-note .authored-note').all()) {
        await expect(note).toBeVisible();
        expect(await note.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(
          true,
        );
      }
      await page.screenshot({
        path: `/tmp/reflection-return-ui/${variant}-${theme}-${width}-full.png`,
        fullPage: true,
      });
    }
  }
}

test('a returned follow-up identifies its exact parent and original draw before the interpretation', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await account(page, '198.51.100.231');
  const parentQuestion = 'What deserves more space in my life?';
  await reading(page, parentQuestion);
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  const original = await savedSnapshot(page);
  await page.getByRole('link', { name: 'Ask a follow-up', exact: true }).click();
  const question = 'How can I protect time for what matters?';
  await page.getByLabel('Your follow-up question', { exact: true }).fill(question);
  await page.getByLabel('Use English for this reading').check();
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/v1/requests')) posts++;
  });
  await page.getByRole('button', { name: 'Review follow-up', exact: true }).click();
  const review = page.getByRole('region', { name: 'Review follow-up', exact: true });
  await expect(review.getByText(question, { exact: true })).toBeVisible();
  await expect(review.getByText(parentQuestion, { exact: true })).toBeVisible();
  await expect(review).toContainText('No new draw');
  await expect(review).toContainText('No excerpts selected');
  expect(posts).toBe(0);
  await review.getByRole('button', { name: 'Back to question and context', exact: true }).click();
  await expect(page.getByLabel('Your follow-up question', { exact: true })).toHaveValue(question);
  await page.getByRole('button', { name: 'Review follow-up', exact: true }).click();
  await review.getByRole('button', { name: 'Start follow-up', exact: true }).click();
  const result = page.getByTestId('accepted-reading');
  await expect(result.getByRole('heading', { name: question, exact: true })).toBeVisible();
  await expect(result).toContainText('No new draw');
  await expect(result.getByText(parentQuestion, { exact: true })).toBeVisible();
  await expect(result.getByText(/^Drawn card:/)).toHaveCount(0);
  const editions = page.getByRole('navigation', { name: 'Edition history', exact: true });
  await expect(
    editions
      .locator(`a[href="/saved/${original.session.id}/${original.reading.editionId}"]`)
      .first(),
  ).toHaveAttribute('href', `/saved/${original.session.id}/${original.reading.editionId}`);
  expect(
    await editions.evaluate(
      (nav) =>
        nav.getBoundingClientRect().top <
        document.querySelector('.reading-return-title')!.getBoundingClientRect().top,
    ),
  ).toBe(true);
  await page.reload();
  await expect(result.getByText(parentQuestion, { exact: true })).toBeVisible();
  const followUp = await savedSnapshot(page);
  const originalPath = `/saved/${original.session.id}/${original.reading.editionId}`;
  const followUpPath = `/saved/${original.session.id}/${followUp.reading.editionId}`;
  const originalLink = editions.locator(`a[href="${originalPath}"]`).first();
  await expect(editions.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(editions.locator('[aria-current="page"]')).toContainText('Follow-up 1');
  const personal = page.getByRole('region', { name: 'Personal reflection', exact: true });
  const reflection = page.getByLabel('Your reflection', { exact: true });
  const childWords = 'I can leave Thursday evening open without deciding how to use it yet.';
  await reflection.fill(childWords);
  await page.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(page.getByText('Reflection saved.', { exact: true })).toBeVisible();
  let releaseEdition!: () => void;
  let editionRequested!: () => void;
  const editionHeld = new Promise<void>((resolve) => {
    editionRequested = resolve;
  });
  const editionReleased = new Promise<void>((resolve) => {
    releaseEdition = resolve;
  });
  const target = `**/api/v1/readings/${original.reading.editionId}`;
  await page.route(target, async (route) => {
    editionRequested();
    await editionReleased;
    await route.continue();
  });
  await originalLink.click();
  await editionHeld;
  await expect(personal).toHaveCount(0);
  await expect(reflection).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add revisit note', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Your revisit note', { exact: true })).toHaveCount(0);
  releaseEdition();
  await expect(result.getByRole('heading', { name: parentQuestion, exact: true })).toBeVisible();
  await page.unroute(target);
  await editions.locator(`a[href="${followUpPath}"]`).click();
  await expect(personal.locator('.saved-reflection-text')).toHaveText(childWords);
  await personal.getByRole('button', { name: 'Edit reflection', exact: true }).click();
  await reflection.fill('These changes belong to the follow-up, not the original.');
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toMatch(/unsaved|discard/i);
    await dialog.dismiss();
  });
  await originalLink.click();
  await expect(page).toHaveURL(followUpPath);
  await expect(reflection).toHaveValue('These changes belong to the follow-up, not the original.');
  await page.getByRole('button', { name: 'Cancel editing', exact: true }).click();
  await expect(personal.locator('.saved-reflection-text')).toHaveText(childWords);
  const notes = page.getByRole('region', { name: 'Revisit notes', exact: true });
  const noteWords = 'I noticed how quickly I tried to fill the open evening.';
  await notes.getByRole('button', { name: 'Add revisit note', exact: true }).click();
  await page.getByLabel('Your revisit note', { exact: true }).fill(noteWords);
  await page.getByLabel('Your response (optional)', { exact: true }).selectOption('unsure');
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toMatch(/unsaved|discard/i);
    await dialog.dismiss();
  });
  await originalLink.click();
  await expect(page).toHaveURL(followUpPath);
  await expect(page.getByLabel('Your revisit note', { exact: true })).toHaveValue(noteWords);
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(notes.getByRole('article')).toContainText(noteWords);
  await originalLink.click();
  await expect(result.getByRole('heading', { name: parentQuestion, exact: true })).toBeVisible();
  await expect(editions.locator('[aria-current="page"]')).toContainText('Original reading');
  await expect(personal.locator('.saved-reflection-text')).toHaveCount(0);
  await expect(notes.getByRole('article')).toHaveCount(0);
  const originalWords = 'The original reading gave me permission to begin with one small change.';
  await reflection.fill(originalWords);
  await page.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(page.getByText('Reflection saved.', { exact: true })).toBeVisible();
  await editions.locator(`a[href="${followUpPath}"]`).click();
  await expect(result.getByRole('heading', { name: question, exact: true })).toBeVisible();
  await expect(personal.locator('.saved-reflection-text')).toHaveText(childWords);
  await expect(notes.getByRole('article')).toContainText(noteWords);
  await notes.getByRole('button', { name: 'Edit note', exact: true }).click();
  await page.getByLabel('Your revisit note', { exact: true }).fill('An unfinished edit.');
  await notes.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(notes.getByRole('article')).toContainText(noteWords);
  await notes.getByRole('button', { name: 'Edit note', exact: true }).click();
  const revisedNote = 'I left the evening open, and the quieter pace was easier to sustain.';
  await page.getByLabel('Your revisit note', { exact: true }).fill(revisedNote);
  await page.getByLabel('Your response (optional)', { exact: true }).selectOption('resonates');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(notes.getByRole('article')).toContainText(revisedNote);
  await notes.getByRole('button', { name: 'Add revisit note', exact: true }).click();
  await page
    .getByLabel('Your revisit note', { exact: true })
    .fill('A second observation to remove.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(notes.getByRole('article')).toHaveCount(2);
  let historyRequested!: () => void;
  let releaseHistory!: () => void;
  const historyHeld = new Promise<void>((resolve) => {
    historyRequested = resolve;
  });
  const historyReleased = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  const historyRoute = '**/api/v1/sessions?status=saved&method=all';
  await page.route(historyRoute, async (route) => {
    historyRequested();
    await historyReleased;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  await historyHeld;
  for (const action of [
    page.locator('.reading-personal-writing').getByRole('button', {
      name: 'Edit reflection',
      exact: true,
      includeHidden: true,
    }),
    page.locator('.revisit-notes--return').getByRole('button', {
      name: 'Add revisit note',
      exact: true,
      includeHidden: true,
    }),
    page
      .locator('.revisit-notes--return')
      .getByRole('button', {
        name: 'Edit note',
        exact: true,
        includeHidden: true,
      })
      .first(),
  ]) {
    await expect
      .poll(() => action.evaluate((node) => node.matches(':disabled') || !!node.closest('[inert]')))
      .toBe(true);
    await action.focus();
    await expect(action).not.toBeFocused();
  }
  await expect(reflection).toBeHidden();
  await expect(page.getByLabel('Your revisit note', { exact: true })).toHaveCount(0);
  releaseHistory();
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible();
  await page.unroute(historyRoute);
  await page.goto(followUpPath);
  await expect(personal.locator('.saved-reflection-text')).toHaveText(childWords);
  await expect(notes.getByRole('article')).toHaveCount(2);
  await captureReturn(page, 'follow-up');
  const secondNote = notes
    .getByRole('article')
    .filter({ hasText: 'A second observation to remove.' });
  await secondNote.getByRole('button', { name: 'Delete note', exact: true }).click();
  await page.getByLabel('Delete this note and all saved versions permanently').check();
  await page.getByRole('button', { name: 'Confirm note deletion', exact: true }).click();
  await expect(notes.getByRole('article')).toHaveCount(1);
  await expect(notes.getByRole('article')).toContainText(revisedNote);
  await page.reload();
  await expect(personal.locator('.saved-reflection-text')).toHaveText(childWords);
  await expect(notes.getByRole('article')).toContainText(revisedNote);
  await originalLink.click();
  await expect(personal.locator('.saved-reflection-text')).toHaveText(originalWords);
  await expect(notes.getByRole('article')).toHaveCount(0);
  expect(posts).toBe(1);
});

test('saved reflections reopen for reading and edit cancellation preserves the saved words with AI off', async ({
  page,
}) => {
  await account(page, '198.51.100.232');
  await reading(page, 'What might I notice when I return?');
  const words = 'I can leave Thursday evening open.\nI want to notice what changes.';
  await page.getByLabel('Your reflection', { exact: true }).fill(words);
  await page.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(page.getByText('Reflection saved.', { exact: true })).toBeVisible();
  const saved = await savedSnapshot(page);
  await openAccount(page);
  await page.getByRole('button', { name: 'Turn off AI readings', exact: true }).click();
  await page.goto(`/saved/${saved.session.id}/${saved.reading.editionId}`);
  const personal = page.getByRole('region', { name: 'Personal reflection', exact: true });
  await expect(personal.getByText(words, { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel('Your reflection', { exact: true })).toBeHidden();
  await personal.getByRole('button', { name: 'Edit reflection', exact: true }).click();
  await expect(page.getByLabel('Your reflection', { exact: true })).toBeFocused();
  await page.getByLabel('Your reflection', { exact: true }).fill('An unsaved change.');
  await page.getByRole('button', { name: 'Cancel editing', exact: true }).click();
  await expect(personal.getByText(words, { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(
    personal.getByRole('button', { name: 'Edit reflection', exact: true }),
  ).toBeFocused();
  await personal.getByRole('button', { name: 'Edit reflection', exact: true }).click();
  await expect(page.getByLabel('Your reflection', { exact: true })).toHaveValue(words);
  const revised = 'The quieter evening made room for a different kind of attention.';
  await page.getByLabel('Your reflection', { exact: true }).fill(revised);
  await page.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(page.getByText('Reflection saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(personal.locator('.saved-reflection-text')).toHaveText(revised);
  await expect(page.getByLabel('Your reflection', { exact: true })).toBeHidden();
});

test('three real editions and long questions keep their exact links and readable layouts', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await account(page, '198.51.100.233');
  await reading(page, 'What deserves my attention when several paths remain possible?');
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  const original = await savedSnapshot(page);
  if (original.reading.kind !== 'tarot.accepted.v2')
    throw new Error('Expected native tarot fixture');
  let parentEditionId = original.reading.editionId;
  let question = '';
  for (let index = 1; index <= 2; index++) {
    question =
      `Return ${index}: ${'What might change when I leave time for the commitments that matter? '.repeat(8)}`.slice(
        0,
        500,
      );
    const started = await page.request.post('/api/v1/requests', {
      headers: {
        Origin: new URL(page.url()).origin,
        'X-CSRF-Token': original.me.csrfToken,
        'Idempotency-Key': crypto.randomUUID(),
      },
      data: {
        question,
        languageConfirmed: 'en',
        reversals: original.reading.basis.reversals,
        permissionRevision: original.me.permission.revision,
        parentEditionId,
        selection: [],
        clientIntentId: crypto.randomUUID(),
      },
    });
    expect(started.ok(), await started.text()).toBe(true);
    const request = apiSchemas.StartResponse.parse(await started.json());
    await expect
      .poll(async () => {
        const response = await page.request.get(`/api/v1/requests/${request.requestId}`);
        expect(response.ok()).toBe(true);
        const status = apiSchemas.RequestStatus.parse(await response.json());
        if (status.editionId) parentEditionId = status.editionId;
        return status.state;
      })
      .toBe('published');
  }
  await page.goto(`/saved/${original.session.id}/${parentEditionId}`);
  await expect(
    page.getByTestId('accepted-reading').getByRole('heading', { name: question, exact: true }),
  ).toBeVisible();
  const stored = apiSchemas.SessionRecord.parse(
    await (await page.request.get(`/api/v1/sessions/${original.session.id}`)).json(),
  );
  expect(stored.editionIds).toHaveLength(3);
  const editions = page.getByRole('navigation', { name: 'Edition history', exact: true });
  for (const id of stored.editionIds.filter((id) => id !== parentEditionId))
    await expect(
      editions.locator(`a[href="/saved/${original.session.id}/${id}"]`).first(),
    ).toBeVisible();
  await expect(editions.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(editions.locator('[aria-current="page"]')).toContainText('Follow-up 2');
  await captureReturn(page, 'long-editions', [1440, 320]);
});
