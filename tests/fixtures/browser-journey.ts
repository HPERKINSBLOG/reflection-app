import { chromium, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { account } from './browser-reading.ts';

export const spreadPhotoPath = fileURLToPath(new URL('./spread-photo.jpg', import.meta.url));
export const longQuestion = (
  'What should I consider as I make room for a different direction, while keeping the commitments that already matter to me? '.repeat(
    4,
  ) + 'A'.repeat(28)
).slice(0, 500);
export const longFilename = `synthetic-spread-${'long-unbroken-filename'.repeat(8)}.jpg`;

/** Firefox/WebKit exercise signed-in UI with a real synthetic session, not mocked APIs.
 * Only Chromium/CDP can provision the virtual passkey; this is not cross-engine WebAuthn proof. */
export async function journeyAccount(
  page: Page,
  browserName: string,
  baseURL: string | undefined,
  ip: string,
) {
  if (browserName === 'chromium' && !baseURL?.startsWith('https:')) return account(page, ip);
  const seed = await chromium.launch();
  try {
    const context = await seed.newContext({
      baseURL: baseURL?.startsWith('https:') ? 'http://localhost:8787' : baseURL!,
    });
    await account(await context.newPage(), ip);
    await page.context().addCookies((await context.storageState()).cookies);
    await page.context().setExtraHTTPHeaders({ 'CF-Connecting-IP': ip });
    await page.goto('/');
    await page.getByRole('link', { name: 'Account', exact: true }).waitFor();
  } finally {
    await seed.close();
  }
}

/** Real calculated Pattern flow; works with AI off and never calls the reading writer. */
export async function patternJourneyStates(
  page: Page,
  capture: (state: string) => Promise<void>,
  signOutAndIn?: () => Promise<void>,
) {
  const navigation = page.getByRole('navigation', { name: 'Reading actions' });
  await expect(navigation.getByRole('button', { name: 'Tarot', exact: true })).toBeDisabled();
  const generated: string[] = [];
  const calculations: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/requests' && request.method() === 'POST') generated.push(path);
    if (path === '/api/v1/astrology/pattern') calculations.push(path);
  });
  const astrology = navigation.getByRole('button', { name: 'Astrology', exact: true });
  await expect(astrology).toBeEnabled();
  await astrology.focus();
  await expect(astrology).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Your birth details', exact: true }),
  ).toBeFocused();
  await page.getByLabel('Birth date', { exact: true }).fill('1992-10-12');
  await page.getByRole('button', { name: 'Enter a place manually', exact: true }).click();
  await page.getByLabel('Place name', { exact: true }).fill('Synthetic Kathmandu');
  await page.getByLabel('Latitude (north positive)', { exact: true }).fill('27.7');
  await page.getByLabel('Longitude (east positive)', { exact: true }).fill('85.3');
  await page.getByLabel('IANA time zone', { exact: true }).fill('Asia/Kathmandu');
  await page.getByLabel('Local birth time', { exact: true }).fill('08:30');
  await capture('pattern-birth');
  await page.getByRole('button', { name: 'Review details', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Does this look right?', exact: true }),
  ).toBeFocused();
  await capture('pattern-review');
  const retention = page.getByLabel('Keep these birth details in my account.', { exact: true });
  await retention.focus();
  await page.keyboard.press('Space');
  await expect(retention).toBeChecked();
  await page.getByRole('button', { name: 'Create my chart', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: 'Choose a chapter', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your pattern', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Connection', exact: true }).focus();
  await page.keyboard.press('Enter');
  const words = 'A small change in how I listen can leave room for both of us.';
  await page.getByLabel('Your reflection', { exact: true }).fill(words);
  await capture('pattern-writing');
  const save = page.getByRole('button', { name: 'Save to journal', exact: true });
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Saved to your journal', exact: true }),
  ).toBeFocused();
  await capture('pattern-confirmation');
  await page.getByRole('button', { name: 'View saved chapter', exact: true }).click();
  await expect(page).toHaveURL(/\/saved\/[0-9a-f-]+\/[0-9a-f-]+$/);
  const savedUrl = page.url();
  const record = page.getByTestId('pattern-reading');
  const original = await record.textContent();
  const question = await record.getByRole('heading', { level: 2 }).textContent();
  await expect(page.locator('.saved-reflection-text')).toHaveText(words);
  await capture('pattern-saved');
  const reopen = async () => {
    await navigation.getByRole('button', { name: 'Journal', exact: true }).click();
    const history = page.getByRole('region', { name: 'Saved reading history', exact: true });
    await history.getByRole('button', { name: 'Astrology', exact: true }).click();
    const entry = history.getByRole('button', { name: question!, exact: true });
    await entry.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(savedUrl);
    await expect(record).toHaveText(original!);
    await expect(page.locator('.saved-reflection-text')).toHaveText(words);
  };
  if (signOutAndIn) {
    await signOutAndIn();
    const count = calculations.length;
    await reopen();
    expect(calculations).toHaveLength(count);
  }
  await navigation.getByRole('button', { name: 'Astrology', exact: true }).click();
  await page.getByRole('button', { name: 'Review birth details', exact: true }).click();
  await page.getByLabel('Birth date', { exact: true }).fill('2002-01-01');
  await page.getByRole('button', { name: 'Review details', exact: true }).click();
  await retention.check();
  await page.getByRole('button', { name: 'Update my chart', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Choose a chapter', exact: true })).toBeVisible();
  const count = calculations.length;
  await reopen();
  await page.getByRole('button', { name: 'Add revisit note', exact: true }).click();
  const note = page.getByLabel('Your revisit note', { exact: true });
  await expect(note).toBeFocused();
  await note.fill('Returning today, I notice that listening is easier when I slow down.');
  await page.getByRole('button', { name: 'Save note', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('Returning today, I notice that listening is easier when I slow down.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(record).toHaveText(original!);
  await capture('pattern-revisited');
  expect(calculations).toHaveLength(count);
  expect(generated).toEqual([]);
  const stored = await page.evaluate(() => [
    ...Object.values(localStorage),
    ...Object.values(sessionStorage),
  ]);
  expect(JSON.stringify(stored)).not.toMatch(/Kathmandu|1992-10-12|small change in how I listen/);
}

export async function themeContrast(page: Page, selector?: string) {
  return page.evaluate((selector): Record<string, number> => {
    const style = getComputedStyle(document.documentElement);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const rgba = (value: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const color = (name: string) => rgba(style.getPropertyValue(name));
    const luminance = (rgba: number[]) => {
      const values = rgba.slice(0, 3).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
    };
    const ratio = (foreground: number[], background: number[]) => {
      const alpha = foreground[3]! / 255;
      const composed = foreground
        .slice(0, 3)
        .map((value, index) => value * alpha + background[index]! * (1 - alpha));
      const a = luminance(composed),
        b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    if (selector) {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Contrast target missing: ${selector}`);
      // Text sits on the nearest painted fill, so composite translucent fills up to an opaque one.
      const fills: number[][] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const fill = rgba(getComputedStyle(node).backgroundColor);
        if (fill[3] === 0) continue;
        fills.push(fill);
        if (fill[3] === 255) break;
      }
      const backdrop = fills.reverse().reduce(
        (under, fill) => {
          const alpha = fill[3]! / 255;
          return [
            ...fill.slice(0, 3).map((value, i) => value * alpha + under[i]! * (1 - alpha)),
            255,
          ];
        },
        rgba(getComputedStyle(document.body).backgroundColor).map((value, i) =>
          i === 3 ? 255 : value,
        ),
      );
      return { selectedText: ratio(rgba(getComputedStyle(element).color), backdrop) };
    }
    // The placeholder token is a color-mix, so let the page resolve it before measuring.
    const probe = document.createElement('span');
    probe.style.color = 'var(--reflection-placeholder)';
    document.body.appendChild(probe);
    const placeholder = rgba(getComputedStyle(probe).color);
    probe.remove();
    return {
      cardText: ratio(color('--card-foreground'), color('--card')),
      linkOnCard: ratio(color('--reflection-link'), color('--card')),
      placeholderOnCard: ratio(placeholder, color('--card')),
      placeholderOnBackground: ratio(placeholder, color('--background')),
      inputOnCard: ratio(color('--input'), color('--card')),
      inputOnBackground: ratio(color('--input'), color('--background')),
      mutedOnCard: ratio(color('--muted-foreground'), color('--card')),
      mutedOnBackground: ratio(color('--muted-foreground'), color('--background')),
      destructiveOnCard: ratio(color('--destructive-text'), color('--card')),
      destructiveOnBackground: ratio(color('--destructive-text'), color('--background')),
      primaryButton: ratio(color('--primary-foreground'), color('--primary')),
      destructiveButton: ratio(color('--destructive-foreground'), color('--destructive-button')),
    };
  }, selector);
}

/**
 * Decorative art must never sit under text or controls. Lists every overlap between an
 * aria-hidden image (clipped by any overflow ancestor) or the shell's leaf band and a line of
 * visible text or a control. The brand mark is part of its own link and is not checked.
 */
export async function artUnderContent(page: Page) {
  return page.evaluate(() => {
    type Box = { left: number; top: number; right: number; bottom: number };
    // checkVisibility also hides content inside a closed <details>, which still reports a box.
    const shown = (element: Element) => {
      if (!element.checkVisibility({ visibilityProperty: true })) return false;
      const style = getComputedStyle(element);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        element.getClientRects().length > 0
      );
    };
    const clipped = (element: Element): Box => {
      const own = element.getBoundingClientRect();
      let box: Box = { left: own.left, top: own.top, right: own.right, bottom: own.bottom };
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (!/hidden|clip/.test(`${style.overflowX} ${style.overflowY}`)) continue;
        const edge = parent.getBoundingClientRect();
        box = {
          left: Math.max(box.left, edge.left),
          top: Math.max(box.top, edge.top),
          right: Math.min(box.right, edge.right),
          bottom: Math.min(box.bottom, edge.bottom),
        };
      }
      return box;
    };
    const art: (Box & { name: string })[] = [
      ...document.querySelectorAll('img[aria-hidden="true"], [aria-hidden="true"] img'),
    ]
      .filter((image) => shown(image) && !image.closest('.brand'))
      .map((image) => ({
        name:
          String(image.className)
            .replace(/\bart\b/, '')
            .trim() || 'image',
        ...clipped(image),
      }));
    const shell = document.querySelector<HTMLElement>('.app-shell');
    const band = shell && getComputedStyle(shell, '::after');
    if (shell && band && band.display !== 'none' && band.backgroundImage !== 'none') {
      const edge = shell.getBoundingClientRect();
      // Computed lengths are in the shell's own CSS pixels, but CSS zoom scales its box.
      const scale = edge.width / shell.offsetWidth || 1;
      const height = Number.parseFloat(band.height) * scale;
      art.push({
        name: 'leaf band',
        left: edge.left,
        right: edge.right,
        top: edge.bottom - height,
        bottom: edge.bottom,
      });
    }
    const content: (Box & { what: string })[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.textContent?.trim() &&
        node.parentElement &&
        shown(node.parentElement) &&
        !node.parentElement.closest('.sr-only, [aria-hidden="true"]')
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const line of range.getClientRects())
        if (line.width && line.height)
          content.push({
            what: `text "${node.textContent!.trim().slice(0, 32)}"`,
            left: line.left,
            top: line.top,
            right: line.right,
            bottom: line.bottom,
          });
    }
    for (const control of document.querySelectorAll(
      'a, button, input, select, textarea, summary',
    )) {
      if (!shown(control) || control.closest('.sr-only')) continue;
      const box = control.getBoundingClientRect();
      if (box.width && box.height)
        content.push({
          what: `${control.tagName.toLowerCase()} "${(control.textContent || control.getAttribute('aria-label') || '').trim().slice(0, 32)}"`,
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
        });
    }
    const overlaps: string[] = [];
    for (const image of art)
      for (const item of content) {
        const width = Math.min(image.right, item.right) - Math.max(image.left, item.left);
        const height = Math.min(image.bottom, item.bottom) - Math.max(image.top, item.top);
        if (width > 0.5 && height > 0.5) overlaps.push(`${image.name} under ${item.what}`);
      }
    return overlaps;
  });
}

/** Complete synthetic note responses with fixed server dates, only at the browser boundary. */
export async function datedNotesFixture(page: Page) {
  const session = await page.request.get('/api/v1/sessions?status=saved').then((r) => r.json());
  const parent = session.items[0];
  const notes = [
    {
      kind: 'revisit.v2',
      id: '00000000-0000-4000-8000-000000000001',
      sessionId: parent.id,
      editionId: parent.latestEditionId,
      revision: 1,
      note: 'Synthetic February thought.',
      stance: 'unspecified',
      createdAt: '2026-02-01T10:00:00.000Z',
      updatedAt: '2026-02-01T10:00:00.000Z',
    },
    {
      kind: 'revisit.v2',
      id: '00000000-0000-4000-8000-000000000002',
      sessionId: parent.id,
      editionId: parent.latestEditionId,
      revision: 1,
      note: 'Synthetic March thought.',
      stance: 'unsure',
      createdAt: '2026-03-02T11:30:00.000Z',
      updatedAt: '2026-03-02T11:30:00.000Z',
    },
  ];
  const generationRequests: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/requests')) generationRequests.push(r.url());
  });
  await page.route('**/api/v1/revisits**', async (route) => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/').at(-1);
    if (request.method() === 'GET')
      return route.fulfill({
        json:
          id === 'revisits' ? { items: notes, nextCursor: null } : notes.find((n) => n.id === id),
      });
    if (request.method() === 'PUT') {
      const note = notes.find((n) => n.id === id)!;
      Object.assign(note, request.postDataJSON(), {
        revision: note.revision + 1,
        updatedAt: '2026-04-03T12:45:00.000Z',
      });
      return route.fulfill({ json: note });
    }
    return route.continue();
  });
  return { notes, generationRequests };
}

/** Every note state uses the real local synthetic server, including a real stale revision. */
export async function noteJourneyStates(page: Page, capture: (state: string) => Promise<void>) {
  const notes = page.getByRole('region', { name: 'Revisit notes', exact: true });
  await expect(notes.getByText('No revisit notes yet.', { exact: true })).toBeVisible();
  await capture('notes-empty');
  await notes.getByRole('button', { name: 'Add revisit note', exact: true }).click();
  const text = page.getByLabel('Your revisit note', { exact: true });
  await expect(text).toBeFocused();
  await text.fill(`Synthetic dated thought.\n\n${'LongUnbrokenAuthoredText'.repeat(50)}`);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Your response (optional)', { exact: true })).toBeFocused();
  await page.getByLabel('Your response (optional)', { exact: true }).selectOption('unsure');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Save note', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(notes.getByRole('status').filter({ hasText: 'Note saved.' })).toBeVisible();
  await expect(notes.getByRole('heading', { level: 3 })).toBeFocused();
  await capture('notes-populated');
  await notes.getByRole('button', { name: 'Edit note', exact: true }).click();
  await text.fill(`Synthetic unsaved later thought. ${'Word'.repeat(200)}`);
  await capture('notes-edit');
  const me = await page.request.get('/api/v1/me').then((r) => r.json());
  const sessions = await page.request.get('/api/v1/sessions?status=saved').then((r) => r.json());
  const list = await page.request
    .get(`/api/v1/revisits?editionId=${sessions.items[0].latestEditionId}`)
    .then((r) => r.json());
  const note = list.items[0];
  const response = await page.request.put(`/api/v1/revisits/${note.id}`, {
    headers: {
      Origin: new URL(page.url()).origin,
      'X-CSRF-Token': me.csrfToken,
      'If-Match': '"1"',
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: { note: 'Synthetic current saved version from another tab.', stance: 'disagree' },
  });
  expect(response.status()).toBe(200);
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(notes.getByText(/saved note changed/)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh saved note', exact: true }).click();
  await expect(notes.getByRole('blockquote')).toContainText('Synthetic current saved version');
  await capture('notes-conflict');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(notes.getByRole('button', { name: 'Edit note', exact: true })).toBeFocused();
  await notes.getByRole('button', { name: 'Refresh notes', exact: true }).click();
  await expect(notes.getByRole('article')).toContainText('Synthetic current saved version');
  await notes.getByRole('button', { name: 'Delete note', exact: true }).click();
  await expect(
    page.getByLabel('Delete this note and all saved versions permanently'),
  ).toBeFocused();
  await page.getByLabel('Delete this note and all saved versions permanently').check();
  await capture('notes-deletion');
  await page.getByRole('button', { name: 'Confirm note deletion', exact: true }).click();
  await expect(notes.getByRole('heading', { name: 'Deletion receipt', exact: true })).toBeVisible();
  await expect(notes.getByRole('button', { name: 'Add revisit note', exact: true })).toBeFocused();
  await capture('notes-receipt');
  await page.getByRole('button', { name: 'Dismiss receipt', exact: true }).click();
  await notes.getByRole('button', { name: 'Add revisit note', exact: true }).click();
  await text.fill('Synthetic dated thought kept for return.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(notes.getByRole('status').filter({ hasText: 'Note saved.' })).toBeVisible();
}

/** Runs on an owned, saved native edition. Use the real local preview, then return to the exact original. */
export async function continuityJourneyStates(
  page: Page,
  capture: (state: string) => Promise<void>,
) {
  const original = page.getByTestId('accepted-reading').getByRole('heading', { level: 2 });
  const parentQuestion = await original.textContent();
  const follow = page.getByRole('link', { name: 'Ask a follow-up', exact: true });
  const target = await follow.getAttribute('href');
  if (!target) throw new Error('Missing saved parent link');
  await follow.focus();
  await expect(follow).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Ask a follow-up', exact: true })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'No new draw', exact: true })).toBeVisible();
  const question = 'What changed since I tried putting the first idea into practice?';
  await page.getByLabel('Your follow-up question', { exact: true }).fill(question);
  await page.getByLabel('Use English for this reading').check();
  await expect(page.getByText('No excerpts selected.', { exact: true })).toBeVisible();
  await capture('follow-up-compose');
  await page.getByRole('button', { name: 'Choose excerpts', exact: true }).click();
  const chooser = page.getByRole('region', { name: 'Selected context', exact: true });
  await expect(chooser.getByRole('heading', { name: parentQuestion!, exact: true })).toBeVisible();
  await chooser.getByRole('radio', { name: /Your saved question/ }).check();
  await page.getByRole('button', { name: 'Allow this source', exact: true }).click();
  await page.getByRole('button', { name: 'Use whole passage', exact: true }).click();
  await page.getByRole('button', { name: 'Review selected excerpts', exact: true }).click();
  const review = page.getByRole('region', { name: 'Review selected excerpts' });
  await expect(review.getByRole('heading')).toBeFocused();
  await expect(review.getByRole('blockquote')).toHaveText(parentQuestion!);
  const check = review.getByRole('checkbox');
  await check.focus();
  await expect(check).toBeFocused();
  await page.keyboard.press('Space');
  await expect(check).toBeChecked();
  await capture('selected-context-review');
  await page.getByRole('button', { name: 'Review follow-up', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Review follow-up', exact: true })).toContainText(
    question,
  );
  const submit = page.getByRole('button', { name: 'Start follow-up', exact: true });
  await expect(submit).toBeEnabled();
  await submit.focus();
  await expect(submit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByTestId('accepted-reading').getByRole('heading', { name: question, exact: true }),
  ).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Edition history' })).toBeVisible();
  await capture('follow-up-accepted');
  await page.getByText('Parent and original reading', { exact: true }).click();
  await page.getByRole('link', { name: 'Open parent edition', exact: true }).click();
  await expect(original).toHaveText(parentQuestion!);
}

/** Review only in memory. No encrypted intake batch or imported journal records are created. */
export async function importReviewState(page: Page, capture: (state: string) => Promise<void>) {
  const opener = page.getByRole('button', { name: 'Import records', exact: true });
  await opener.click();
  await expect(
    page.getByRole('heading', { name: 'Review your import', exact: true }),
  ).toBeVisible();
  await page.getByLabel('File format').selectOption('tarot-json');
  await page
    .getByLabel('Import file', { exact: true })
    .setInputFiles(fileURLToPath(new URL('./imports/tarot-nested.json', import.meta.url)));
  await page.getByRole('button', { name: 'Read file', exact: true }).click();
  const rows = page.getByRole('group', { name: 'Records in the file' });
  const items = rows.getByRole('checkbox');
  await expect(items).toHaveCount(4);
  const chosen = items.first();
  await expect(chosen).not.toBeChecked();
  await chosen.focus();
  await expect(chosen).toBeFocused();
  await page.keyboard.press('Space');
  await expect(chosen).toBeChecked();
  await expect(items.nth(1)).not.toBeChecked();
  await capture('import-review');
  await page.getByRole('button', { name: 'Close import', exact: true }).click();
  await expect(opener).toBeFocused();
  expect(
    await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).length,
      caches: (await caches.keys()).length,
    })),
  ).toEqual({ local: 0, session: 0, databases: 0, caches: 0 });
}
