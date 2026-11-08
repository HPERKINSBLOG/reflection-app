import { expect, type Locator, type Page, test } from '@playwright/test';
import { artUnderContent, themeContrast } from '../fixtures/browser-journey.ts';
import { account, openSignIn } from '../fixtures/browser-reading.ts';

const localNotice =
  'This local simulation does not contact an AI provider. Use test accounts and synthetic text only.';
const welcomeHeading = (page: Page) =>
  page.getByRole('heading', { name: 'A little space to reflect.', exact: true });
const signInHeading = (page: Page) =>
  page.getByRole('heading', { name: 'Sign in or create an account', exact: true });
const headerSignIn = (page: Page) =>
  page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true });

/** The words on each rendered line of an element's text, top to bottom. */
const wordLines = (part: Locator) =>
  part.evaluate((element) => {
    const lines = new Map<number, string[]>();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      for (const word of node.textContent!.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, word.index!);
        range.setEnd(node, word.index! + word[0].length);
        const top = Math.round(range.getBoundingClientRect().top);
        lines.set(top, [...(lines.get(top) ?? []), word[0]]);
      }
    return [...lines].sort(([a], [b]) => a - b).map(([, words]) => words.join(' '));
  });

test('the welcome page invites a first reading with two actions, three positions and the runtime notice', async ({
  page,
}) => {
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));
  await page.goto('/');
  const headline = welcomeHeading(page);
  const lead = page.getByText('Bring a question. Make room for another perspective.', {
    exact: true,
  });
  const draw = page.getByRole('link', { name: 'Draw three cards', exact: true });
  const returning = page.getByRole('link', { name: 'I have an account', exact: true });
  const positions = page.getByRole('list', { name: 'Reflection positions' });
  const closing = page.getByText(
    'Reflection, not prediction. Save what’s useful, write what it means to you, and return with time.',
    { exact: true },
  );
  const notice = page.getByText(localNotice, { exact: true });
  await expect(headline).toBeVisible();
  await expect(draw).toHaveAttribute('href', '/sign-in?start=new');
  await expect(returning).toHaveAttribute('href', '/sign-in');
  await expect(positions.getByRole('listitem')).toHaveText([
    /^1\s*Situation\s*What’s here now$/,
    /^2\s*Tension\s*What pulls against it$/,
    /^3\s*Possibility\s*What could open up$/,
  ]);
  await expect(page.getByRole('heading', { name: 'Reflection positions', level: 2 })).toBeVisible();
  await expect(closing).toBeVisible();
  await expect(notice).toBeVisible();
  // The page reads in this order: headline, lead, actions, positions, closing line, notice.
  const tops = [];
  for (const part of [headline, lead, draw, positions, closing, notice])
    tops.push((await part.boundingBox())!.y);
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  // The actions are inline pills, side by side, not full-width buttons.
  const [first, second] = [(await draw.boundingBox())!, (await returning.boundingBox())!];
  expect(Math.abs(first.y - second.y)).toBeLessThan(1);
  expect(first.x + first.width).toBeLessThan(second.x);
  expect(first.width).toBeLessThan(260);
  expect(first.height).toBeGreaterThanOrEqual(48);
  await expect(draw).toHaveCSS('border-radius', '9999px');
  // Sign-in controls live on /sign-in.
  await expect(
    page.getByRole('button', { name: /^Sign in with a (password|passkey)$/ }),
  ).toHaveCount(0);
  // Decorative art stays decorative and behind the words.
  await expect(page.locator('main img')).toHaveCount(4);
  for (const image of await page.locator('main img').all()) {
    await expect(image).toHaveAttribute('alt', '');
    await expect(image).toHaveAttribute('aria-hidden', 'true');
    await expect(image).toHaveCSS('position', 'absolute');
    await expect(image).toHaveCSS('pointer-events', 'none');
  }
  for (const width of [320, 390, 640, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${width}px horizontal overflow`,
    ).toBe(true);
    expect(await artUnderContent(page), `${width}px art under content`).toEqual([]);
  }
  expect(faults).toEqual([]);
});

test('from 768 px the rose runs behind the header to the top edge; below that it starts under the header', async ({
  page,
}) => {
  await page.goto('/');
  await expect(welcomeHeading(page)).toBeVisible();
  const header = page.locator('.site-header');
  const hidden = 'rgba(0, 0, 0, 0)';
  for (const width of [320, 390, 640, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const [rose, welcome, wordmark] = [
        box('.landing-rose'),
        box('main.invitation'),
        box('.brand'),
      ];
      // The welcome page clips the rose, so it paints from the lower of the two tops.
      const top = Math.max(rose.top, welcome.top);
      return {
        top,
        headerBottom: box('.site-header').bottom,
        underWordmark:
          rose.left < wordmark.right &&
          rose.right > wordmark.left &&
          top < wordmark.bottom &&
          rose.bottom > wordmark.top,
      };
    });
    expect(layout.underWordmark, `${width}px rose under the wordmark`).toBe(false);
    if (width >= 768) {
      expect(layout.top, `${width}px rose top`).toBeLessThanOrEqual(0);
      await expect(header, `${width}px header rule`).toHaveCSS('border-bottom-color', hidden);
    } else {
      expect(layout.top, `${width}px rose top`).toBeGreaterThanOrEqual(layout.headerBottom - 0.5);
      await expect(header, `${width}px header rule`).not.toHaveCSS('border-bottom-color', hidden);
    }
  }
  // Only the welcome page drops the rule.
  for (const path of ['/sign-in', '/recover']) {
    await page.goto(path);
    await expect(header, path).not.toHaveCSS('border-bottom-color', hidden);
  }
});

test('art sits under a header control only where the control paints an opaque page fill', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(welcomeHeading(page)).toBeVisible();
  const select = page.getByLabel('Color theme');
  const signIn = headerSignIn(page);
  for (const [theme, fill] of [
    ['paper', 'rgb(247, 243, 232)'],
    ['evening', 'rgb(8, 47, 51)'],
  ] as const) {
    await select.selectOption(theme);
    // The theme select and the sign-in link paint the page color, Paper or Evening, fully opaque.
    await expect(page.locator('html')).toHaveCSS('background-color', fill);
    await expect(select, `${theme} theme select`).toHaveCSS('background-color', fill);
    await expect(signIn, `${theme} sign-in link`).toHaveCSS('background-color', fill);
  }
  // The rose runs under both controls here; the art check accepts that only because they are opaque.
  const rose = (await page.locator('img.landing-rose').boundingBox())!;
  for (const control of [select, signIn]) {
    const box = (await control.boundingBox())!;
    expect(box.x + box.width > rose.x && box.y < rose.y + rose.height).toBe(true);
  }
  expect(await artUnderContent(page)).toEqual([]);
  // A translucent fill, or a translucent ancestor, lets the art show through, so the check reports it.
  await select.evaluate((element: HTMLElement) => {
    element.style.backgroundColor = 'color-mix(in srgb, var(--background) 90%, transparent)';
  });
  expect(await artUnderContent(page)).toEqual([
    expect.stringMatching(/^landing-rose under select /),
  ]);
  await select.evaluate((element: HTMLElement) => {
    element.style.backgroundColor = '';
    element.closest<HTMLElement>('.header-tools')!.style.opacity = '0.95';
  });
  expect(await artUnderContent(page)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^landing-rose under select /),
      'landing-rose under a "Sign in"',
      'landing-rose under text "Sign in"',
    ]),
  );
  // An opaque fill helps only if the control paints above the art. Raised above the header,
  // the rose would cover both controls while clicks still reach them, and the check reports it.
  await page.locator('.header-tools').evaluate((tools: HTMLElement) => {
    tools.style.opacity = '';
  });
  expect(await artUnderContent(page)).toEqual([]);
  await page.locator('img.landing-rose').evaluate((rose: HTMLElement) => {
    rose.style.zIndex = '2';
  });
  expect(await artUnderContent(page)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^landing-rose under select /),
      'landing-rose under a "Sign in"',
      'landing-rose under text "Sign in"',
    ]),
  );
});

test('while recovery is pending, the header Sign in link shows that it is unavailable', async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/auth/recover', async (route) => {
    await held;
    await route.abort('failed');
  });
  await page.goto('/recover');
  const link = headerSignIn(page);
  await expect(link).toBeVisible();
  await expect(link).not.toHaveAttribute('aria-disabled');
  await page.getByLabel('Recovery handle').fill('synthetic-handle');
  await page.getByLabel('Unused recovery code').fill('synthetic-code');
  await page.getByRole('button', { name: 'Verify recovery kit', exact: true }).click();
  // The request is pending: the link says so, looks dimmed and takes no pointer.
  await expect(link).toHaveAttribute('aria-disabled', 'true');
  await expect(link).toHaveCSS('opacity', '0.5');
  await expect(link).toHaveCSS('pointer-events', 'none');
  // Once the request settles, the link works again.
  release();
  await expect(link).not.toHaveAttribute('aria-disabled');
  await link.click();
  await expect(page).toHaveURL('http://localhost:8787/sign-in');
  await expect(signInHeading(page)).toBeFocused();
});

test('the lead and the closing line fit on one line at 768 and 1280 px and never end on a lone word', async ({
  page,
}) => {
  await page.goto('/');
  await expect(welcomeHeading(page)).toBeVisible();
  for (const width of [320, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const part of [page.locator('.invitation-lead'), page.locator('.invitation-closing')]) {
      const lines = await wordLines(part);
      const label = `${width}px: ${lines.join(' / ')}`;
      if (width === 768 || width === 1280) expect(lines, label).toHaveLength(1);
      expect(lines.at(-1)!.split(' ').length, label).toBeGreaterThan(1);
    }
  }
});

test('each position subtitle fits on one line from 390 px, beside a plate about 40% of its tile', async ({
  page,
}) => {
  await page.goto('/');
  await expect(welcomeHeading(page)).toBeVisible();
  for (const width of [390, 640, 768, 900, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const detail of await page.locator('.position-tile-detail').all())
      expect(await wordLines(detail), `${width}px`).toHaveLength(1);
    for (const tile of await page.locator('.position-tile').all()) {
      const plate = (await tile.locator('.position-plate').boundingBox())!;
      const box = (await tile.boundingBox())!;
      expect(plate.width / box.width, `${width}px plate share`).toBeCloseTo(0.4, 1);
    }
    expect(await artUnderContent(page), `${width}px art under content`).toEqual([]);
  }
});

test('signed out, the header offers Sign in on the welcome and recovery pages but not on /sign-in', async ({
  page,
}) => {
  const link = headerSignIn(page);
  for (const path of ['/', '/recover']) {
    await page.goto(path);
    await expect(link, path).toHaveAttribute('href', '/sign-in');
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const target = (await link.boundingBox())!;
      expect(Math.min(target.width, target.height), `${path} ${width}px`).toBeGreaterThanOrEqual(
        44,
      );
    }
    // The link moves within the app: a value set on this page survives, and Back returns.
    await page.evaluate(() => {
      (window as unknown as { kept: boolean }).kept = true;
    });
    await link.click();
    await expect(page).toHaveURL('http://localhost:8787/sign-in');
    await expect(signInHeading(page)).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
    await expect(link).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(`http://localhost:8787${path}`);
    await expect(link).toBeVisible();
  }
});

