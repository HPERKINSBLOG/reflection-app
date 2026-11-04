import { expect, test } from 'vitest';
import { runEvaluationCli } from '../../scripts/provider-evaluate.ts';

test('local continuity evidence binds its independent corpus, writer policy, captured packets and adverse results', async () => {
  const report = await runEvaluationCli(['--dry-run', '--profile', 'continuity-local']);
  expect(report).toMatchObject({
    profile: 'continuity-local',
    qualificationEligible: false,
    liveCalls: 0,
  });
  const { verifyContinuityEvidence } = await import('../../scripts/provider-evaluation-v3.ts');
  await expect(verifyContinuityEvidence(report)).resolves.toBeUndefined();
  for (const changed of [
    { ...report, policyHash: 'f'.repeat(64) },
    { ...report, corpusHash: 'e'.repeat(64) },
    { ...report, cases: [] },
    { ...report, profile: 'reading-v2-development-fast-xhigh' },
  ])
    await expect(verifyContinuityEvidence(changed)).rejects.toThrow();
  const old = await runEvaluationCli([
    '--dry-run',
    '--profile',
    'reading-v2-development-fast-xhigh',
  ]);
  await expect(verifyContinuityEvidence({ ...old, profile: 'continuity-local' })).rejects.toThrow();
  const real = report as { cases: { id: string; result: string }[] };
  expect(Object.fromEntries(real.cases.map((c) => [c.id, c.result]))).toEqual({
    quiet: 'accepted-fixture',
    disagreement: 'accepted-fixture',
    changed: 'accepted-fixture',
    declined: 'accepted-fixture',
    hostile: 'accepted-fixture',
    'missing-parent': 'CONTENT_UNAVAILABLE',
    'failed-provenance': 'CONTENT_CHANGED',
  });
});
