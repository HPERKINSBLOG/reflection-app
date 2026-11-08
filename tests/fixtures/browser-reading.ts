import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { apiSchemas } from '../../src/contracts/index.ts';

export async function authenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}
export async function keepKit(page: Page) {
  await expect(page.getByRole('heading', { name: 'Keep your recovery kit' })).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recovery kit' }).click();
  const kit = JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  await page.getByLabel('I have saved the complete kit with the handle and codes.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your readings', exact: true })).toBeVisible();
  return kit;
}
export async function account(page: Page, ip: string) {
  await page.context().setExtraHTTPHeaders({ 'CF-Connecting-IP': ip });
  const auth = await authenticator(page);
  // Start where a new reader does: "Draw three cards" on the welcome page opens sign-in.
  await page.goto('/');
  await page.getByRole('link', { name: 'Draw three cards', exact: true }).click();
  await page.getByRole('button', { name: 'Create a test account' }).click();
  return { auth, kit: await keepKit(page) };
}
/** The welcome page invites; its "I have an account" link opens the sign-in controls. */
export async function openSignIn(page: Page) {
  await page.getByRole('link', { name: 'I have an account', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole('heading', { name: 'Sign in or create an account', exact: true }),
  ).toBeVisible();
}
export async function openAccount(page: Page) {
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
}
export async function backToReadings(page: Page) {
  await page.getByRole('link', { name: 'Back to readings', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your readings', exact: true })).toBeVisible();
}
/** Returns with browser Back, so the readings keep their original history entry. */
export async function enableAi(page: Page) {
  await openAccount(page);
  await page.getByRole('button', { name: 'Enable AI readings', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'AI readings are on', exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('region', { name: 'Your readings', exact: true })).toBeVisible();
}
/** Opens a new tarot reading from the header; it starts on the Question step. */
export async function openTarot(page: Page) {
  await page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Tarot', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'What is on your mind?', exact: true }),
  ).toBeVisible();
}
/** From the Question step, enters the question and chooses an app draw; ends on Review. */
export async function toReview(
  page: Page,
  question: string,
  options: { reversals?: boolean } = {},
) {
  await page.getByLabel('Your question', { exact: true }).fill(question);
  await page.getByRole('button', { name: 'Choose your spread', exact: true }).click();
  if (options.reversals) await page.getByLabel('Include reversed cards').check();
  await page.getByRole('button', { name: 'Let Reflection draw', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Ready when you are.', exact: true }),
  ).toBeVisible();
}
/** On Review, confirms English and starts the reading. */
export async function startFromReview(page: Page) {
  await page.getByLabel('Use English for this reading').check();
  await page.getByRole('button', { name: 'Start reading', exact: true }).click();
}
/** On the Cards step after a new reading, moves on to the interpretation. */
export async function readInterpretation(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'Take a moment with the spread.', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Read the interpretation', exact: true }).click();
  await expect(page.getByTestId('accepted-reading')).toBeVisible();
}
export async function reading(page: Page, question: string) {
  await enableAi(page);
  await openTarot(page);
  await toReview(page, question);
  await expect(page.getByText(/Start temporarily stores/)).toBeVisible();
  await startFromReview(page);
  await readInterpretation(page);
}
export async function savedSnapshot(page: Page) {
  const result = await page.evaluate(async () => {
    const history = (await (await fetch('/api/v1/sessions?status=saved')).json()) as {
      items: Array<{ id: string; latestEditionId: string }>;
    };
    const item = history.items[0]!;
    return {
      item,
      reading: await (await fetch(`/api/v1/readings/${item.latestEditionId}`)).json(),
      session: await (await fetch(`/api/v1/sessions/${item.id}`)).json(),
      me: await (await fetch('/api/v1/me')).json(),
    };
  });
  return {
    ...result,
    reading: apiSchemas.Reading.parse(result.reading),
    session: apiSchemas.SessionRecord.parse(result.session),
    me: apiSchemas.SessionView.parse(result.me),
  };
}
