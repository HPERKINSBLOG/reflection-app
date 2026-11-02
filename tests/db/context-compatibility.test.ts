import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { StartRequest } from '../../src/contracts/index.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { readingAccount } from '../fixtures/reading-client.ts';
import old from '../fixtures/context-start-v1.json';
import { RecordCrypto } from '../../src/worker/readings/crypto.ts';
import { IdentityCrypto } from '../../src/worker/identity/crypto.ts';
import { IDENTITY_SECRETS } from '../fixtures/identity.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));

test('pre-continuity Start body retains stored HMAC and joins the same durable request', async () => {
  const { client, kit } = await readingAccount();
  const key = crypto.randomUUID();
  expect((await client.me()).permission.revision).toBe(old.permissionRevision);
  // Compute the old mutation hash directly from frozen raw JSON, without the new schema.
  const crypt = new RecordCrypto(env.DB, new IdentityCrypto(IDENTITY_SECRETS));
  const historicalHmac = await crypt.hash(kit.subjectId, 'mutation', ['reading.start', old]);
  expect(StartRequest.parse(old)).toEqual(old);
  const first = await client.request('/requests', old, { key });
  expect(first.status).toBe(202);
  const body = (await first.json()) as { requestId: string };
  const before = await env.DB.prepare('SELECT payload_hmac FROM generation_requests WHERE id=?')
    .bind(body.requestId)
    .first('payload_hmac');
  expect(before).toBe(historicalHmac);
  const dispatchesBefore = await env.DB.prepare(
    'SELECT count(*) AS count FROM provider_dispatches',
  ).first('count');
  const retried = await client.request('/requests', StartRequest.parse(old), { key });
  expect(retried.status).toBe(202);
  expect(await retried.json()).toMatchObject({ requestId: body.requestId, joined: true });
  expect(
    await env.DB.prepare('SELECT payload_hmac FROM generation_requests WHERE id=?')
      .bind(body.requestId)
      .first('payload_hmac'),
  ).toBe(before);
  expect(
    await env.DB.prepare('SELECT count(*) AS count FROM generation_requests').first('count'),
  ).toBe(1);
  expect(
    await env.DB.prepare('SELECT count(*) AS count FROM provider_dispatches').first('count'),
  ).toBe(dispatchesBefore);
});
