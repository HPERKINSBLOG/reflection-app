import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { approvePatternRelease } from '../src/domain/astrology/content-approval.ts';
export {
  approvePatternRelease,
  patternApprovalPayload,
} from '../src/domain/astrology/content-approval.ts';

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
