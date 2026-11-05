import { expect, test } from '@playwright/test';
import { account } from '../fixtures/browser-reading.ts';
import { patternBirth, patternRequest } from '../fixtures/browser-pattern.ts';

for (const editor of ['reflection', 'birth details'] as const)
  for (const outcome of ['success', 'failure'] as const)
    test(`pending Journal navigation locks ${editor} until ${outcome}`, async ({ page }) => {
      await account(
        page,
        `198.51.100.${239 + (editor === 'birth details' ? 2 : 0) + (outcome === 'failure' ? 1 : 0)}`,
      );
      await patternRequest(
        page,
        '/profile',
        { birth: patternBirth, expectedRevision: 0, confirmedRetention: true },
        'PUT',
      );
      const navigation = page.getByRole('navigation', { name: 'Reading actions' });
      await navigation.getByRole('button', { name: 'Astrology', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Your pattern', exact: true })).toBeVisible();
      if (editor === 'birth details')
        await page.getByRole('button', { name: 'Review birth details', exact: true }).click();
      const field = page.getByLabel(editor === 'reflection' ? 'Your reflection' : 'Place name', {
        exact: true,
      });
      const original = await field.inputValue();
      const historyUrl = /\/api\/v1\/sessions\?status=saved&method=all$/;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(historyUrl, async (route) => {
        await held;
        if (outcome === 'failure') await route.fulfill({ status: 503, body: '' });
        else await route.continue();
      });
      const requested = page.waitForRequest(historyUrl);
      await navigation.getByRole('button', { name: 'Journal', exact: true }).click();
      await requested;
      try {
        await expect(
          navigation.getByRole('button', { name: 'Journal', exact: true }),
        ).toBeDisabled();
        await expect(field).toBeVisible();
        // Attempt real input while the old editor is still mounted. Neither focus
        // nor typing may create a draft that the pending navigation would discard.
        await field.focus();
        await page.keyboard.insertText('Words entered during navigation.');
        await expect(field).toHaveValue(original);
        await expect(field).not.toBeFocused();
      } finally {
        release();
      }
      await expect(
        page.getByRole('region', { name: 'Saved reading history', exact: true }),
      ).toBeVisible();
      if (outcome === 'failure')
        await expect(
          page.getByRole('button', { name: 'Retry loading saved readings', exact: true }),
        ).toBeVisible();
      await navigation.getByRole('button', { name: 'Astrology', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Your pattern', exact: true })).toBeVisible();
      if (editor === 'birth details')
        await page.getByRole('button', { name: 'Review birth details', exact: true }).click();
      await field.fill('Editing works after returning.');
      await expect(field).toHaveValue('Editing works after returning.');
    });
