import type { z } from 'zod';
import type { SelectedFragment } from './index.ts';

export const CONTEXT_LIMITS = { sources: 3, perSource: 1200, total: 3000 } as const;
type Fragment = Pick<
  z.infer<typeof SelectedFragment>,
  'grantId' | 'sourceKind' | 'sourceId' | 'sourceRevision' | 'text'
>;
export function codePointLength(text: string): number {
  return [...text].length;
}
export function contextExcerpt(text: string, start: number, end: number): string {
  const points = [...text];
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > points.length ||
    end - start > CONTEXT_LIMITS.perSource
  )
    throw new Error('BAD_CONTEXT_RANGE');
  return points.slice(start, end).join('');
}
export function assertContextBounds(items: readonly Fragment[]): void {
  const grants = new Set<string>(),
    sources = new Set<string>();
  let total = 0;
  if (items.length > CONTEXT_LIMITS.sources) throw new Error('CONTEXT_LIMIT');
  for (const item of items) {
    const source = JSON.stringify([item.sourceKind, item.sourceId, item.sourceRevision]);
    if (grants.has(item.grantId) || sources.has(source) || item.text === null)
      throw new Error('INVALID_CONTEXT');
    const length = codePointLength(item.text);
    if (length === 0 || length > CONTEXT_LIMITS.perSource) throw new Error('CONTEXT_LIMIT');
    total += length;
    grants.add(item.grantId);
    sources.add(source);
  }
  if (total > CONTEXT_LIMITS.total) throw new Error('CONTEXT_LIMIT');
}
/** HMAC this tuple with the account index key after resolving source text on the server.
 * No plaintext/identity from the client is authoritative, and this helper sends nothing.
 */
export function contextAcknowledgementInput(
  owner: string,
  epoch: number,
  input: {
    clientIntentId: string;
    question: string;
    parentEditionId: string | null;
    permissionRevision: number;
  },
  fragments: readonly z.infer<typeof SelectedFragment>[],
): unknown[] {
  assertContextBounds(fragments);
  return [
    'context-request.v1',
    owner,
    epoch,
    input.clientIntentId,
    input.question,
    input.parentEditionId,
    input.permissionRevision,
    fragments.map((f) => [
      f.ordinal,
      f.grantId,
      f.grantRevision,
      f.sourceKind,
      f.sourceId,
      f.sourceRevision,
      f.start,
      f.end,
      f.textHash,
    ]),
  ];
}

/** Frozen continuity identities. Provider activation remains separately qualified. */
export const CONTINUITY_VERSIONS = {
  plan: 'tarot-plan.v3',
  candidate: 'tarot.interpretation.v3',
  accepted: 'tarot.accepted.v3',
  receipt: 'writer-packet.v3',
  policy: 'tarot-writer.v3',
} as const;
