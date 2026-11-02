import type { z } from 'zod';
import type { Grant } from '../../contracts/index.ts';
import type { Target } from '../recovery/ledger.ts';
import { statement as q, DB_NOW } from '../db/core.ts';
import { type RecordBase, terminalStates } from './base.ts';

export interface ContextSelector {
  sql: string;
  args: (string | number)[];
}
export function sourceSelector(source: z.infer<typeof Grant>['source']): ContextSelector {
  if (source.kind === 'edition') return { sql: 'g.edition_id=?', args: [source.editionId] };
  if (source.kind === 'reflection_revision')
    return {
      sql: 'g.reflection_id=? AND g.reflection_revision=?',
      args: [source.reflectionId, source.revision],
    };
  return {
    sql: 'g.revisit_id=? AND g.revisit_revision=?',
    args: [source.revisitId, source.revision],
  };
}
export function targetSelector(target: Exclude<Target, { scope: 'account' }>): ContextSelector {
  if (target.scope === 'context_copy') return sourceSelector(target.source);
  if (target.scope === 'reflection_revision')
    return sourceSelector({
      kind: 'reflection_revision',
      reflectionId: target.reflectionId,
      revision: target.revision,
    });
  if (target.scope === 'revisit') return { sql: 'g.revisit_id=?', args: [target.revisitId] };
  return {
    sql: `g.source_session_id=? OR g.edition_id IN(SELECT id FROM reading_editions WHERE owner_id=g.owner_id AND session_id=?) OR g.reflection_id IN(SELECT id FROM reflections WHERE owner_id=g.owner_id AND session_id=?) OR g.revisit_id IN(SELECT id FROM revisits WHERE owner_id=g.owner_id AND session_id=?)`,
    args: Array(4).fill(target.sessionId),
  };
}
/** UNION (not UNION ALL) terminates cycles. Identities survive nulling ciphertext. */
function dependencies(owner: string, selector: ContextSelector) {
  const sql = `WITH RECURSIVE affected(id) AS (
    SELECT x.request_id FROM generation_context x JOIN context_grants g ON g.owner_id=x.owner_id AND g.id=x.grant_id WHERE g.owner_id=? AND (${selector.sql})
    UNION SELECT r.id FROM generation_requests r JOIN reading_editions e ON e.owner_id=r.owner_id AND e.id=r.parent_edition_id JOIN affected a ON a.id=e.request_id WHERE r.owner_id=?
    UNION SELECT x.request_id FROM generation_context x JOIN context_grants g ON g.owner_id=x.owner_id AND g.id=x.grant_id JOIN reading_editions e ON e.owner_id=g.owner_id AND e.id=g.edition_id JOIN affected a ON a.id=e.request_id WHERE x.owner_id=?
  ) SELECT id FROM affected`;
  return { sql, args: [owner, ...selector.args, owner, owner] };
}
export function contextFence(base: RecordBase, owner: string, selector: ContextSelector) {
  const dep = dependencies(owner, selector);
  const active = `SELECT id FROM generation_requests WHERE owner_id=? AND id IN(${dep.sql}) AND state NOT IN(${terminalStates})`;
  const args = [owner, ...dep.args];
  return [
    q(
      base.db,
      `INSERT INTO request_events(request_id,owner_id,sequence,state,code,error_code,created_at) SELECT id,owner_id,max(next_event,coalesce((SELECT max(sequence)+1 FROM request_events WHERE request_id=r.id),1)),'blocked','STOPPED','CONFLICT',${DB_NOW} FROM generation_requests r WHERE id IN(${active})`,
      ...args,
    ),
    q(
      base.db,
      `UPDATE generation_requests SET next_event=(SELECT max(sequence)+1 FROM request_events WHERE request_id=generation_requests.id) WHERE id IN(${active})`,
      ...args,
    ),
    q(
      base.db,
      `UPDATE quota_buckets SET held=held-(SELECT count(*) FROM quota_reservations qr WHERE qr.owner_id=quota_buckets.owner_id AND qr.state='held' AND (qr.day_period=quota_buckets.period OR qr.month_period=quota_buckets.period) AND qr.request_id IN(${active})) WHERE owner_id=?`,
      ...args,
      owner,
    ),
    q(
      base.db,
      `INSERT OR IGNORE INTO quota_events SELECT request_id,owner_id,'release',${DB_NOW} FROM quota_reservations WHERE state='held' AND request_id IN(${active})`,
      ...args,
    ),
    q(
      base.db,
      `UPDATE quota_reservations SET state='released' WHERE state='held' AND request_id IN(${active})`,
      ...args,
    ),
    q(
      base.db,
      `UPDATE generation_requests SET state='blocked',error_code='CONFLICT',revision=revision+1,lease_token=NULL,lease_expires_at=NULL,finished_at=${DB_NOW} WHERE id IN(${active})`,
      ...args,
    ),
    q(
      base.db,
      `UPDATE context_grants AS g SET state='revoked',revision=revision+1,updated_at=${DB_NOW} WHERE owner_id=? AND (${selector.sql}) AND state='allowed'`,
      owner,
      ...selector.args,
    ),
  ];
}
/** Hide all derived private copies at admission, while ciphertext awaits durable ledger erasure. */
export function contextErasureFence(base: RecordBase, owner: string, selector: ContextSelector) {
  const dep = dependencies(owner, selector);
  return [
    ...contextFence(base, owner, selector),
    q(
      base.db,
      `UPDATE generation_requests SET context_withdrawn_at=coalesce(context_withdrawn_at,${DB_NOW}) WHERE owner_id=? AND id IN(${dep.sql})`,
      owner,
      ...dep.args,
    ),
    q(
      base.db,
      `UPDATE reading_editions SET status=CASE WHEN status='deleted' THEN 'deleted' ELSE 'withdrawn' END,invalidated_at=coalesce(invalidated_at,${DB_NOW}) WHERE owner_id=? AND request_id IN(${dep.sql})`,
      owner,
      ...dep.args,
    ),
    q(
      base.db,
      `UPDATE context_grants AS g SET state='revoked',revision=revision+1,updated_at=${DB_NOW} WHERE owner_id=? AND state='allowed' AND edition_id IN(SELECT id FROM reading_editions WHERE owner_id=? AND request_id IN(${dep.sql}))`,
      owner,
      owner,
      ...dep.args,
    ),
  ];
}
/** Delete copies separately from revocation; never decrypt to discover their dependency. */
export function eraseContextCopies(base: RecordBase, owner: string, selector: ContextSelector) {
  const dep = dependencies(owner, selector);
  return [
    ...contextErasureFence(base, owner, selector),
    q(
      base.db,
      `UPDATE generation_requests SET plan_enc=NULL WHERE owner_id=? AND id IN(${dep.sql})`,
      owner,
      ...dep.args,
    ),
    q(
      base.db,
      `UPDATE provider_dispatches SET transmission_enc=NULL,candidate_enc=NULL,provider_response_id_enc=NULL WHERE owner_id=? AND request_id IN(${dep.sql})`,
      owner,
      ...dep.args,
    ),
    q(
      base.db,
      `UPDATE generation_context SET fragment_enc=NULL WHERE owner_id=? AND request_id IN(${dep.sql})`,
      owner,
      ...dep.args,
    ),
    q(
      base.db,
      `UPDATE context_grants AS g SET state='revoked',revision=revision+1,updated_at=${DB_NOW} WHERE owner_id=? AND state='allowed' AND edition_id IN(SELECT id FROM reading_editions WHERE owner_id=? AND request_id IN(${dep.sql}))`,
      owner,
      owner,
      ...dep.args,
    ),
    q(
      base.db,
      `UPDATE reading_editions SET body_enc=NULL,status=CASE WHEN status='deleted' THEN 'deleted' ELSE 'withdrawn' END,invalidated_at=coalesce(invalidated_at,${DB_NOW}) WHERE owner_id=? AND request_id IN(${dep.sql})`,
      owner,
      ...dep.args,
    ),
  ];
}

