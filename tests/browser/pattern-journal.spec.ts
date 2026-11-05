import { expect, test } from '@playwright/test';
import { account } from '../fixtures/browser-reading.ts';
import { savePattern, patternBirth, patternRequest } from '../fixtures/browser-pattern.ts';

test('journal filters and reopens immutable Pattern facts, writing and dated revisits with AI off', async ({
  page,
}) => {
  await account(page, '192.0.2.224');
  const { saved } = await savePattern(page);
  await page.reload();
  const history = page.getByRole('region', { name: 'Saved reading history', exact: true });
  await history.getByRole('button', { name: 'Astrology', exact: true }).click();
  await expect(history.getByText('Astrology · Your Pattern', { exact: true })).toBeVisible();
  await history.locator('.journal-entry').first().getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`/saved/${saved.sessionId}/${saved.editionId}$`));
  const original = await page.getByTestId('pattern-reading').innerText();
  await expect(
    page.locator('.saved-reflection-text').filter({ hasText: 'My original Pattern reflection.' }),
  ).toBeVisible();
  await patternRequest(
    page,
    '/profile',
    {
      birth: { ...patternBirth, date: '2002-01-01' },
      expectedRevision: 1,
      confirmedRetention: true,
    },
    'PUT',
  );
  const forbidden: string[] = [];
  page.on('request', (req) => {
    if (/astrology\/pattern|\/generate/.test(req.url())) forbidden.push(req.url());
  });
  await page.reload();
  await expect(page.getByTestId('pattern-reading')).toHaveText(original, { useInnerText: true });
  await expect(page.getByRole('link', { name: 'Follow up on this edition' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add revisit note', exact: true }).click();
  await page
    .getByLabel('Your revisit note', { exact: true })
    .fill('I can see something new today.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByText('I can see something new today.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit reflection', exact: true }).click();
  await page.getByLabel('Your reflection', { exact: true }).fill('A revised personal reflection.');
  await page.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(
    page.locator('.saved-reflection-text').filter({ hasText: 'A revised personal reflection.' }),
  ).toBeVisible();
  expect(forbidden).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