for (const theme of ['paper', 'evening'] as const) {
  test(`${theme}: at 320 px the signed-out header keeps the wordmark, theme select and Sign in on one row`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('reflection-theme', value), theme);
    await page.setViewportSize({ width: 320, height: 800 });
    for (const path of ['/', '/recover']) {
      await page.goto(path);
      await expect(headerSignIn(page)).toBeVisible();
      const [header, wordmark, select, signIn] = await Promise.all(
        [
          page.locator('.site-header'),
          page.locator('.site-header .brand'),
          page.getByLabel('Color theme'),
          headerSignIn(page),
        ].map(async (part) => (await part.boundingBox())!),
      );
      const label = `${theme} ${path}`;
      // One 68 px row plus the 1 px rule, as at 390 px.
      expect(header!.height, `${label} header height`).toBeLessThanOrEqual(69);
      for (const [name, box] of [
        ['wordmark', wordmark],
        ['theme select', select],
        ['Sign in', signIn],
      ] as const) {
        expect(box!.y, `${label} ${name} top`).toBeGreaterThanOrEqual(header!.y);
        expect(box!.y + box!.height, `${label} ${name} bottom`).toBeLessThanOrEqual(
          header!.y + header!.height,
        );
      }
      // Left to right, without touching, and Sign in keeps its 44 px target.
      expect(wordmark!.x + wordmark!.width, label).toBeLessThan(select!.x);
      expect(select!.x + select!.width, label).toBeLessThan(signIn!.x);
      expect(Math.min(signIn!.width, signIn!.height), label).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${label} horizontal overflow`,
      ).toBe(true);
    }
  });
}

test('a direct load of /sign-in shows the sign-in and new-account controls', async ({ page }) => {
  const response = await page.goto('/sign-in');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-type']).toContain('text/html');
  await expect(signInHeading(page)).toBeVisible();
  await expect(
    page.getByText(
      'Draw three tarot cards or bring your own spread. Save your reading and return with a note.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(localNotice, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sign in with a password', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sign in with a passkey', exact: true }),
  ).toBeVisible();
  const signup = page.getByRole('group', { name: 'New to Reflection?' });
  await expect(
    signup.getByRole('button', { name: 'Create a password account', exact: true }),
  ).toBeVisible();
  await expect(
    signup.getByRole('button', { name: 'Create a test account with a passkey', exact: true }),
  ).toBeVisible();
  await expect(
    signup.getByText('A passkey lets you join without an email address or password.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Recover with your saved kit', exact: true }),
  ).toHaveAttribute('href', '/recover');
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await artUnderContent(page), `${width}px art under content`).toEqual([]);
  }
});

test('?start=new focuses the new-account choices, on a direct load, from the welcome page and on Forward', async ({
  page,
}) => {
  const signup = page.getByRole('group', { name: 'New to Reflection?' });
  await page.goto('/sign-in?start=new');
  await expect(signup).toBeFocused();
  await page.goto('/');
  await page.getByRole('link', { name: 'Draw three cards', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/sign-in\?start=new$/);
  await expect(signup).toBeFocused();
  // Back and Forward return to the same request.
  await page.goBack();
  await expect(welcomeHeading(page)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/sign-in\?start=new$/);
  await expect(signup).toBeFocused();
  // Without ?start=new the page heading takes focus, as on every other page change.
  await page.goBack();
  await expect(welcomeHeading(page)).toBeVisible();
  await page.getByRole('link', { name: 'I have an account', exact: true }).click();
  await expect(signInHeading(page)).toBeFocused();
});

test('the art check measures the whole leaf band under CSS zoom', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto('/sign-in');
  await expect(signInHeading(page)).toBeVisible();
  await page.locator('html').evaluate((element) => {
    element.style.zoom = '2';
  });
  // A line three quarters of the way up the band sits on it, above its lower half.
  await page.locator('.app-shell').evaluate((shell) => {
    const band = Number.parseFloat(getComputedStyle(shell, '::after').height);
    const line = document.createElement('p');
    line.textContent = 'Synthetic probe';
    line.style.cssText = `position: absolute; left: 16px; bottom: ${band * 0.75}px; margin: 0;`;
    shell.appendChild(line);
  });
  expect(await artUnderContent(page)).toContain('leaf band under text "Synthetic probe"');
});

test('Back and Forward move between the welcome page and /sign-in and close the password form', async ({
  page,
}) => {
  await page.goto('/');
  await openSignIn(page);
  await page.getByRole('button', { name: 'Sign in with a password', exact: true }).click();
  await expect(page.getByLabel('Username or email')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('http://localhost:8787/');
  await expect(welcomeHeading(page)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL('http://localhost:8787/sign-in');
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByLabel('Username or email')).toHaveCount(0);
  await page.goBack();
  await expect(welcomeHeading(page)).toBeVisible();
});

test('"Back to sign in" on /recover opens /sign-in and forgets the typed kit', async ({ page }) => {
  await page.goto('/recover');
  await page.getByLabel('Recovery handle').fill('synthetic-handle');
  await page.getByLabel('Unused recovery code').fill('synthetic-code');
  await page.getByRole('link', { name: 'Back to sign in', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:8787/sign-in');
  await expect(signInHeading(page)).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL('http://localhost:8787/recover');
  await expect(page.getByLabel('Recovery handle')).toHaveValue('');
  await expect(page.getByLabel('Unused recovery code')).toHaveValue('');
});

test('a signed-in reader who opens /sign-in lands on their readings at /', async ({ page }) => {
  await account(page, '203.0.113.231');
  // Creating the account from /sign-in replaced that address.
  await expect(page).toHaveURL('http://localhost:8787/');
  for (const path of ['/sign-in', '/sign-in?start=new']) {
    await page.goto(path);
    await expect(page).toHaveURL('http://localhost:8787/');
    await expect(page.getByRole('region', { name: 'Your readings', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeVisible();
    await expect(headerSignIn(page)).toHaveCount(0);
  }
});

for (const theme of ['paper', 'evening'] as const) {
  test(`${theme}: cards, tiles, sign-in and the header keep their contrast`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('reflection-theme', value), theme);
    await page.goto('/');
    await expect(page.getByRole('list', { name: 'Reflection positions' })).toBeVisible();
    // The sign-in link joins the header once the session check settles.
    await expect(headerSignIn(page)).toBeVisible();
    // At this width the rose runs behind the header. The wordmark stays clear of it, and the
    // header controls paint the page fill, so each pair is measured on its own fill.
    await expect(page.locator('main.invitation')).toHaveCSS('overflow', 'clip');
    const ratios: Record<string, number> = {};
    const measure = async (name: string, selector: string) => {
      // A missing measurement counts as failing contrast.
      ratios[name] = (await themeContrast(page, selector)).selectedText ?? 0;
    };
    await measure('header wordmark', '.brand');
    await measure('header theme control', '.theme-control select');
    await measure('header sign-in link', '.site-header .header-link');
    await measure('welcome headline', '.invitation-title');
    await measure('positions label', '.positions-title');
    await measure('tile number', '.position-tile-number');
    await measure('tile title', '.position-tile-name');
    await measure('tile line', '.position-tile-detail');
    await measure('closing line', '.invitation-closing');
    await page.goto('/sign-in');
    await expect(signInHeading(page)).toBeVisible();
    // The controls replace "Checking your session…" once the session check settles.
    await expect(
      page.getByRole('link', { name: 'Recover with your saved kit', exact: true }),
    ).toBeVisible();
    await measure('sign-in title', '.sign-in-card h1');
    await measure('sign-in promise', '.sign-in-card .brand-promise');
    await measure('sign-in link', '.sign-in-card .text-link');
    await measure('sign-in hint', '.sign-in-card .field-hint');
    for (const [name, ratio] of Object.entries({ ...ratios, ...(await themeContrast(page)) }))
      expect(ratio, `${theme}: ${name}`).toBeGreaterThanOrEqual(name.startsWith('input') ? 3 : 4.5);
  });
}