/** Independent cleanup proof: completion metadata alone is not evidence that private copies are gone. */
export function contextCopyViolations(db: D1Database, owner: string, selector: ContextSelector) {
  const dep = dependencies(owner, selector);
  return [
    q(
      db,
      `SELECT 1 FROM context_grants g WHERE owner_id=? AND (${selector.sql}) AND state='allowed' LIMIT 1`,
      owner,
      ...selector.args,
    ),
    q(
      db,
      `SELECT 1 FROM generation_requests WHERE owner_id=? AND id IN(${dep.sql}) AND (plan_enc IS NOT NULL OR context_withdrawn_at IS NULL OR state NOT IN(${terminalStates})) LIMIT 1`,
      owner,
      ...dep.args,
    ),
    q(
      db,
      `SELECT 1 FROM generation_context WHERE owner_id=? AND request_id IN(${dep.sql}) AND fragment_enc IS NOT NULL LIMIT 1`,
      owner,
      ...dep.args,
    ),
    q(
      db,
      `SELECT 1 FROM provider_dispatches WHERE owner_id=? AND request_id IN(${dep.sql}) AND (transmission_enc IS NOT NULL OR candidate_enc IS NOT NULL OR provider_response_id_enc IS NOT NULL) LIMIT 1`,
      owner,
      ...dep.args,
    ),
    q(
      db,
      `SELECT 1 FROM reading_editions WHERE owner_id=? AND request_id IN(${dep.sql}) AND (body_enc IS NOT NULL OR status NOT IN('withdrawn','deleted')) LIMIT 1`,
      owner,
      ...dep.args,
    ),
    q(
      db,
      `SELECT 1 FROM quota_reservations WHERE owner_id=? AND request_id IN(${dep.sql}) AND state='held' LIMIT 1`,
      owner,
      ...dep.args,
    ),
  ];
}
