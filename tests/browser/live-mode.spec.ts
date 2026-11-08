import { expect, test } from '@playwright/test';
import {
  account,
  authenticator,
  backToReadings,
  enableAi,
  keepKit,
  openAccount,
  openSignIn,
  reading,
} from '../fixtures/browser-reading.ts';

for (const [index, mode, patternReady] of [
  [0, 'live-preview', undefined],
  [1, 'live-preview', false],
  [2, 'live-preview', true],
  [3, 'production', true],
] as const) {
  test(`Pattern readiness requires an explicit development-preview capability: ${mode}/${patternReady}`, async ({
    page,
  }) => {
    await account(page, `192.0.2.${210 + index}`);
    await page.route('**/health', (route) =>
      route.fulfill({ json: { mode, provider: 'openai', patternReady } }),
    );
    await page.goto('/astrology/pattern');
    if (mode === 'live-preview' && patternReady) {
      await expect(
        page.getByRole('heading', { name: 'Your birth details', exact: true }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByText(/Your Pattern is not available in this environment yet/),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Your birth details', exact: true }),
      ).toHaveCount(0);
    }
  });
}

test('retrying the reading connection keeps the question and photo in the open form', async ({
  page,
}) => {
  await account(page, '198.51.100.86');
  await enableAi(page);
  await page.route('**/health', (route) => route.abort());
  await page.goto('/new');
  const question = page.getByLabel('Your question', { exact: true });
  await question.fill('How could I make time for a walk?');
  await page.getByRole('button', { name: 'Choose your spread', exact: true }).click();
  await page.getByRole('button', { name: 'Use my physical spread', exact: true }).click();
  await page
    .getByLabel('Photo of your spread', { exact: true })
    .setInputFiles('tests/fixtures/spread-photo.jpg');
  const preview = page.getByRole('img', { name: 'Uploaded tarot spread preview' });
  await expect(preview).toBeVisible();
  const source = await preview.getAttribute('src');
  await page.getByRole('button', { name: 'Review your reading', exact: true }).click();
  await page.getByLabel('Use English for this reading').check();
  const photo = page.getByRole('img', { name: 'Your attached spread' });
  const start = page.getByRole('button', { name: 'Start reading', exact: true });
  const retry = page.getByRole('button', { name: 'Check connection again', exact: true });
  await expect(start).toBeDisabled();
  await expect(retry).toBeVisible();
  await page.unroute('**/health');
  await retry.click();
  await expect(start).toBeEnabled();
  await expect(question).toHaveValue('How could I make time for a walk?');
  await expect(photo).toHaveAttribute('src', source!);
  await expect(retry).toHaveCount(0);
});

test('failed runtime discovery never describes a possible live call as simulation', async ({
  page,
}) => {
  await page.context().setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.201' });
  await page.route('**/health', (route) => route.abort());
  await authenticator(page);
  await page.goto('/');
  await expect(page.getByText(/never contacts an AI provider|local simulated writer/)).toHaveCount(
    0,
  );
  await openSignIn(page);
  await expect(page.getByText(/never contacts an AI provider|local simulated writer/)).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Create an account with a passkey', exact: true }).click();
  await keepKit(page);
  await expect(page.getByRole('button', { name: 'Journal', exact: true })).toBeEnabled();
  await expect(
    page
      .getByRole('navigation', { name: 'Reading actions' })
      .getByRole('button', { name: 'Tarot', exact: true }),
  ).toBeDisabled();
  await openAccount(page);
  await expect(
    page.getByRole('button', { name: 'Enable AI readings', exact: true }),
  ).toBeDisabled();
});

for (const mode of ['live-local', 'live-preview', 'production'] as const) {
  test(`${mode} makes provider disclosure clear before enabling AI or submitting a question`, async ({
    page,
  }) => {
    await page.context().setExtraHTTPHeaders({
      'CF-Connecting-IP': mode === 'live-local' ? '192.0.2.202' : '192.0.2.203',
    });
    await page.route('**/health', (route) =>
      route.fulfill({ json: { mode, provider: 'openai', generationReady: true } }),
    );
    await authenticator(page);
    await page.goto('/');
    const environment = {
      'live-local': 'This development app sends new readings to a live AI provider.',
      'live-preview': 'This hosted preview sends new readings to a live AI provider.',
      production: 'New readings can be sent to a live AI provider.',
    }[mode];
    await expect(page.getByText(environment, { exact: true })).toBeVisible();
    await openSignIn(page);
    await expect(page.getByText(environment, { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: 'Create an account with a passkey', exact: true })
      .click();
    await keepKit(page);
    await openAccount(page);
    await expect(
      page.getByText(/Your question, cards and selected source meanings are sent to OpenAI/),
    ).toBeVisible();
    await expect(
      page.getByText(/Any spread photo you attach is sent to Meta for recognition/),
    ).toBeVisible();
    await expect(page.getByText(/OpenAI and Meta may retain request data/)).toBeVisible();
    await expect(
      page.getByText(/never contacts an AI provider|local simulated writer/),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Enable AI readings', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'AI readings are on', exact: true }),
    ).toBeVisible();
    await backToReadings(page);
    await page
      .getByRole('navigation', { name: 'Reading actions' })
      .getByRole('button', { name: 'Tarot', exact: true })
      .click();
    await page.getByLabel('Your question', { exact: true }).fill('Where could I begin?');
    await page.getByRole('button', { name: 'Choose your spread', exact: true }).click();
    await page.getByRole('button', { name: 'Use my physical spread', exact: true }).click();
    await expect(page.getByText(/sends your attached photo to Meta/)).toBeVisible();
    await expect(page.getByText(/zero retention is not guaranteed/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Choose photo', exact: true }),
    ).toHaveAccessibleDescription(
      /sends your attached photo to Meta.*zero retention is not guaranteed/,
    );
    await page.getByLabel('Photo of your spread', { exact: true }).setInputFiles({
      name: 'spread.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await page.getByRole('button', { name: 'Review your reading', exact: true }).click();
    const preflight = page.getByRole('complementary', { name: 'Before you start' });
    await expect(preflight).toContainText('Starting a reading sends this question to OpenAI');
    await expect(preflight).toContainText('sends your attached photo to Meta');
    await expect(preflight).toContainText('zero retention is not guaranteed');
    await expect(
      page.getByText(/Your attached photo is sent to Meta to recognize the cards/),
    ).toHaveCount(0);
    await expect(preflight.getByText(/sends your attached photo to Meta/)).toHaveCount(1);
  });
}

test('explicit hosted synthetic readiness retains simulation disclosure', async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.243' });
  await page.route('**/health', (route) =>
    route.fulfill({ json: { mode: 'hosted-synthetic', generationReady: true } }),
  );
  await authenticator(page);
  await page.goto('/');
  await expect(
    page.getByText(
      'This hosted preview simulates readings and does not contact an AI provider. Use test accounts and synthetic text only.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/local build|local simulation/)).toHaveCount(0);
  await openSignIn(page);
  await expect(
    page.getByText(
      'This hosted preview simulates readings and does not contact an AI provider. Use test accounts and synthetic text only.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/local build|local simulation/)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Create a test account with a passkey', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Create a test account with a passkey', exact: true })
    .click();
  await keepKit(page);
  await enableAi(page);
  await page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Tarot', exact: true })
    .click();
  await page.getByLabel('Your question', { exact: true }).fill('Where could I begin?');
  await page.getByRole('button', { name: 'Choose your spread', exact: true }).click();
  await page.getByRole('button', { name: 'Let Reflection draw', exact: true }).click();
  const preflight = page.getByRole('complementary', { name: 'Before you start' });
  await expect(preflight).toContainText('Use synthetic text only.');
  await expect(preflight).toContainText('does not contact an AI provider');
});

test('unavailable hosted synthetic generation retains its environment without enabling readings', async ({
  page,
}) => {
  await page.context().setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.244' });
  await page.route('**/health', (route) =>
    route.fulfill({ json: { mode: 'hosted-synthetic', generationReady: false } }),
  );
  await authenticator(page);
  await page.goto('/');
  const environment = page.getByText(/^This hosted preview/);
  await expect(environment).toContainText('Use test accounts and synthetic text only.');
  await expect(environment).toContainText('Saved readings remain available.');
  await openSignIn(page);
  await expect(environment).toContainText('Saved readings remain available.');
  await page.getByRole('link', { name: 'Recover with your saved kit', exact: true }).click();
  await expect(environment).toBeVisible();
  await page.getByRole('link', { name: 'Back to sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Create an account with a passkey', exact: true }).click();
  await expect(environment).toBeVisible();
  await keepKit(page);
  await expect(page.getByRole('button', { name: 'Journal', exact: true })).toBeEnabled();
  await expect(
    page
      .getByRole('navigation', { name: 'Reading actions' })
      .getByRole('button', { name: 'Tarot', exact: true }),
  ).toBeDisabled();
  await openAccount(page);
  await expect(
    page.getByRole('button', { name: 'Enable AI readings', exact: true }),
  ).toBeDisabled();
});

for (const discovery of ['pending', 'failed'] as const) {
  test(`saved simulation attribution stays neutral while runtime discovery is ${discovery}`, async ({
    page,
  }) => {
    await page.route('**/health', (route) =>
      route.fulfill({ json: { mode: 'hosted-synthetic', generationReady: true } }),
    );
    await account(page, discovery === 'pending' ? '192.0.2.245' : '192.0.2.246');
    const question = 'Synthetic saved reading attribution';
    await reading(page, question);
    await page.getByRole('button', { name: 'Save reading', exact: true }).click();
    await expect(page.getByText('Saved until you delete it.', { exact: true })).toBeVisible();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/health', async (route) => {
      if (discovery === 'failed') return route.abort();
      await pending;
      await route.fulfill({ json: { mode: 'hosted-synthetic', generationReady: true } });
    });
    try {
      await page.goto('/');
      await page.getByRole('button', { name: question, exact: true }).click();
      await expect(page.getByText('Simulated interpretation', { exact: true })).toBeVisible();
      await page.getByText('Cards, sources and shared context', { exact: true }).click();
      await expect(page.getByText(/Generated by a simulation\./)).toBeVisible();
      await expect(
        page.getByText(/Local simulated interpretation|Generated by the local simulation/),
      ).toHaveCount(0);
      if (discovery === 'pending') {
        release();
        await expect(page.getByText(/Generated by the hosted simulation\./)).toBeVisible();
      }
    } finally {
      release();
    }
  });
}
