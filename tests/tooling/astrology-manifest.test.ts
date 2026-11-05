import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../../content/astrology/calculation-manifest.json';

test('packaged ESM, timezone data and analytic coefficient bounds reproduce the release manifest', () => {
  expect(() =>
    execFileSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/generate-calculation-manifest.ts', '--check'],
      { stdio: 'pipe' },
    ),
  ).not.toThrow();
  const digest = createHash('sha256').update(readFileSync(manifest.engineArtifact)).digest('hex');
  expect(digest).toBe(manifest.identity.engineArtifactHash);
  expect(manifest.reliability.bounds.earth.radiusAu).toBeGreaterThan(1);
  expect(
    manifest.reliability.bounds.mercury.speedAuPerDay +
      manifest.reliability.bounds.earth.speedAuPerDay,
  ).toBeLessThan(0.09);
});
