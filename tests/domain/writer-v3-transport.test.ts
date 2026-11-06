import { expect, test } from 'vitest';
import { READING_V3_SYNTHETIC_POLICY as policy } from '../../src/contracts/provider-policy.ts';
import { buildPlan } from '../../src/domain/tarot/plan.ts';
import { buildPlanV2 } from '../../src/domain/tarot/context-v2.ts';
import { buildPlanV3 } from '../../src/domain/tarot/continuity.ts';
import { composeTemplateV2 } from '../../src/domain/tarot/writer-v2.ts';
import { composeTemplateV3, prepareWriterV3 } from '../../src/domain/tarot/writer-v3.ts';
import { OpenAIResponsesTransport } from '../../src/worker/provider/transport.ts';
import { syntheticPlanInput, syntheticCandidate } from '../fixtures/canon.ts';
import { v2Input } from '../fixtures/canon-v2.ts';

test.each([3, 2, 1])(
  'v3 transport accepts only its requested schema, returned version %s',
  async (version) => {
    const input = await syntheticPlanInput();
    const text = 'An explicitly selected synthetic note';
    const plan = await buildPlanV3({
      ...input,
      selected: [
        {
          ordinal: 0,
          grantId: crypto.randomUUID(),
          grantRevision: 1,
          sourceKind: 'revisit_revision',
          sourceId: crypto.randomUUID(),
          sourceRevision: 1,
          start: 0,
          end: text.length,
          text,
          textHash: 'a'.repeat(64),
          availability: 'retained',
          authorship: 'user',
        },
      ],
    });
    const { payload } = await prepareWriterV3(plan);
    const returned =
      version === 3
        ? await composeTemplateV3(plan)
        : version === 2
          ? await composeTemplateV2(await buildPlanV2(await v2Input()))
          : syntheticCandidate(await buildPlan(input));
    let calls = 0;
    const transport = new OpenAIResponsesTransport({
      apiKey: 'synthetic-test-key',
      policy,
      fetch: async (_url, init) => {
        calls++;
        expect(new Uint8Array(init!.body as Uint8Array)).toEqual(payload);
        return Response.json({
          id: 'synthetic-v3',
          model: policy.model,
          service_tier: policy.request.service_tier,
          status: 'completed',
          usage: {
            input_tokens: 200,
            input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
            output_tokens: 100,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 300,
          },
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: JSON.stringify(returned) }],
            },
          ],
        });
      },
    });
    const result = await transport.write({
      dispatchId: crypto.randomUUID(),
      model: policy.model,
      payload,
      timeoutMs: policy.timeoutMs,
      maxOutputTokens: policy.request.max_output_tokens,
      store: policy.request.store,
      reasoning: policy.request.reasoning.effort,
      signal: new AbortController().signal,
    });
    expect(calls).toBe(1);
    expect(result.kind).toBe(version === 3 ? 'candidate' : 'invalid');
    if (version === 3) expect(result).toMatchObject({ candidate: returned });
    expect(result.receipt?.usage.outputTokens).toBe(100);
  },
);
