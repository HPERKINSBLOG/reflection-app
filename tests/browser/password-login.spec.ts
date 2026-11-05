import { expect, type Page, test } from '@playwright/test';
import { account, keepKit, openAccount, reading } from '../fixtures/browser-reading.ts';

const password = 'A long garden passphrase';
async function signOut(page: Page) {
  await openAccount(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
}
async function signIn(page: Page, identifier: string, secret = password) {
  await page.getByRole('button', { name: 'Sign in with a password', exact: true }).click();
  await page.getByLabel('Username or email').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('a password account returns to its saved reading by username, email and kit recovery without a passkey', async ({
  page,
}) => {
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));
  await page.context().setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.211' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a password account', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill('RiverReader');
  await page.getByLabel('Email', { exact: true }).fill('river@example.org');
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  const kit = await keepKit(page);
  const question = 'Where can I make time for a walk?';
  await reading(page, question);
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Reading saved.', { exact: false }).first()).toBeVisible();
  await signOut(page);
  await signIn(page, 'RIVERREADER');
  await expect(page.getByRole('button', { name: question, exact: true })).toBeVisible();
  await signOut(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'River@Example.ORG');
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible();
  await signOut(page);
  await page.getByRole('link', { name: 'Recover with your saved kit' }).click();
  await page.getByLabel('Recovery handle').fill(kit.recoveryHandle);
  await page.getByLabel('Unused recovery code').fill(kit.codes[0]);
  await page.getByRole('button', { name: 'Verify recovery kit' }).click();
  const replacement = 'My replacement passphrase';
  await page.getByLabel('New password', { exact: true }).fill(replacement);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await keepKit(page);
  await signOut(page);
  await signIn(page, 'river@example.org', replacement);
  await expect(page.getByRole('button', { name: question, exact: true })).toBeVisible();
  expect(faults).toEqual([]);
});

test('a passkey user adds password sign-in to their existing account', async ({ page }) => {
  await account(page, '192.0.2.212');
  await openAccount(page);
  await page.getByText('Add password sign-in', { exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill('PaperReader');
  await page.getByLabel('Email', { exact: true }).fill('paper@example.org');
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Save password sign-in' }).click();
  await expect(page.getByText(/Password sign-in added/)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, 'PaperReader');
  await openAccount(page);
  await expect(page.getByRole('list', { name: 'Passkeys' }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Replace recovery kit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm your password' });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Confirm password' }).click();
  await expect(page.getByRole('heading', { name: 'Keep your recovery kit' })).toBeVisible();
});
