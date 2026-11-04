import publicationGuard from './publication-guard.ts';
import type { z } from 'zod';
import type { SelectedFragment } from '../../contracts/index.ts';

import { statement, DB_NOW, type Binding } from './core.ts';
export {
  statement,
  assertChanges,
  assertExists,
  DB_NOW,
  DAY,
  MONTH,
  type Binding,
} from './core.ts';

export type CapturedFragmentIdentity = Pick<
  z.infer<typeof SelectedFragment>,
  'grantId' | 'grantRevision' | 'sourceKind' | 'sourceId' | 'sourceRevision'
> & { fragmentHmac: string };

/** Bind only the exact identities validated from the private plan. */
export function continuityGuardValues(
  parentEditionId: string | null,
  context: readonly CapturedFragmentIdentity[],
) {
  return {
    parent_edition_id: parentEditionId,
    context_count: context.length,
    expected_context: JSON.stringify(
      context.map(
        ({ grantId, grantRevision, fragmentHmac, sourceKind, sourceId, sourceRevision }) => ({
          grantId,
          grantRevision,
          fragmentHmac,
          sourceKind,
          sourceId,
          sourceRevision,
        }),
      ),
    ),
  };
}

/** Named parameters are compiled only from our checked-in SQL, never caller SQL. */
export function currentGuard(
  db: D1Database,
  values: Record<string, Binding>,
  stage: 'start' | 'start-photo' | 'dispatch' | 'publish' | 'recover' | 'recognize',
  developmentContent = false,
) {
  let source = publicationGuard;
  // Only the explicit local-live service admits draft content. Default guards stay unchanged.
  if (developmentContent)
    source = source.replace(
      "AND c.state IN('approved','superseded') AND c.rights_status='cleared'\n    AND c.reviewed_hash=c.hash AND c.reviewer_kind='human_approved'",
      "AND c.state='staged' AND c.rights_status!='disallowed' AND c.reviewer_kind='agent_reviewed'",
    );
  if (stage === 'recognize' || stage === 'start-photo')
    source = source
      .replace('JOIN basis_snapshots b ON', 'LEFT JOIN basis_snapshots b ON')
      .replace('AND b.body_enc IS NOT NULL', 'AND r.basis_id IS NULL')
      .replace("r.state IN('validating','fallback_pending')", "r.state='reserved'")
      .replace(
        'AND r.plan_hmac=:plan_hmac AND r.plan_enc IS NOT NULL',
        'AND r.plan_hmac IS NULL AND r.plan_enc IS NULL',
      )
      .replace(
        'AND sys.generation_enabled=1',
        "AND sys.dispatch_mode='model' AND sys.generation_enabled=1",
      )
      .replace(
        'AND r.context_count=:context_count',
        `AND r.context_count=:context_count AND EXISTS(SELECT 1 FROM quota_reservations qr WHERE qr.request_id=r.id AND qr.owner_id=r.owner_id AND qr.state='held' AND qr.expires_at>${DB_NOW})`,
      );
  else if (stage === 'recover')
    source = source.replace(
      "r.state IN('validating','fallback_pending')",
      "r.state IN('reserved','prepared','dispatching','received','validating','fallback_pending','uncertain')",
    );
  else if (stage !== 'publish')
    source = source.replace("r.state IN('validating','fallback_pending')", "r.state='prepared'");
  if (stage === 'start' || stage === 'start-photo')
    source = source
      .replace('AND r.run_epoch=:run_epoch AND r.lease_token=:lease_token', '')
      .replace(`AND r.lease_expires_at>${DB_NOW}`, '')
      .replace(
        'AND sys.generation_enabled=1',
        "AND sys.dispatch_mode IN('model','outage_template') AND sys.generation_enabled=1",
      );
  if (stage === 'dispatch')
    source = source.replace(
      'AND sys.generation_enabled=1',
      "AND sys.dispatch_mode='model' AND sys.generation_enabled=1",
    );
  // Older writers operate only on initial requests with no selections.
  const boundValues: Record<string, Binding> = { ...continuityGuardValues(null, []), ...values };
  const bindings: Binding[] = [];
  source = source.replace(/:([a-z_]+)/g, (_, key: string) => {
    const value = boundValues[key];
    if (value === undefined) throw new Error(`Missing guard binding: ${key}`);
    bindings.push(value);
    return '?';
  });
  return statement(db, source, ...bindings);
}
