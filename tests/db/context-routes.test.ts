import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas } from '../../src/contracts/index.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { readingAccount } from '../fixtures/reading-client.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));

test('owned grant and preview routes require CSRF and stay independent of generation', async () => {
  const { client } = await readingAccount();
  const { started, reading } = await client.create();
  const session = apiSchemas.SessionRecord.parse(
    await (await client.request(`/sessions/${started.sessionId}`)).json(),
  );
  expect(
    (
      await client.request(
        `/sessions/${session.id}/save`,
        { saved: true },
        { method: 'PUT', revision: session.revision },
      )
    ).status,
  ).toBe(200);
  const source = { kind: 'edition', editionId: reading.editionId };
  const key = crypto.randomUUID();
  expect(
    (
      await client.request(
        '/context-grants',
        { source },
        { key, headers: { 'X-CSRF-Token': 'invalid' } },
      )
    ).status,
  ).toBe(403);
  const response = await client.request('/context-grants', { source }, { key });
  expect(response.status, await response.clone().text()).toBe(201);
  const grant = apiSchemas.Grant.parse(await response.json());
  expect(
    apiSchemas.Grant.parse(
      await (await client.request('/context-grants', { source }, { key })).json(),
    ),
  ).toEqual(grant);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  const page = apiSchemas.GrantPage.parse(
    await (await client.request(`/context-grants?editionId=${reading.editionId}&limit=1`)).json(),
  );
  expect(page.items).toEqual([grant]);
  const input = {
    clientIntentId: crypto.randomUUID(),
    question: 'What changed?',
    parentEditionId: null,
    permissionRevision: (await client.me()).permission.revision,
    items: [{ grantId: grant.id, grantRevision: grant.revision, start: 0, end: 2 }],
  };
  const count = () =>
    env.DB.prepare('SELECT count(*) FROM provider_dispatches').first<number>('count(*)');
  const before = await count();
  const preview = apiSchemas.ContextPreview.parse(
    await (await client.request('/context-preview', input)).json(),
  );
  expect([...preview.items[0]!.text]).toHaveLength(2);
  expect(await count()).toBe(before);
  expect(
    (
      await client.request(
        `/context-grants/${grant.id}`,
        {},
        { method: 'DELETE', revision: grant.revision },
      )
    ).status,
  ).toBe(200);
  expect((await client.request('/context-preview', input)).ok).toBe(false);
  expect(await count()).toBe(before);
});
