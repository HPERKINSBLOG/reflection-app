import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PatternContentRelease } from '../src/contracts/astrology.ts';
import { validatePatternCatalogue } from '../src/domain/astrology/chapters.ts';
import { canonicalJson, sha256Json } from '../src/domain/json.ts';

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
      Buffer.from(signature, 'base64url'),
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cataloguePath, approvalPath, trustedKeyPath, outputPath] = process.argv.slice(2);
  if (!cataloguePath || !approvalPath || !trustedKeyPath || !outputPath)
    throw Error(
      'Usage: tsx scripts/pattern-content-activate.ts CATALOGUE APPROVAL TRUSTED_PUBLIC_JWK OUTPUT',
    );
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
  const release = await approvePatternRelease(
    read(cataloguePath),
    read(approvalPath),
    read(trustedKeyPath),
  );
  writeFileSync(outputPath, `${JSON.stringify(release, null, 2)}\n`, { flag: 'wx' });
  console.log(
    `Reviewed Pattern artifact created: ${release.releaseHash}. Registry publication and numerical qualification are still required.`,
  );
}
