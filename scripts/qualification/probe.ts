import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { calculateNatal, CALCULATION_IDENTITY } from '../../src/domain/astrology/calculate.ts';
import { NatalCalculationResult } from '../../src/contracts/astrology.ts';
import { canonicalJson } from '../../src/domain/json.ts';

const [origin, authorizationFile, output] = process.argv.slice(2);
assert(
  origin && authorizationFile && output,
  'Usage: tsx scripts/qualification/probe.ts ORIGIN AUTHORIZATION_FILE OUTPUT',
);
const url = new URL(origin);
assert(
  url.protocol === 'https:' &&
    /^reflection-pattern-qualification-[a-z0-9-]+\.lfd\.workers\.dev$/.test(url.hostname),
  'Use only the isolated qualification Worker',
);
const authorization = readFileSync(authorizationFile, 'utf8');
const results: Record<string, unknown>[] = [];
let validatedCalculations = 0;
function validateCalculation(raw: unknown) {
  const calculated = NatalCalculationResult.parse(raw);
  assert.equal(calculated.kind, 'calculated');
  assert(calculated.evaluatedInstants <= 2048);
  const expected = calculateNatal(calculated.input, calculated.resolved, CALCULATION_IDENTITY);
  assert.equal(
    canonicalJson(calculated),
    canonicalJson(expected),
    'Hosted result differs from the pinned Node adapter',
  );
  validatedCalculations++;
  return calculated.evaluatedInstants;
}
async function call(name: string, authorized = true) {
  const start = performance.now();
  const response = await fetch(`${url.origin}/${name}`, {
    method: 'POST',
    headers: authorized ? { Authorization: authorization } : {},
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.text();
  const parsed = response.headers.get('content-type')?.includes('application/json')
    ? JSON.parse(body)
    : body.slice(0, 500);
  const result = {
    name,
    authorized,
    status: response.status,
    wallMs: performance.now() - start,
    ray: response.headers.get('cf-ray'),
    body: parsed,
  };
  results.push(result);
  assert.equal(response.status, authorized ? 200 : 404, `${name} status`);
  if (authorized) {
    assert.equal(canonicalJson(parsed.identity), canonicalJson(CALCULATION_IDENTITY));
    if (name === 'places' || name === 'mixed') {
      assert(
        parsed.result.counts.length === 4 &&
          parsed.result.counts.every((n: number) => n > 0 && n <= 20),
      );
      for (const calculation of parsed.result.calculations ?? []) validateCalculation(calculation);
    } else {
      const count = validateCalculation(parsed.result);
      if (name.startsWith('budget-'))
        assert.equal(count, 2048, 'Worst-case fixture must reach the budget');
    }
  }
  console.log(
    JSON.stringify({
      name,
      status: response.status,
      wallMs: result.wallMs,
      cold: parsed?.coldPlaces,
    }),
  );
}
try {
  await call('places', false);
  for (const name of [
    'places',
    'places',
    'exact',
    'unknown',
    'fold',
    'boundary',
    'budget-sun',
    'budget-jupiter',
    'budget-saturn',
    'mixed',
  ])
    await call(name);
  for (const concurrency of [4, 8, 16]) {
    await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        call(['mixed', 'places', 'budget-sun', 'budget-saturn'][i % 4]!),
      ),
    );
    console.log(JSON.stringify({ concurrency, passed: true }));
  }
} finally {
  writeFileSync(
    output,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), validatedCalculations, results }, null, 2)}\n`,
  );
}
