import { z } from 'zod';
import { ModelCandidate, ModelCandidateV2, ModelCandidateV3 } from '../contracts/index.ts';
import type { WriterProviderPolicy } from '../contracts/provider-policy.ts';
import { sha256Json } from './json.ts';

/** Bind the real output contract as well as its version; source enums are content-bound. */
export async function providerPolicyHash(policy: WriterProviderPolicy): Promise<string> {
  return sha256Json({
    policy,
    outputSchema: z.toJSONSchema(
      policy.schemaVersion === 'tarot.interpretation.v3'
        ? ModelCandidateV3
        : policy.schemaVersion === 'tarot.interpretation.v2'
          ? ModelCandidateV2
          : ModelCandidate,
    ),
  });
}
