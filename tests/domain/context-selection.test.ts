import { expect, test } from 'vitest';
import { Grant, SelectedFragment, StartRequest, apiSchemas } from '../../src/contracts/index.ts';
import {
  CONTEXT_LIMITS,
  assertContextBounds,
  codePointLength,
  contextExcerpt,
  contextAcknowledgementInput,
} from '../../src/contracts/context-policy.ts';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const input = {
  clientIntentId: id,
  question: 'Exact question',
  languageConfirmed: 'en' as const,
  reversals: false,
  permissionRevision: 1,
  parentEditionId: null,
  selection: [],
};
const fragment = (text = 'hello') => ({
  ordinal: 0,
  grantId: id,
  grantRevision: 1,
  sourceKind: 'revisit_revision' as const,
  sourceId: id,
  sourceRevision: 2,
  start: 0,
  end: codePointLength(text),
  text,
  textHash: 'a'.repeat(64),
  availability: 'retained' as const,
  authorship: 'user' as const,
});

test('context schemas accept exact revisit revisions and code-point bounded Unicode', () => {
  expect(
    Grant.parse({
      id,
      revision: 1,
      state: 'allowed',
      source: { kind: 'revisit_revision', revisitId: id, revision: 2 },
    }).source.kind,
  ).toBe('revisit_revision');
  expect(SelectedFragment.parse(fragment('😀'.repeat(1200))).text).toHaveLength(2400);
  expect(SelectedFragment.safeParse(fragment('x'.repeat(1201))).success).toBe(false);
  expect(
    Grant.safeParse({
      id,
      revision: 1,
      state: 'allowed',
      source: { kind: 'revisit_revision', revisitId: id, revision: 0 },
    }).success,
  ).toBe(false);
});

test('excerpts preserve exact code points, whitespace and combining marks', () => {
  expect(CONTEXT_LIMITS).toEqual({ sources: 3, perSource: 1200, total: 3000 });
  expect(codePointLength(' 😀e\u0301 ')).toBe(5);
  expect(contextExcerpt(' 😀e\u0301 ', 1, 4)).toBe('😀e\u0301');
  for (const [start, end] of [
    [-1, 2],
    [1, 1],
    [2, 1],
    [0, 6],
    [0.5, 2],
  ])
    expect(() => contextExcerpt('hello', start!, end!)).toThrow();
  expect(() => contextExcerpt('x'.repeat(1201), 0, 1201)).toThrow();
});

test('aggregate bounds reject duplicate sources even with different grants', () => {
  const items = ['a', 'b', 'c'].map((n, i) => ({
    ...fragment('😀'.repeat(1000)),
    grantId: `grant-${n}`,
    sourceId: `source-${i}`,
  }));
  expect(() => assertContextBounds(items)).not.toThrow();
  expect(() =>
    assertContextBounds([...items, { ...fragment(), grantId: 'fourth', sourceId: 'fourth' }]),
  ).toThrow();
  expect(() =>
    assertContextBounds(items.map((f, i) => ({ ...f, text: 'x'.repeat(i === 2 ? 1001 : 1000) }))),
  ).toThrow();
  expect(() => assertContextBounds([fragment(), { ...fragment(), grantId: other }])).toThrow();
  expect(() => assertContextBounds([{ ...fragment(), text: null }])).toThrow();
});

test('old Start payload remains byte-shape compatible and selected context requires acknowledgement', () => {
  expect(StartRequest.parse(input)).toEqual(input);
  expect('contextAcknowledgement' in StartRequest.parse(input)).toBe(false);
  const selection = {
    grantId: id,
    grantRevision: 1,
    start: 0,
    end: 2,
    previewHash: 'a'.repeat(64),
  };
  expect(StartRequest.safeParse({ ...input, selection: [selection] }).success).toBe(false);
  expect(
    StartRequest.parse({ ...input, selection: [selection], contextAcknowledgement: 'b'.repeat(64) })
      .selection,
  ).toHaveLength(1);
});

test('preview returns bounded complete excerpts with an explicit request acknowledgement', () => {
  const item = {
    selection: { grantId: id, grantRevision: 1, start: 0, end: 1200, previewHash: 'a'.repeat(64) },
    text: '😀'.repeat(1200),
    authorship: 'user',
  };
  expect(
    apiSchemas.ContextPreview.safeParse({ items: [item], acknowledgementHash: 'b'.repeat(64) })
      .success,
  ).toBe(true);
  expect(apiSchemas.ContextPreview.safeParse({ items: [item] }).success).toBe(false);
  expect(
    apiSchemas.ContextPreviewWrite.safeParse({
      ...input,
      items: [],
      selection: undefined,
      reversals: undefined,
      languageConfirmed: undefined,
    }).success,
  ).toBe(false);
});

test('acknowledgement binds owner epoch, request identity, parent, ordered ranges and source hashes', () => {
  const fragments = [
    fragment(),
    { ...fragment('second'), ordinal: 1, grantId: other, sourceId: other },
  ];
  const bound = contextAcknowledgementInput(id, 1, input, fragments);
  for (const changed of [
    { ...input, question: 'other' },
    { ...input, parentEditionId: other },
    { ...input, permissionRevision: 2 },
    { ...input, clientIntentId: other },
  ])
    expect(contextAcknowledgementInput(id, 1, changed, fragments)).not.toEqual(bound);
  expect(contextAcknowledgementInput(other, 1, input, fragments)).not.toEqual(bound);
  expect(contextAcknowledgementInput(id, 2, input, fragments)).not.toEqual(bound);
  expect(contextAcknowledgementInput(id, 1, input, [...fragments].reverse())).not.toEqual(bound);
  expect(
    contextAcknowledgementInput(id, 1, input, [
      { ...fragments[0]!, textHash: 'c'.repeat(64) },
      fragments[1]!,
    ]),
  ).not.toEqual(bound);
});
