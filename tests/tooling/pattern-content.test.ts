import { expect, test } from 'vitest';
import {
  approvePatternRelease,
  patternApprovalPayload,
} from '../../scripts/pattern-content-activate.ts';
import { syntheticPatternRelease } from '../../src/domain/astrology/chapters.ts';
import { canonicalJson } from '../../src/domain/json.ts';
import draft from '../../content/pattern-draft.json';

test('activation requires a trusted signature over the exact catalogue hash', async () => {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const hash = (await syntheticPatternRelease(draft)).releaseHash;
  const approval = {
    kind: 'pattern.content.approval.v1' as const,
    releaseHash: hash,
    reviewer: 'Synthetic reviewer',
    reviewedAt: '2026-11-05T00:00:00Z',
  };
  const signature = Buffer.from(
    await crypto.subtle.sign(
      'Ed25519',
      keys.privateKey,
      new TextEncoder().encode(canonicalJson(patternApprovalPayload(approval))),
    ),
  ).toString('base64url');
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const release = await approvePatternRelease(draft, { ...approval, signature }, publicKey);
  expect(release.review.kind).toBe('human_approved');
  await expect(
    approvePatternRelease(
      draft,
      { ...approval, releaseHash: '0'.repeat(64), signature },
      publicKey,
    ),
  ).rejects.toThrow();
  await expect(
    approvePatternRelease(draft, { ...approval, reviewer: 'Someone else', signature }, publicKey),
  ).rejects.toThrow();
  const other = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  await expect(
    approvePatternRelease(
      draft,
      { ...approval, signature },
      await crypto.subtle.exportKey('jwk', other.publicKey),
    ),
  ).rejects.toThrow();
});
