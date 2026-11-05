import { DB_NOW, statement as q } from '../db/core.ts';
import { assertion } from '../identity/checkpoint.ts';
import type { Target } from '../recovery/ledger.ts';
import type { RecordBase } from './base.ts';

type CopyTarget = Exclude<Target, { scope: 'account' | 'birth_profile' }>;

/** Provenance survives withdrawal, NULL ciphertext, and missing historical source
 * bodies. Follow the captured grant identity, never whatever revision is current.
 * UNION also terminates on repeated/cyclic edges in restored data. */
export class ContextCopies {
  private readonly cte: string;
  private readonly values: (string | number)[];
  private readonly fragments: string;
  constructor(
    private readonly base: RecordBase,
    private readonly target: CopyTarget,
    mirrors: readonly { kind: string; id: string; revision: number }[] = [],
  ) {
    const source = target.scope === 'context_copy' ? target.source : null;
    let roots: string,
      id: string,
      revision = 0;
    if (target.scope === 'session') {
      id = target.sessionId;
      roots = `g.edition_id IN (SELECT id FROM reading_editions WHERE owner_id=t.owner AND session_id=t.id)
        OR g.reflection_id IN (SELECT id FROM reflections WHERE owner_id=t.owner AND session_id=t.id)
        OR g.revisit_id IN (SELECT id FROM revisits WHERE owner_id=t.owner AND session_id=t.id)`;
    } else if (target.scope === 'revisit') {
      id = target.revisitId;
      roots = 'g.revisit_id=t.id';
    } else if (target.scope === 'reflection_revision') {
      id = target.reflectionId;
      revision = target.revision;
      roots = 'g.reflection_id=t.id AND g.reflection_revision=t.rev';
    } else if (source?.kind === 'edition') {
      id = source.editionId;
      roots = 'g.edition_id=t.id';
    } else if (source?.kind === 'reflection_revision') {
      id = source.reflectionId;
      revision = source.revision;
      roots = 'g.reflection_id=t.id AND g.reflection_revision=t.rev';
    } else if (source?.kind === 'revisit_revision') {
      id = source.revisitId;
      revision = source.revision;
      roots = 'g.revisit_id=t.id AND g.revisit_revision=t.rev';
    } else throw new Error('Unknown context erasure source');
    this.values = [target.subjectId, id, revision];
    if (mirrors.length) this.values.push(JSON.stringify(mirrors));
    this.cte = `WITH RECURSIVE target(owner,id,rev) AS (VALUES(?,?,?)),
      root_grants(owner,id) AS (
        SELECT g.owner_id,g.id FROM context_grants g JOIN target t ON t.owner=g.owner_id WHERE ${roots}
        ${
          mirrors.length
            ? `UNION SELECT g.owner_id,g.id FROM target t JOIN context_grants g ON g.owner_id=t.owner JOIN json_each(?) m ON
          (m.value->>'$.kind'='edition' AND g.edition_id=m.value->>'$.id') OR
          (m.value->>'$.kind'='reflection_revision' AND g.reflection_id=m.value->>'$.id' AND g.reflection_revision=m.value->>'$.revision') OR
          (m.value->>'$.kind'='revisit' AND g.revisit_id=m.value->>'$.id' AND g.revisit_revision=m.value->>'$.revision')`
            : ''
        }
      ),
      affected(owner,id) AS (
        SELECT x.owner_id,x.request_id FROM root_grants g JOIN generation_context x ON x.owner_id=g.owner AND x.grant_id=g.id
        ${target.scope === 'session' ? 'UNION SELECT r.owner_id,r.id FROM generation_requests r JOIN target t ON t.owner=r.owner_id AND t.id=r.session_id' : ''}
        UNION SELECT child.owner_id,child.id FROM affected a
          JOIN reading_editions e ON e.owner_id=a.owner AND e.request_id=a.id
          JOIN generation_requests child ON child.owner_id=e.owner_id AND child.parent_edition_id=e.id
        UNION SELECT x.owner_id,x.request_id FROM affected a
          JOIN reading_editions e ON e.owner_id=a.owner AND e.request_id=a.id
          JOIN context_grants g ON g.owner_id=e.owner_id AND g.edition_id=e.id
          JOIN generation_context x ON x.owner_id=g.owner_id AND x.grant_id=g.id
      ),
      grants(id) AS (
        SELECT id FROM root_grants UNION SELECT g.id FROM affected a
          JOIN reading_editions e ON e.owner_id=a.owner AND e.request_id=a.id
          JOIN context_grants g ON g.owner_id=e.owner_id AND g.edition_id=e.id
      )`;
    // A family owns all fragments of its own requests. In other families only
    // the individually targeted fragment is private material from this source.
    this.fragments = `grant_id IN (SELECT id FROM grants)${target.scope === 'session' ? ' OR request_id IN (SELECT r.id FROM generation_requests r JOIN target t ON t.owner=r.owner_id AND t.id=r.session_id)' : ''}`;
  }
  private query(statement: string) {
    return q(this.base.db, `${this.cte} ${statement}`, ...this.values);
  }
  affectedEditions() {
    return this.query(
      'SELECT e.id FROM affected a JOIN reading_editions e ON e.owner_id=a.owner AND e.request_id=a.id',
    ).all<{ id: string }>();
  }
  fence() {
    return [
      ...this.base.stopStatements(
        this.target.subjectId,
        {
          requestIds: `${this.cte} SELECT id FROM affected`,
          values: this.values,
        },
        'blocked',
        'CONTENT_UNAVAILABLE',
      ),
      this.query(`UPDATE context_grants SET state='revoked',revision=revision+1,updated_at=${DB_NOW}
        WHERE id IN (SELECT id FROM grants) AND state='allowed'`),
      this.query(`UPDATE reading_editions SET status='withdrawn',invalidated_at=${DB_NOW}
        WHERE request_id IN (SELECT id FROM affected) AND status IN ('accepted','imported')`),
    ];
  }
  erase() {
    return [
      this.query(
        `UPDATE generation_context SET fragment_enc=NULL,fragment_hmac='' WHERE ${this.fragments}`,
      ),
      this.query(
        'UPDATE generation_requests SET input_enc=NULL,plan_enc=NULL,plan_hmac=NULL WHERE id IN (SELECT id FROM affected)',
      ),
      this.query(`UPDATE provider_dispatches SET transmission_enc=NULL,transmission_hmac='',candidate_enc=NULL,provider_response_id_enc=NULL,
        state=CASE WHEN state='authorized' THEN 'unknown' ELSE state END WHERE request_id IN (SELECT id FROM affected)`),
      this.query(`UPDATE cost_reservations SET state='unknown',settled_at=coalesce(settled_at,${DB_NOW}) WHERE state='reserved'
        AND dispatch_id IN (SELECT id FROM provider_dispatches WHERE request_id IN (SELECT id FROM affected))`),
      this.query(
        'UPDATE reading_editions SET body_enc=NULL WHERE request_id IN (SELECT id FROM affected)',
      ),
    ];
  }
  /** Used before retiring either live or independent recovery evidence. */
  erased() {
    return assertion(
      this.base.db,
      `NOT EXISTS(${this.cte}
      SELECT 1 FROM context_grants WHERE state='allowed' AND id IN (SELECT id FROM grants)
      UNION ALL SELECT 1 FROM generation_context WHERE (${this.fragments}) AND (fragment_enc IS NOT NULL OR fragment_hmac!='')
      UNION ALL SELECT 1 FROM generation_requests WHERE id IN (SELECT id FROM affected) AND (input_enc IS NOT NULL OR plan_enc IS NOT NULL OR plan_hmac IS NOT NULL)
      UNION ALL SELECT 1 FROM provider_dispatches WHERE request_id IN (SELECT id FROM affected) AND (transmission_enc IS NOT NULL OR candidate_enc IS NOT NULL OR provider_response_id_enc IS NOT NULL)
      UNION ALL SELECT 1 FROM reading_editions WHERE request_id IN (SELECT id FROM affected) AND (body_enc IS NOT NULL OR status NOT IN ('withdrawn','deleted')))`,
      ...this.values,
    );
  }
}
