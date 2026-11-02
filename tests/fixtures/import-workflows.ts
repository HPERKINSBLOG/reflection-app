import { expect } from 'vitest';
import { apiSchemas } from '../../src/contracts/index.ts';
import { parseImportFile } from '../../src/domain/imports/parse.ts';
import { buildImportGroups } from '../../src/domain/imports/chunks.ts';
import type { ImportGroup, Source } from '../../src/domain/imports/types.ts';
import type { ReadingClient } from './reading-client.ts';

export async function importGroup(
  options: { source?: Source; text?: string; children?: number; note?: string } = {},
) {
  const source = options.source ?? { namespaceId: crypto.randomUUID(), revision: 'fixture-1' };
  const parsed = await parseImportFile({
    format: 'tarot-json',
    source,
    recovery: { kind: 'none' },
    document: JSON.stringify({
      exportedAt: '2026-11-01T00:00:00Z',
      entryCount: 1,
      entries: [
        {
          id: 'original-parent',
          question: 'Imported question 😀',
          personalReading: options.text ?? 'EXACT_IMPORTED_PROSE',
          cards: [],
          ...(options.note ? { reflections: { feelings: options.note } } : {}),
          followUps: Array.from({ length: options.children ?? 0 }, (_, i) => ({
            turnNumber: i + 1,
            question: `Old question ${i + 1}`,
            answer: `Old answer ${i + 1}`,
          })),
        },
      ],
    }),
  });
  expect(parsed.errors).toEqual([]);
  const groups = await buildImportGroups(parsed.units, () => crypto.randomUUID());
  expect(groups).toHaveLength(1);
  return groups[0]!;
}
export async function uploadGroup(client: ReadingClient, group: ImportGroup) {
  for (const chunk of group.chunks) {
    const response = await client.request('/imports/preview', chunk);
    expect(response.status, await response.clone().text()).toBe(201);
    apiSchemas.ImportPreview.parse(await response.json());
  }
  const response = await client.request(`/imports/groups/${group.id}`);
  expect(response.status, await response.clone().text()).toBe(200);
  return apiSchemas.ImportGroupStatus.parse(await response.json());
}
export async function commitGroup(
  client: ReadingClient,
  group: ImportGroup,
  key = crypto.randomUUID(),
) {
  const status = await uploadGroup(client, group);
  const input = {
    version: 'import-group.v1',
    manifestHash: group.manifestHash,
    previewHash: status.previewHash!,
    confirmedRecovery: group.chunks[0]!.recovery,
  };
  const response = await client.request(`/imports/groups/${group.id}/commit`, input, { key });
  expect(response.status, await response.clone().text()).toBe(200);
  return { status: apiSchemas.ImportGroupStatus.parse(await response.json()), input, key };
}
export async function portableGroups(client: ReadingClient) {
  const ticket = apiSchemas.ExportTicket.parse(await (await client.request('/exports', {})).json());
  const pages = [];
  let cursor: string | null = null;
  do {
    const response = await client.request(
      `/exports/${ticket.id}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const page = apiSchemas.ExportPage.parse(await response.json());
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor);
  const source = pages.flatMap((p) => p.records)[0]!.identity.source;
  const normalized = await parseImportFile({
    format: 'reflection-export.v1',
    source,
    recovery: { kind: 'none' },
    document: pages.map((p) => JSON.stringify(p)).join('\n'),
  });
  expect(normalized.errors).toEqual([]);
  return { pages, groups: await buildImportGroups(normalized.units, () => crypto.randomUUID()) };
}
