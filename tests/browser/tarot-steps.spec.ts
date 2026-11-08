import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiSchemas } from '../../src/contracts/index.ts';
import { READING_PRODUCT_COPY } from '../../src/contracts/product-copy.ts';
import {
  account,
  backToReadings,
  enableAi,
  openAccount,
  openTarot,
  readInterpretation,
  reading,
  savedSnapshot,
  startFromReview,
  toReview,
} from '../fixtures/browser-reading.ts';

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

const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);
const dataUrl = `data:image/png;base64,${image.toString('base64')}`;

/** Holds reads of files named slow* until the test calls window.releasePhotoReads(). */
async function holdSlowPhotoReads(page: Page) {
  await page.addInitScript(() => {
    const original = FileReader.prototype.readAsDataURL;
    const pending: Array<() => Promise<void>> = [];
    FileReader.prototype.readAsDataURL = function (blob) {
      if (blob instanceof File && blob.name.startsWith('slow')) {
        pending.push(
          () =>
            new Promise<void>((resolve) => {
              this.addEventListener('loadend', () => resolve(), { once: true });
              original.call(this, blob);
            }),
        );
      } else original.call(this, blob);
    };
    Object.assign(window, {
      releasePhotoReads: () => Promise.all(pending.splice(0).map((release) => release())),
    });
  });
}

async function toPhotoStep(page: Page, question: string) {
  await openTarot(page);
  await page.getByLabel('Your question', { exact: true }).fill(question);
  await page.getByRole('button', { name: 'Choose your spread', exact: true }).click();
  await page.getByRole('button', { name: 'Use my physical spread', exact: true }).click();
  await expect(heading(page, 'Bring the cards you drew.')).toBeFocused();
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
  await expect(page.locator('.review-question')).toHaveText('Where can I begin?');
  await expect(page.getByText('App draw · Reversed cards: Off', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Before you start' })).toContainText(
    READING_PRODUCT_COPY.startProcessing,
  );

  const start = page.getByRole('button', { name: 'Start reading', exact: true });
  await expect(start).toBeDisabled();
  await page.getByLabel('Use English for this reading').check();
  await expect(start).toBeEnabled();
  await start.dblclick();
  await expect(heading(page, 'Take a moment with the spread.')).toBeVisible();
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
  await expect(heading(page, 'Take a moment with the spread.')).toBeFocused();
  await tabTo(page, page.getByRole('button', { name: 'Read the interpretation', exact: true }));
  await page.keyboard.press('Enter');
  await expect(
    page
      .getByTestId('accepted-reading')
      .getByRole('heading', { name: 'What can I let be simple?' }),
  ).toBeFocused();
  expect(starts).toHaveLength(1);
});

test('activating Tarot again on the question step moves focus to its heading', async ({ page }) => {
  await account(page, '198.51.100.28');
  await enableAi(page);
  await openTarot(page);
  const tarot = page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Tarot', exact: true });
  await tarot.focus();
  await page.keyboard.press('Enter');
  await expect(heading(page, 'What is on your mind?')).toBeFocused();
});

test('a physical spread needs a ready photo before review', async ({ page }) => {
  await account(page, '198.51.100.16');
  await enableAi(page);
  const starts = countStarts(page);
  await toPhotoStep(page, 'What do my own cards say?');
  await expect(step(page, 'Spread')).toHaveAttribute('aria-current', 'step');
  const proceed = page.getByRole('button', { name: 'Review your reading', exact: true });
  await expect(proceed).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Choose photo', exact: true }),
  ).toHaveAccessibleDescription(/does not recognize real cards/);
  await expect(
    page.getByRole('button', { name: 'Back to spread choices', exact: true }),
  ).toBeVisible();

  await page
    .getByLabel('Photo of your spread', { exact: true })
    .setInputFiles({ name: 'my-spread.png', mimeType: 'image/png', buffer: image });
  await expect(proceed).toBeEnabled();
  await expect(
    page.getByRole('status').filter({ hasText: 'Photo attached: my-spread.png.' }),
  ).toBeAttached();
  await expect(page.getByRole('img', { name: 'Uploaded tarot spread preview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove photo', exact: true })).toBeVisible();

  await proceed.click();
  await expect(heading(page, 'Ready when you are.')).toBeFocused();
  await expect(page.getByText('Your spread photo', { exact: true })).toBeVisible();
  await expect(page.getByText('my-spread.png', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Your attached spread' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Before you start' })).toContainText(
    'This simulation does not recognize real cards.',
  );
  await page.getByLabel('Use English for this reading').check();
  await page.getByRole('button', { name: 'Start reading', exact: true }).click();
  await readInterpretation(page);
  expect(starts).toHaveLength(1);
  expect(starts[0]!.spreadPhoto).toBe(dataUrl);
});

