import type { NatalCalculationResult } from '../../contracts/astrology.ts';
import { sha256Json } from '../json.ts';

/** Only normalized input, deterministic results and pinned model/policy identities.
 * Record IDs, profile metadata and wall-clock calculation time are added after hashing.
 */
export function semanticBasisHash(result: NatalCalculationResult): Promise<string> {
  if (result.kind !== 'calculated')
    throw Error('Unavailable calculations cannot have a saved basis identity');
  const { evaluatedInstants: _cost, ...semantic } = result;
  return sha256Json(semantic);
}
