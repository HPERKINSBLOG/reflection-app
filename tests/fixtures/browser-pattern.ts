import type { Page } from '@playwright/test';
import { BirthDraft, PatternPreview, PatternSavedIdentity } from '../../src/contracts/astrology.ts';
import parity from './astrology-node-parity.json' with { type: 'json' };
export const patternBirth = BirthDraft.parse(parity[0]!.input.birth);
export async function patternRequest(page: Page, path: string, body?: unknown, method?: string) {
  return page.evaluate(
    async ({ path, body, method }) => {
      const me = (await (await fetch('/api/v1/me')).json()) as { csrfToken: string };
      const response = await fetch(`/api/v1/astrology${path}`, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': me.csrfToken,
          'Idempotency-Key': crypto.randomUUID(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value: unknown = await response.json();
      if (!response.ok)
        throw new Error(`Pattern fixture ${response.status}: ${JSON.stringify(value)}`);
      return value;
    },
    { path, body, method },
  );
}
export async function savePattern(page: Page, text = 'My original Pattern reflection.') {
  await patternRequest(
    page,
    '/profile',
    { birth: patternBirth, expectedRevision: 0, confirmedRetention: true },
    'PUT',
  );
  const preview = PatternPreview.parse(await patternRequest(page, '/pattern'));
  const saved = PatternSavedIdentity.parse(
    await patternRequest(page, '/pattern/saves', {
      chapterId: 'self',
      expectedProfileRevision: preview.profileRevision,
      basisHash: preview.basisHash,
      releaseHash: preview.releaseHash,
      reflection: { text, stance: 'unspecified' },
    }),
  );
  return { saved, preview };
}