test('an app draw instead never sends the chosen photo', async ({ page }) => {
  await account(page, '198.51.100.17');
  await enableAi(page);
  const starts = countStarts(page);
  await toPhotoStep(page, 'Should I keep my own draw?');
  await page
    .getByLabel('Photo of your spread', { exact: true })
    .setInputFiles({ name: 'my-spread.png', mimeType: 'image/png', buffer: image });
  await expect(
    page.getByRole('button', { name: 'Review your reading', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Use an app draw instead', exact: true }).click();
  await expect(heading(page, 'Ready when you are.')).toBeFocused();
  await expect(page.getByText('App draw · Reversed cards: Off', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Your attached spread' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Before you start' })).not.toContainText(
    'does not recognize real cards',
  );
  await page.getByLabel('Use English for this reading').check();
  await page.getByRole('button', { name: 'Start reading', exact: true }).click();
  await readInterpretation(page);
  expect(starts).toHaveLength(1);
  expect(starts[0]).not.toHaveProperty('spreadPhoto');
});

test('a photo still preparing then an app draw sends nothing', async ({ page }) => {
  await holdSlowPhotoReads(page);
  await account(page, '198.51.100.18');
  await enableAi(page);
  const starts = countStarts(page);
  await toPhotoStep(page, 'What if I change my mind?');
  await page
    .getByLabel('Photo of your spread', { exact: true })
    .setInputFiles({ name: 'slow-spread.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByRole('paragraph').filter({ hasText: /^Preparing photo…$/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review your reading', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Use an app draw instead', exact: true }).click();
  await expect(page.getByText('App draw · Reversed cards: Off', { exact: true })).toBeVisible();
  // An app draw does not wait for a photo it will never send.
  await page.getByLabel('Use English for this reading').check();
  const start = page.getByRole('button', { name: 'Start reading', exact: true });
  await expect(start).toBeEnabled();
  await page.evaluate(() =>
    (window as unknown as { releasePhotoReads: () => Promise<void> }).releasePhotoReads(),
  );
  await expect(page.getByRole('img', { name: 'Your attached spread' })).toHaveCount(0);
  await start.click();
  await readInterpretation(page);
  expect(starts).toHaveLength(1);
  expect(starts[0]).not.toHaveProperty('spreadPhoto');
});

/** Saves a reading with a dated revisit note whose text can be quoted as an excerpt. */
async function savedNote(page: Page, ip: string) {
  await account(page, ip);
  await reading(page, 'Synthetic source for a deliberate excerpt');
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  const saved = await savedSnapshot(page);
  const result = await page.request.post('/api/v1/revisits', {
    headers: {
      Origin: new URL(page.url()).origin,
      'X-CSRF-Token': saved.me.csrfToken,
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: {
      editionId: saved.reading.editionId,
      note: `${'x'.repeat(1300)}😀é PRIVATE TAIL`,
      stance: 'disagree',
    },
  });
  expect(result.ok()).toBe(true);
  return saved;
}

/** On the Question step, quotes characters 1301–1303 of the revisit note. */
async function addExcerpt(page: Page, family: string) {
  await page.getByRole('button', { name: 'Choose excerpts', exact: true }).click();
  await page.getByLabel('Saved reading', { exact: true }).selectOption(family);
  await page.getByRole('radio', { name: /Your revisit note/ }).check();
  await page.getByRole('button', { name: 'Allow this source', exact: true }).click();
  await page.getByRole('button', { name: 'Choose part of passage', exact: true }).click();
  await page.getByText('Set first and last characters', { exact: true }).click();
  await page.getByLabel('First character', { exact: true }).fill('1301');
  await page.getByLabel('Last character', { exact: true }).fill('1303');
  await page.getByRole('button', { name: 'Add excerpt', exact: true }).click();
}

async function confirmExcerpts(page: Page) {
  await page.getByRole('button', { name: 'Review selected excerpts' }).click();
  await page.getByLabel('I agree to use these exact excerpts for this reading.').check();
}

const selectedContext = (page: Page) =>
  page
    .locator('.submission-review-section')
    .filter({ has: page.getByRole('heading', { name: 'Selected context', exact: true }) });

test('unconfirmed excerpts block the spread step', async ({ page }) => {
  const saved = await savedNote(page, '198.51.100.19');
  await openTarot(page);
  await page.getByLabel('Your question', { exact: true }).fill('Which change feels workable?');
  await addExcerpt(page, saved.session.id);
  const proceed = page.getByRole('button', { name: 'Choose your spread', exact: true });
  await proceed.click();
  await expect(
    page.getByText('Review and confirm your selected excerpts to continue.', { exact: true }),
  ).toBeVisible();
  await expect(heading(page, 'What is on your mind?')).toBeVisible();
  await confirmExcerpts(page);
  await proceed.click();
  await expect(heading(page, 'One question. Three perspectives.')).toBeFocused();
});

test('confirming the excerpts clears the message that asked for it', async ({ page }) => {
  const saved = await savedNote(page, '198.51.100.30');
  await openTarot(page);
  await page.getByLabel('Your question', { exact: true }).fill('What would make this lighter?');
  await addExcerpt(page, saved.session.id);
  await page.getByRole('button', { name: 'Choose your spread', exact: true }).click();
  const message = page.getByText('Review and confirm your selected excerpts to continue.', {
    exact: true,
  });
  await expect(message).toBeVisible();
  await confirmExcerpts(page);
  await expect(message).toHaveCount(0);
});

test('a start refused for its excerpts returns to the question with focus on its heading', async ({
  page,
}) => {
  const saved = await savedNote(page, '198.51.100.29');
  await openTarot(page);
  const question = page.getByLabel('Your question', { exact: true });
  await question.fill('What is changing underneath?');
  await addExcerpt(page, saved.session.id);
  await confirmExcerpts(page);
  await page.getByRole('button', { name: 'Choose your spread', exact: true }).click();
  await page.getByRole('button', { name: 'Let Reflection draw', exact: true }).click();
  await expect(heading(page, 'Ready when you are.')).toBeFocused();
  await page.route('**/api/v1/requests', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 409,
          json: apiSchemas.ErrorEnvelope.parse({
            error: {
              code: 'CONTEXT_CHANGED',
              message: 'A selected source changed.',
              correlationId: '00000000-0000-4000-8000-000000000216',
              retry: 'never',
              retryAfterSeconds: null,
              currentRevision: null,
            },
          }),
        })
      : route.continue(),
  );
  await startFromReview(page);
  await expect(page.getByText(/Your question is still here\./)).toBeVisible();
  await expect(heading(page, 'What is on your mind?')).toBeFocused();
  await expect(question).toHaveValue('What is changing underneath?');
});

test('review lists exactly the confirmed excerpts', async ({ page }) => {
  const saved = await savedNote(page, '198.51.100.20');
  await openTarot(page);
  await toReview(page, 'What can stay simple?');
  await expect(selectedContext(page)).toContainText(
    'No excerpts selected. No earlier writing will be sent.',
  );
  await page.getByRole('button', { name: 'Edit your question', exact: true }).click();
  await addExcerpt(page, saved.session.id);
  await confirmExcerpts(page);
  await page.getByRole('button', { name: 'Choose your spread', exact: true }).click();
  await page.getByRole('button', { name: 'Let Reflection draw', exact: true }).click();
  await expect(selectedContext(page).locator('blockquote')).toHaveText('😀é');
  await expect(selectedContext(page)).toContainText('Your words');
  await expect(selectedContext(page)).not.toContainText('PRIVATE TAIL');
});

test('editing the question after confirming excerpts needs a new confirmation', async ({
  page,
}) => {
  const saved = await savedNote(page, '198.51.100.21');
  await openTarot(page);
  const question = page.getByLabel('Your question', { exact: true });
  await question.fill('Which change feels workable?');
  await addExcerpt(page, saved.session.id);
  await confirmExcerpts(page);
  await page.getByRole('button', { name: 'Choose your spread', exact: true }).click();
  await page.getByRole('button', { name: 'Let Reflection draw', exact: true }).click();
  await expect(selectedContext(page).locator('blockquote')).toHaveText('😀é');

  await page.getByRole('button', { name: 'Edit your question', exact: true }).click();
  await question.fill('Which change feels workable today?');
  const proceed = page.getByRole('button', { name: 'Choose your spread', exact: true });
  await proceed.click();
  await expect(
    page.getByText('Review and confirm your selected excerpts to continue.', { exact: true }),
  ).toBeVisible();
  await confirmExcerpts(page);
  await proceed.click();
  await page.getByRole('button', { name: 'Let Reflection draw', exact: true }).click();
  await expect(page.locator('.review-question')).toHaveText('Which change feels workable today?');
  await expect(selectedContext(page).locator('blockquote')).toHaveText('😀é');
});

const cardsHeading = (page: Page) => heading(page, 'Take a moment with the spread.');

/**
 * Keeps the next started request in progress until release(). Local synthetic readings
 * publish at once, so its start response is reported as still dispatching and only its own
 * status polls are held; other readings' polls pass through.
 */
async function holdRequest(page: Page) {
  let release!: () => void;
  let arrive!: () => void;
  let requestId: string | null = null;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  await page.route('**/api/v1/requests', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    const started = apiSchemas.StartResponse.parse(await response.json());
    requestId = started.status.requestId;
    await route.fulfill({
      response,
      json: {
        ...started,
        status: {
          ...started.status,
          state: 'dispatching',
          revision: 2,
          editionId: null,
          events: [],
          nextSequence: 2,
        },
      },
    });
  });
  await page.route(/\/api\/v1\/requests\/[0-9a-f-]+\?after=/, async (route) => {
    if (!requestId || !route.request().url().includes(requestId)) return route.continue();
    const response = await route.fetch();
    arrive();
    await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  return { arrived, release: () => release() };
}

test('a new reading shows its three cards before the interpretation', async ({ page }) => {
  await account(page, '198.51.100.22');
  await enableAi(page);
  await openTarot(page);
  await toReview(page, 'What is ready to begin?');
  await startFromReview(page);
  await expect(cardsHeading(page)).toBeFocused();
  await expect(step(page, 'Cards')).toHaveAttribute('aria-current', 'step');
  await expect(page).toHaveURL(/\/requests\//);
  await expect(page.getByTestId('accepted-reading')).toHaveCount(0);
  await expect(page.getByText('What is ready to begin?', { exact: true })).toBeVisible();
  const figures = page.getByRole('figure');
  await expect(figures).toHaveCount(3);
  const captions = await figures.locator('figcaption').allInnerTexts();
  expect(captions.map((caption) => caption.split(':')[0])).toEqual([
    'Situation',
    'Tension',
    'Possibility',
  ]);
  for (const caption of captions)
    expect(caption).toMatch(/^(Situation|Tension|Possibility): .+, (upright|reversed)$/);
  await expect(page.getByRole('figure', { name: captions[0]! })).toBeVisible();
  await expect(
    page.getByRole('complementary', { name: 'Notice before interpreting.', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Read the interpretation', exact: true }).click();
  const accepted = page.getByTestId('accepted-reading');
  await expect(accepted.getByRole('heading', { name: 'What is ready to begin?' })).toBeFocused();
  await expect(cardsHeading(page)).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Reading steps' })).toHaveCount(0);
  await accepted.getByText('Cards, sources and shared context', { exact: true }).click();
  const sources = await accepted.locator('.return-source h3').allInnerTexts();
  for (const caption of captions) {
    const name = caption.slice(caption.indexOf(': ') + 2, caption.lastIndexOf(', '));
    expect(
      sources.some((source) => source.includes(name)),
      name,
    ).toBe(true);
  }
});

test('the three cards keep one row from left to right on phones, and stack below 360 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await account(page, '198.51.100.24');
  await enableAi(page);
  await openTarot(page);
  await toReview(page, 'Where is there room to begin?');
  await startFromReview(page);
  await expect(cardsHeading(page)).toBeFocused();
  const boxes = () =>
    page.getByRole('figure').evaluateAll((figures) =>
      figures.map((figure) => {
        const box = figure.getBoundingClientRect();
        return { x: Math.round(box.x), y: Math.round(box.y) };
      }),
    );
  const row = await boxes();
  expect(
    row.map((box) => box.y),
    'one row at 390 px',
  ).toEqual([row[0]!.y, row[0]!.y, row[0]!.y]);
  expect(row[0]!.x < row[1]!.x && row[1]!.x < row[2]!.x, 'position order left to right').toBe(true);
  await page.setViewportSize({ width: 320, height: 844 });
  const stack = await boxes();
  expect(stack[0]!.y < stack[1]!.y && stack[1]!.y < stack[2]!.y, 'stacked at 320 px').toBe(true);
  expect(
    stack.map((box) => box.x),
    'one column at 320 px',
  ).toEqual([stack[0]!.x, stack[0]!.x, stack[0]!.x]);
});

test('a long unbroken question stays inside the column on review and cards', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await account(page, '198.51.100.31');
  await enableAi(page);
  await openTarot(page);
  await toReview(page, 'x'.repeat(160));
  // Overflowing text makes an element wider inside than its own box.
  const fits = (selector: string) =>
    page.locator(selector).evaluate((node) => node.scrollWidth <= node.clientWidth);
  expect(await fits('.review-question'), 'the question on Review').toBe(true);
  await startFromReview(page);
  await expect(cardsHeading(page)).toBeFocused();
  expect(await fits('.tarot-cards-question'), 'the question on Cards').toBe(true);
});

test('reloading or reopening a reading goes straight to the interpretation', async ({ page }) => {
  await account(page, '198.51.100.23');
  await reading(page, 'What will I come back to?');
  await page.reload();
  await expect(page.getByTestId('accepted-reading')).toBeVisible();
  await expect(cardsHeading(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Journal', exact: true })
    .click();
  await page.getByRole('button', { name: 'What will I come back to?' }).click();
  await expect(page.getByTestId('accepted-reading')).toBeVisible();
  await expect(cardsHeading(page)).toHaveCount(0);
});

test('a follow-up shows neither the steps nor the cards', async ({ page }) => {
  await account(page, '203.0.113.10');
  await reading(page, 'How might I protect a little time for practice?');
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Ask a follow-up', exact: true }).click();
  await page
    .getByLabel('Your follow-up question', { exact: true })
    .fill('What changed after a week?');
  await page.getByLabel('Use English for this reading').check();
  await page.getByRole('button', { name: 'Review follow-up', exact: true }).click();
  const hold = await holdRequest(page);
  await page.getByRole('button', { name: 'Start follow-up', exact: true }).click();
  await hold.arrived;
  await expect(page.getByRole('region', { name: 'Reading request' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Reading steps' })).toHaveCount(0);
  hold.release();
  await expect(
    page
      .getByTestId('accepted-reading')
      .getByRole('heading', { name: 'What changed after a week?' }),
  ).toBeVisible();
  await expect(cardsHeading(page)).toHaveCount(0);
});

test('returning to a reading still in progress shows the cards', async ({ page }) => {
  await account(page, '203.0.113.11');
  await enableAi(page);
  await openTarot(page);
  await toReview(page, 'What is still taking shape?');
  const hold = await holdRequest(page);
  await startFromReview(page);
  await hold.arrived;
  await expect(page.getByRole('region', { name: 'Reading request' })).toBeVisible();
  await expect(step(page, 'Cards')).toHaveAttribute('aria-current', 'step');
  await page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Journal', exact: true })
    .click();
  hold.release();
  await expect(heading(page, 'Your journal')).toBeVisible();
  await page.getByRole('button', { name: 'Resume reading request', exact: true }).click();
  await expect(cardsHeading(page)).toBeFocused();
  await readInterpretation(page);
});

test('coming back from Account to a reading still in progress shows the cards', async ({
  page,
}) => {
  await account(page, '198.51.100.26');
  await enableAi(page);
  await openTarot(page);
  await toReview(page, 'What is still on its way?');
  const hold = await holdRequest(page);
  await startFromReview(page);
  await hold.arrived;
  await openAccount(page);
  await backToReadings(page);
  await expect(page.getByRole('region', { name: 'Reading request' })).toBeVisible();
  hold.release();
  await expect(cardsHeading(page)).toBeFocused();
  await readInterpretation(page);
});

test('cards already shown do not return after a trip to Account', async ({ page }) => {
  await account(page, '198.51.100.27');
  await enableAi(page);
  await openTarot(page);
  await toReview(page, 'What have I already seen?');
  await startFromReview(page);
  await expect(cardsHeading(page)).toBeFocused();
  await openAccount(page);
  await backToReadings(page);
  await expect(page.getByTestId('accepted-reading')).toBeVisible();
  await expect(cardsHeading(page)).toHaveCount(0);
});

// A ruling, not the design's first wording: the reader has not seen these cards yet.
test('a reading that finishes while Account is open still shows its cards on return', async ({
  page,
}) => {
  await account(page, '198.51.100.32');
  await enableAi(page);
  await openTarot(page);
  await toReview(page, 'What finished while I was away?');
  const hold = await holdRequest(page);
  await startFromReview(page);
  await hold.arrived;
  await openAccount(page);
  hold.release();
  await backToReadings(page);
  await expect(cardsHeading(page)).toBeFocused();
  await readInterpretation(page);
});

test('a photo that finishes after an app-draw Start leaves the started question alone', async ({
  page,
}) => {
  await holdSlowPhotoReads(page);
  await account(page, '198.51.100.25');
  await enableAi(page);
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await toPhotoStep(page, 'What will I keep from this week?');
  await page
    .getByLabel('Photo of your spread', { exact: true })
    .setInputFiles({ name: 'slow-spread.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByRole('paragraph').filter({ hasText: /^Preparing photo…$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Use an app draw instead', exact: true }).click();
  const hold = await holdRequest(page);
  await startFromReview(page);
  await hold.arrived;
  // The photo finishes preparing while the reading is still in progress.
  await page.evaluate(() =>
    (window as unknown as { releasePhotoReads: () => Promise<void> }).releasePhotoReads(),
  );
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await openAccount(page);
  expect(dialogs).toEqual([]);
});

test('history navigation to an earlier reading never shows its cards', async ({ page }) => {
  await account(page, '203.0.113.12');
  await reading(page, 'The first saved question');
  await page.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Journal', exact: true })
    .click();
  // Opening from the journal adds a history entry for the first reading.
  await page.getByRole('button', { name: 'The first saved question' }).click();
  const first = page
    .getByTestId('accepted-reading')
    .getByRole('heading', { name: 'The first saved question' });
  await expect(first).toBeVisible();
  await page.goBack();
  await expect(heading(page, 'Your journal')).toBeVisible();
  // A second reading is still drawing in this tab when history moves forward to the first.
  await openTarot(page);
  await toReview(page, 'A second question, still drawing');
  const hold = await holdRequest(page);
  await startFromReview(page);
  await hold.arrived;
  await page.goForward();
  await expect(first).toBeVisible();
  await expect(cardsHeading(page)).toHaveCount(0);
  hold.release();
});
