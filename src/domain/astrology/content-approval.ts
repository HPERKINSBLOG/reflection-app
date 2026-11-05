import { z } from 'zod';
import { PatternContentRelease } from '../../contracts/astrology.ts';
import { validatePatternCatalogue } from './chapters.ts';
import { canonicalJson, sha256Json } from '../json.ts';

const ApprovalPayload = z.strictObject({
  kind: z.literal('pattern.content.approval.v1'),
  releaseHash: z.string().regex(/^[a-f0-9]{64}$/),
  reviewer: z.string().min(1).max(200),
  reviewedAt: z.iso.datetime(),
});
const Approval = ApprovalPayload.extend({
  signature: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(200),
});
type ApprovalPayload = z.infer<typeof ApprovalPayload>;
export const patternApprovalPayload = (approval: ApprovalPayload) =>
  ApprovalPayload.parse(approval);

/** Creates the reviewed artifact. Registry publication and numerical activation are separate gates. */
export async function approvePatternRelease(
  raw: unknown,
  rawApproval: unknown,
  trustedKey: JsonWebKey,
): Promise<PatternContentRelease> {
  const catalogue = await validatePatternCatalogue(raw);
  const approval = Approval.parse(rawApproval);
  const { signature, ...payload } = approval;
  const releaseHash = await sha256Json(catalogue);
  if (releaseHash !== approval.releaseHash)
    throw Error('Approval does not cover the exact catalogue');
  const key = await crypto.subtle.importKey('jwk', trustedKey, 'Ed25519', false, ['verify']);
  if (
    !(await crypto.subtle.verify(
      'Ed25519',
      key,
      Uint8Array.from(atob(signature.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
        c.charCodeAt(0),
      ),
      new TextEncoder().encode(canonicalJson(patternApprovalPayload(payload))),
    ))
  )
    throw Error('Untrusted Pattern content approval');
  return PatternContentRelease.parse({
    kind: 'pattern.content.v1',
    catalogue,
    releaseHash,
    state: 'active',
    review: {
      kind: 'human_approved',
      reviewedHash: releaseHash,
      reviewer: approval.reviewer,
      reviewedAt: approval.reviewedAt,
      signature,
    },
  });
}

/** Validate a complete stored release against an independently configured trust root. */
export async function verifyPatternRelease(
  rawRelease: unknown,
  trustedKey: JsonWebKey,
  expectedHash: string,
): Promise<PatternContentRelease> {
  const release = PatternContentRelease.parse(rawRelease);
  if (release.state !== 'active' || release.review.kind !== 'human_approved')
    throw Error('Reviewed Pattern release required');
  const verified = await approvePatternRelease(
    release.catalogue,
    {
      kind: 'pattern.content.approval.v1',
      releaseHash: release.review.reviewedHash,
      reviewer: release.review.reviewer,
      reviewedAt: release.review.reviewedAt,
      signature: release.review.signature,
    },
    trustedKey,
  );
  if (verified.releaseHash !== expectedHash || canonicalJson(verified) !== canonicalJson(release))
    throw Error('Pattern release does not match the configured identity');
  return verified;
}
