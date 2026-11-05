import { expect, test } from '@playwright/test';
import { account, openAccount, reading, savedSnapshot } from '../fixtures/browser-reading.ts';

test('a returned follow-up identifies its exact parent and original draw before the interpretation', async ({
  page,
}) => {
  await account(page, '198.51.100.231');
  const parentQuestion = 'What deserves more space in my life?';
  await reading(page, parentQuestion);
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  const original = await savedSnapshot(page);
  await page.getByRole('link', { name: 'Follow up on this edition', exact: true }).click();
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
  await expect(result.getByText('No new draw', { exact: true })).toBeVisible();
  await expect(result.getByText(parentQuestion, { exact: true })).toBeVisible();
  await expect(result.getByText(/^Drawn card:/)).toHaveCount(0);
  const editions = page.getByRole('navigation', { name: 'Edition history', exact: true });
  await expect(
    editions.getByRole('link').filter({ hasText: parentQuestion }).first(),
  ).toHaveAttribute('href', `/saved/${original.session.id}/${original.reading.editionId}`);
  expect(
    await editions.evaluate(
      (nav) =>
        nav.getBoundingClientRect().top <
        document.querySelector('[data-testid="accepted-reading"]')!.getBoundingClientRect().top,
    ),
  ).toBe(true);
  await page.reload();
  await expect(result.getByText(parentQuestion, { exact: true })).toBeVisible();
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
});
