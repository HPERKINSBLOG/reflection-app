import { mkdir, readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { account, enableAi, openAccount } from '../fixtures/browser-reading.ts';
import { patternRequest, patternBirth } from '../fixtures/browser-pattern.ts';

async function manualBirth(
  page: Page,
  certainty = 'Exact',
  date = '1992-10-12',
  zone = 'Asia/Kathmandu',
) {
  await page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Astrology', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your birth details', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Birth date', { exact: true }).fill(date);
  await page.getByRole('button', { name: 'Enter a place manually', exact: true }).click();
  await page.getByLabel('Place name', { exact: true }).fill('Synthetic birthplace');
  await page.getByLabel('Latitude (north positive)', { exact: true }).fill('27.7');
  await page.getByLabel('Longitude (east positive)', { exact: true }).fill('85.3');
  await page.getByLabel('IANA time zone', { exact: true }).fill(zone);
  await page.getByRole('button', { name: certainty, exact: true }).click();
  if (certainty === 'Exact')
    await page.getByLabel('Local birth time', { exact: true }).fill('08:30');
  if (certainty === 'Approximate') {
    await page.getByLabel('Earliest local time', { exact: true }).fill('08:00');
    await page.getByLabel('Latest local time', { exact: true }).fill('10:00');
  }
}
async function createChart(page: Page) {
  await page.getByRole('button', { name: 'Review details', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Does this look right?', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Keep these birth details in my account.', { exact: true }).check();
  await page.getByRole('button', { name: 'Create my chart', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your pattern', exact: true })).toBeVisible();
}
test('exact setup, chapter choice, lost save response and journal return keep the full reflection', async ({
  page,
}) => {
  await account(page, '192.0.2.225');
  await manualBirth(page);
  await page.getByLabel('Local birth time', { exact: true }).fill('08:30:15');
  await createChart(page);
  expect(await patternRequest(page, '/profile')).toMatchObject({
    profile: { birth: { time: { certainty: 'exact', localTime: '08:30:15' } } },
  });
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await page
    .getByLabel('Your reflection', { exact: true })
    .fill('I can make room for my own pace.');
  let lost = false;
  const keys: string[] = [];
  await page.route('**/api/v1/astrology/pattern/saves', async (route) => {
    keys.push(route.request().headers()['idempotency-key']!);
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Save to journal', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('draft');
  await expect(page.getByLabel('Your reflection', { exact: true })).toHaveValue(
    'I can make room for my own pace.',
  );
  await page.getByRole('button', { name: 'Save to journal', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Saved to your journal', exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.getByRole('button', { name: 'View saved chapter', exact: true }).click();
  await expect(page.getByTestId('pattern-reading')).toBeVisible();
  await expect(page.locator('.saved-reflection-text')).toHaveText(
    'I can make room for my own pace.',
  );
});

for (const certainty of ['Approximate', 'Unknown'])
  test(`${certainty} setup saves the actual interval and supports a chapter-only save`, async ({
    page,
  }) => {
    await account(page, certainty === 'Unknown' ? '192.0.2.227' : '192.0.2.226');
    await manualBirth(page, certainty);
    if (certainty === 'Approximate') {
      await page.getByLabel('Earliest local time', { exact: true }).fill('08:00:15');
      await page.getByLabel('Latest local time', { exact: true }).fill('10:00:45');
    }
    await createChart(page);
    const profile = (await patternRequest(page, '/profile')) as {
      profile: { birth: { time: { certainty: string } }; resolved: { kind: string } };
    };
    expect(profile.profile.birth.time.certainty).toBe(certainty.toLowerCase());
    if (certainty === 'Approximate')
      expect(profile.profile.birth.time).toMatchObject({
        earliestLocalTime: '08:00:15',
        latestLocalTime: '10:00:45',
      });
    expect(profile.profile.resolved.kind).toBe('intervals');
    await page.getByRole('button', { name: 'Save to journal', exact: true }).click();
    await page.getByRole('button', { name: 'View saved chapter', exact: true }).click();
    await expect(page.getByTestId('pattern-reading')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add reflection', exact: true })).toBeVisible();
  });

test('place disambiguation, skipped clocks and repeated clocks require explicit review', async ({
  page,
}) => {
  await account(page, '192.0.2.228');
  await page
    .getByRole('navigation', { name: 'Reading actions' })
    .getByRole('button', { name: 'Astrology', exact: true })
    .click();
  await page.getByLabel('Birth date', { exact: true }).fill('2024-03-10');
  await page.getByLabel('Find your birthplace', { exact: true }).fill('Portland');
  await page.getByRole('button', { name: 'Search places', exact: true }).click();
  const results = page.getByRole('region', { name: 'Birthplace results' });
  await expect(results.getByRole('button').first()).toBeVisible();
  expect(await results.getByRole('button').count()).toBeGreaterThan(1);
  await results.getByRole('button', { name: /Portland, Oregon/ }).click();
  await page.getByLabel('Local birth time', { exact: true }).fill('02:30');
  await page.getByRole('button', { name: 'Review details', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/clock|time/i);
  expect(((await patternRequest(page, '/profile')) as { profile: unknown }).profile).toBeNull();
  await page.getByLabel('Birth date', { exact: true }).fill('2024-11-03');
  await page.getByLabel('Local birth time', { exact: true }).fill('01:30');
  await page.getByRole('button', { name: 'Review details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'This time happened twice' })).toBeVisible();
  await page.getByRole('button', { name: /Later occurrence/ }).click();
  await page.getByLabel('Keep these birth details in my account.', { exact: true }).check();
  await page.getByRole('button', { name: 'Create my chart', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your pattern', exact: true })).toBeVisible();
  const profile = (await patternRequest(page, '/profile')) as {
    profile: { resolved: { fold: string; offsetSeconds: number } };
  };
  expect(profile.profile.resolved).toMatchObject({ fold: 'later', offsetSeconds: -28800 });
});

test('an unsupported chapter has no fabricated fact or save action', async ({ page }) => {
  await account(page, '192.0.2.229');
  await manualBirth(page, 'Unknown', '2024-03-20', 'UTC');
  await createChart(page);
  await expect(
    page.getByRole('heading', { name: 'This chapter needs more certainty.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save to journal', exact: true })).toHaveCount(0);
  await mkdir('artifacts/your-pattern', { recursive: true });
  await page.screenshot({ path: 'artifacts/your-pattern/unsupported-chapter.png', fullPage: true });
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to journal', exact: true })).toBeEnabled();
});

test('stale previews keep writing and duplicate saves open explicit reflection reconciliation', async ({
  page,
}) => {
  await account(page, '192.0.2.230');
  await manualBirth(page);
  await createChart(page);
  await page
    .getByLabel('Your reflection', { exact: true })
    .fill('Keep my words through a chart update.');
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
  await page.getByRole('button', { name: 'Save to journal', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed');
  await page.getByRole('button', { name: 'Refresh chart and keep draft', exact: true }).click();
  await expect(page.getByLabel('Your reflection', { exact: true })).toHaveValue(
    'Keep my words through a chart update.',
  );
  await page.getByRole('button', { name: 'Save to journal', exact: true }).click();
  await page.getByRole('button', { name: 'Keep exploring', exact: true }).click();
  await page.getByLabel('Your reflection', { exact: true }).fill('A second draft needs a choice.');
  await page.getByRole('button', { name: 'Save to journal', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('has not been saved');
  await page
    .getByRole('button', { name: 'Review saved chapter with my draft', exact: true })
    .click();
  await expect(page.getByLabel('Your reflection', { exact: true })).toHaveValue(
    'A second draft needs a choice.',
  );
  await expect(page.getByRole('button', { name: 'Save reflection', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep my draft for the next save', exact: true }).click();
  await page.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(page.locator('.saved-reflection-text')).toHaveText('A second draft needs a choice.');
});

test('unsaved writing blocks navigation and tarot receives only the selected question', async ({
  page,
}) => {
  await account(page, '192.0.2.231');
  await enableAi(page);
  await manualBirth(page);
  await createChart(page);
  await page.getByLabel('Your reflection', { exact: true }).fill('Private unsaved words.');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  await expect(page.getByLabel('Your reflection', { exact: true })).toHaveValue(
    'Private unsaved words.',
  );
  await page.getByLabel('Your reflection', { exact: true }).fill('');
  const prompt = await page.locator('.pattern-writing h3').innerText();
  await page.getByRole('button', { name: 'Explore with tarot', exact: true }).click();
  await expect(page.getByLabel('Your question', { exact: true })).toHaveValue(prompt);
  const requests: unknown[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/requests'))
      requests.push(req.postDataJSON());
  });
  await page.getByLabel('Use English for this reading').check();
  await page.getByRole('button', { name: 'Start reading', exact: true }).click();
  await expect(page.getByTestId('accepted-reading')).toBeVisible();
  expect(requests).toHaveLength(1);
  const wire = JSON.stringify(requests);
  expect(wire).toContain(prompt);
  expect(wire).not.toMatch(
    /1992-10-12|Kathmandu|Private unsaved words|semanticHash|pattern.chapter/,
  );
  const stored = await page.evaluate(() => ({
    local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(stored)).not.toMatch(/1992-10-12|Kathmandu|Private unsaved words/);
});

test('Paper and Evening birth, review, chapter and saved layouts fit every target width', async ({
  page,
}) => {
  await account(page, '192.0.2.232');
  await manualBirth(page, 'Approximate');
  const capture = async (state: string) => {
    await mkdir('artifacts/your-pattern', { recursive: true });
    for (const theme of ['paper', 'evening'])
      for (const width of [320, 390, 768, 1280]) {
        await page.getByLabel('Color theme').selectOption(theme);
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${state} ${theme} ${width}`,
        ).toBe(true);
        await page.screenshot({
          path: `artifacts/your-pattern/${state}-${theme}-${width}.png`,
          fullPage: true,
        });
      }
  };
  await capture('birth');
  await page.getByRole('button', { name: 'Review details', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Does this look right?', exact: true }),
  ).toBeFocused();
  await capture('review');
  await page.getByLabel('Keep these birth details in my account.', { exact: true }).check();
  await page.getByRole('button', { name: 'Create my chart', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Choose a chapter', exact: true })).toBeVisible();
  await capture('pattern');
  await page
    .getByLabel('Your reflection', { exact: true })
    .fill('A little room for a different pace.');
  await page.getByRole('button', { name: 'Save to journal', exact: true }).click();
  await page.getByRole('button', { name: 'View saved chapter', exact: true }).click();
  await expect(page.getByTestId('pattern-reading')).toBeVisible();
  await capture('saved');
});

test('profile restoration is explicit and removing the current profile preserves saved chapters', async ({
  page,
}) => {
  await account(page, '192.0.2.233');
  await manualBirth(page);
  await createChart(page);
  await page.getByRole('button', { name: 'Save to journal', exact: true }).click();
  await page.getByRole('button', { name: 'View saved chapter', exact: true }).click();
  await expect(page).toHaveURL(/\/saved\/[0-9a-f-]+\/[0-9a-f-]+$/);
  const savedPath = new URL(page.url()).pathname;
  await openAccount(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my records', exact: true }).click();
  const file = await readFile((await (await download).path())!);
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
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  await page.getByLabel('File format').selectOption('reflection-export.v2');
  await page
    .getByLabel('Import file', { exact: true })
    .setInputFiles({ name: 'pattern.ndjson', mimeType: 'application/x-ndjson', buffer: file });
  await page.getByRole('button', { name: 'Read file', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Birth profile in this file' })).toBeVisible();
  expect(((await patternRequest(page, '/profile')) as { revision: number }).revision).toBe(2);
  await page
    .getByRole('button', { name: 'Review birth profile for restoration', exact: true })
    .click();
  await expect(page.getByLabel('Birth date', { exact: true })).toHaveValue('1992-10-12');
  await page.getByRole('button', { name: 'Review details', exact: true }).click();
  await page.getByLabel('Keep these birth details in my account.', { exact: true }).check();
  await page.getByRole('button', { name: 'Update my chart', exact: true }).click();
  await page.getByRole('button', { name: 'Review birth details', exact: true }).click();
  await page.getByText('Remove current birth details', { exact: true }).click();
  await page.getByLabel('Remove my current birth profile.', { exact: true }).check();
  await page.getByRole('button', { name: 'Remove birth profile', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Birth profile removal', exact: true }),
  ).toBeVisible();
  expect(((await patternRequest(page, '/profile')) as { profile: unknown }).profile).toBeNull();
  await page.goto(savedPath);
  await expect(page.getByTestId('pattern-reading')).toBeVisible();
  await page.getByText('Explore chart details', { exact: true }).click();
  await expect(page.getByText(/Birth profile version 1/)).toBeVisible();
});

test('a chart refresh that suppresses a chapter keeps its unsaved writing visible', async ({
  page,
}) => {
  await account(page, '192.0.2.236');
  await manualBirth(page);
  await createChart(page);
  const words = 'Keep these words even when my chart becomes less certain.';
  await page.getByLabel('Your reflection', { exact: true }).fill(words);
  await patternRequest(
    page,
    '/profile',
    {
      birth: {
        ...patternBirth,
        date: '2024-03-20',
        place: { ...patternBirth.place, zone: 'UTC' },
        time: { certainty: 'unknown' },
      },
      expectedRevision: 1,
      confirmedRetention: true,
    },
    'PUT',
  );
  await page.getByRole('button', { name: 'Save to journal', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh chart and keep draft', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'This chapter needs more certainty.', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Your reflection', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your reflection', { exact: true })).toHaveValue(words);
  await expect(page.getByRole('button', { name: 'Save to journal', exact: true })).toHaveCount(0);
});
