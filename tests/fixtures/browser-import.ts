import type { Page } from '@playwright/test';

/** Reviewed imports collapse setup; reopening it must preserve the existing selection. */
export async function openImportSelection(page: Page) {
  if (!(await page.getByLabel('Import file', { exact: true }).isVisible()))
    await page.getByText('File and record selection', { exact: true }).click();
}
