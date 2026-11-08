import { expect, test, type Locator, type Page } from '@playwright/test';
import { READING_PRODUCT_COPY } from '../../src/contracts/product-copy.ts';
import { account, enableAi, openTarot, toReview } from '../fixtures/browser-reading.ts';

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const step = (page: Page, label: string) =>
  page
    .getByRole('list', { name: 'Reading steps' })
    .getByRole('listitem')
    .filter({ hasText: label });

function countStarts(page: Page) {
  const bodies: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/requests')
      bodies.push(request.postDataJSON());
  });
  return bodies;
}

async function tabTo(page: Page, target: Locator) {
  for (let presses = 0; presses < 30; presses++) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Keyboard focus never reached the control');
}

test('a new reading moves from question to spread to review, and only review can start', async ({
  page,
}) => {
  await account(page, '198.51.100.10');
  await enableAi(page);
  const starts = countStarts(page);
  await openTarot(page);
  await expect(heading(page, 'What is on your mind?')).toBeFocused();
  await expect(step(page, 'Question')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('button', { name: 'Start reading', exact: true })).toHaveCount(0);

  const question = page.getByLabel('Your question', { exact: true });
  await question.fill('Where can I begin?');
  await question.press('Enter');
  expect(starts).toHaveLength(0);
  await question.fill('Where can I begin?');
  await page.getByRole('button', { name: 'Choose your spread', exact: true }).click();
  await expect(heading(page, 'One question. Three perspectives.')).toBeFocused();
  await expect(step(page, 'Spread')).toHaveAttribute('aria-current', 'step');
  await expect(step(page, 'Question')).not.toHaveAttribute('aria-current', 'step');

  await page.getByRole('button', { name: 'Let Reflection draw', exact: true }).click();
  await expect(heading(page, 'Ready when you are.')).toBeFocused();
  await expect(step(page, 'Spread')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByText('Where can I begin?', { exact: true })).toBeVisible();
  await expect(page.getByText('App draw · Reversed cards: Off', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Before you start' })).toContainText(
    READING_PRODUCT_COPY.startProcessing,
  );

  const start = page.getByRole('button', { name: 'Start reading', exact: true });
  await expect(start).toBeDisabled();
  await page.getByLabel('Use English for this reading').check();
  await expect(start).toBeEnabled();
  await start.dblclick();
  await expect(page.getByTestId('accepted-reading')).toBeVisible();
  expect(starts).toHaveLength(1);
  expect(starts[0]).toMatchObject({ question: 'Where can I begin?', reversals: false });
  expect(starts[0]).not.toHaveProperty('spreadPhoto');
});

test('an empty question cannot continue', async ({ page }) => {
  await account(page, '198.51.100.11');
  await enableAi(page);
  await openTarot(page);
  const question = page.getByLabel('Your question', { exact: true });
  const proceed = page.getByRole('button', { name: 'Choose your spread', exact: true });
  for (const value of ['', '   ']) {
    await question.fill(value);
    await proceed.click();
    await expect(page.getByText('Enter your question to continue.', { exact: true })).toBeVisible();
    await expect(question).toBeFocused();
    await expect(question).toHaveAttribute('aria-invalid', 'true');
    await expect(question).toHaveAccessibleDescription(/Enter your question to continue\./);
    await expect(heading(page, 'What is on your mind?')).toBeVisible();
  }
  await question.fill('Something to consider');
  await expect(page.getByText('Enter your question to continue.', { exact: true })).toHaveCount(0);
  await expect(question).not.toHaveAttribute('aria-invalid', 'true');
});

test('going back keeps every entry', async ({ page }) => {
  await account(page, '198.51.100.12');
  await enableAi(page);
  await openTarot(page);
  await toReview(page, 'What would a gentler week look like?', { reversals: true });
  await expect(page.getByText('App draw · Reversed cards: On', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit your question', exact: true }).click();
  await expect(heading(page, 'What is on your mind?')).toBeFocused();
  const question = page.getByLabel('Your question', { exact: true });
  await expect(question).toHaveValue('What would a gentler week look like?');
  await page.getByRole('button', { name: 'Choose your spread', exact: true }).click();
  await expect(page.getByLabel('Include reversed cards')).toBeChecked();

  await page.getByRole('button', { name: 'Back to your question', exact: true }).click();
  await expect(question).toHaveValue('What would a gentler week look like?');
  await page.getByRole('button', { name: 'Choose your spread', exact: true }).click();
  await page.getByRole('button', { name: 'Let Reflection draw', exact: true }).click();
  await page.getByRole('button', { name: 'Change the spread', exact: true }).click();
  await expect(heading(page, 'One question. Three perspectives.')).toBeFocused();
});

test('suggested questions appear only while the question is empty', async ({ page }) => {
  await account(page, '198.51.100.13');
  await enableAi(page);
  await openTarot(page);
  const suggestions = page.getByRole('group', { name: 'A place to begin' });
  await expect(suggestions.getByRole('button')).toHaveCount(2);
  await suggestions
    .getByRole('button', { name: 'What deserves more space in my life?', exact: true })
    .click();
  const question = page.getByLabel('Your question', { exact: true });
  await expect(question).toHaveValue('What deserves more space in my life?');
  await expect(question).toBeFocused();
  await expect(suggestions).toHaveCount(0);
  await question.fill('');
  await expect(
    suggestions.getByRole('button', { name: 'How can I make room for my own needs?', exact: true }),
  ).toBeVisible();
});

test('open your journal leaves the composer and tarot returns with the question', async ({
  page,
}) => {
  await account(page, '198.51.100.14');
  await enableAi(page);
  await openTarot(page);
  await page.getByLabel('Your question', { exact: true }).fill('Keep this question close');
  await page.getByRole('button', { name: 'Open your journal', exact: true }).click();
  await expect(heading(page, 'Your journal')).toBeVisible();
  await openTarot(page);
  await expect(page.getByLabel('Your question', { exact: true })).toHaveValue(
    'Keep this question close',
  );
});

test('the steps can be completed by keyboard alone, with named and described controls', async ({
  page,
}) => {
  await account(page, '198.51.100.15');
  await enableAi(page);
  const starts = countStarts(page);
  const tarot = page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Tarot', exact: true });
  // Tarot waits for the reading service's status; a click would wait too.
  await expect(tarot).toBeEnabled();
  await tarot.focus();
  await page.keyboard.press('Enter');
  await expect(heading(page, 'What is on your mind?')).toBeFocused();

  const question = page.getByLabel('Your question', { exact: true });
  await expect(question).toHaveAccessibleDescription(/Up to 500 characters/);
  await tabTo(page, question);
  await page.keyboard.type('What can I let be simple?');
  await tabTo(page, page.getByRole('button', { name: 'Choose your spread', exact: true }));
  await page.keyboard.press('Enter');
  await expect(heading(page, 'One question. Three perspectives.')).toBeFocused();

  const draw = page.getByRole('button', { name: 'Let Reflection draw', exact: true });
  await expect(draw).toHaveAccessibleDescription(
    'Draw three cards for this question. Situation · Tension · Possibility',
  );
  await expect(
    page.getByRole('button', { name: 'Use my physical spread', exact: true }),
  ).toHaveAccessibleDescription('Bring a photo of three cards you have already drawn.');
  await tabTo(page, draw);
  await page.keyboard.press('Enter');
  await expect(heading(page, 'Ready when you are.')).toBeFocused();

  const start = page.getByRole('button', { name: 'Start reading', exact: true });
  await expect(start).toHaveAccessibleDescription('Confirm that you want to use English to start.');
  await tabTo(page, page.getByLabel('Use English for this reading'));
  await page.keyboard.press('Space');
  await tabTo(page, start);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('accepted-reading')).toBeVisible();
  expect(starts).toHaveLength(1);
});
