import type { Target } from '../recovery/ledger.ts';
import { statement as q, DB_NOW } from '../db/core.ts';
import { assertion } from '../identity/checkpoint.ts';
import type { RecordBase } from './base.ts';
import { ImportCopies } from './import-copies.ts';
import { ContextCopies } from './context-copies.ts';

export class EraseData {
  constructor(readonly base: RecordBase) {}
  async account(target: Extract<Target, { scope: 'account' }>) {
    // Defer cyclic owned references; detached cost aggregates retain no account/dispatch association.
    await this.base.db.batch([
      q(this.base.db, 'PRAGMA defer_foreign_keys=ON'),
      q(
        this.base.db,
        'UPDATE cost_reservations SET owner_id=NULL,dispatch_id=NULL WHERE owner_id=?',
        target.subjectId,
      ),
      q(this.base.db, 'DELETE FROM accounts WHERE id=?', target.subjectId),
    ]);
  }
  async records(jobId: string, target: Exclude<Target, { scope: 'account' }>) {
    const db = this.base.db,
      owner = target.subjectId,
      imports = await ImportCopies.find(this.base, target),
      copies = new ContextCopies(this.base, target, imports.destinations);
    const statements = [
      assertion(
        db,
        "EXISTS(SELECT 1 FROM deletion_jobs WHERE id=? AND state!='complete' AND target_enc IS NOT NULL)",
        jobId,
      ),
      ...(imports.destinations.length ? copies.fence() : []),
      ...imports.erase(),
    ];
    statements.push(...copies.erase());
    if (target.scope === 'revisit') {
      statements.push(
        q(
          db,
          `UPDATE revisits SET note_enc=NULL,deleted_at=coalesce(deleted_at,${DB_NOW}),deletion_job_id=? WHERE owner_id=? AND id=?`,
          jobId,
          owner,
          target.revisitId,
        ),
        q(
          db,
          `UPDATE revisit_revisions SET body_enc=NULL,erased_at=coalesce(erased_at,${DB_NOW}) WHERE owner_id=? AND revisit_id=?`,
          owner,
          target.revisitId,
        ),
      );
    } else if (target.scope === 'reflection_revision') {
      statements.push(
        q(
          db,
          `UPDATE reflection_revisions SET body_enc=NULL,erased_at=coalesce(erased_at,${DB_NOW}) WHERE owner_id=? AND reflection_id=? AND revision=?`,
          owner,
          target.reflectionId,
          target.revision,
        ),
        q(
          db,
          `UPDATE reflections SET deleted_at=coalesce(deleted_at,${DB_NOW}) WHERE owner_id=? AND id=? AND current_revision=?`,
          owner,
          target.reflectionId,
          target.revision,
        ),
      );
    } else if (target.scope === 'session') {
      const id = target.sessionId;
      statements.push(
        assertion(
          db,
          "NOT EXISTS(SELECT 1 FROM reading_sessions WHERE owner_id=? AND id=? AND status!='deleted')",
          owner,
          id,
        ),
        q(db, 'UPDATE reading_sessions SET question_enc=NULL WHERE owner_id=? AND id=?', owner, id),
        q(
          db,
          'UPDATE basis_snapshots SET body_enc=NULL WHERE owner_id=? AND session_id=?',
          owner,
          id,
        ),
        q(
          db,
          `UPDATE reading_editions SET body_enc=NULL,status='deleted',invalidated_at=coalesce(invalidated_at,${DB_NOW}) WHERE owner_id=? AND session_id=?`,
          owner,
          id,
        ),
        q(
          db,
          `UPDATE reflection_revisions SET body_enc=NULL,erased_at=coalesce(erased_at,${DB_NOW}) WHERE owner_id=? AND reflection_id IN (SELECT id FROM reflections WHERE owner_id=? AND session_id=?)`,
          owner,
          owner,
          id,
        ),
        q(
          db,
          `UPDATE reflections SET deleted_at=coalesce(deleted_at,${DB_NOW}) WHERE owner_id=? AND session_id=?`,
          owner,
          id,
        ),
        q(
          db,
          `UPDATE revisit_revisions SET body_enc=NULL,erased_at=coalesce(erased_at,${DB_NOW}) WHERE owner_id=? AND revisit_id IN (SELECT id FROM revisits WHERE owner_id=? AND session_id=?)`,
          owner,
          owner,
          id,
        ),
        // Captured grants retain exact source identity. Remove unreferenced
        // note shells and keep only a bodyless FK target for the referenced ones.
        q(
          db,
          'DELETE FROM revisits WHERE owner_id=? AND session_id=? AND NOT EXISTS(SELECT 1 FROM context_grants g WHERE g.owner_id=revisits.owner_id AND g.revisit_id=revisits.id)',
          owner,
          id,
        ),
        q(
          db,
          `UPDATE revisits SET note_enc=NULL,deleted_at=coalesce(deleted_at,${DB_NOW}) WHERE owner_id=? AND session_id=?`,
          owner,
          id,
        ),
        q(
          db,
          `UPDATE cost_reservations SET owner_id=NULL,dispatch_id=NULL WHERE owner_id=? AND dispatch_id IN (SELECT d.id FROM provider_dispatches d JOIN generation_requests r ON r.id=d.request_id AND r.owner_id=d.owner_id WHERE r.owner_id=? AND r.session_id=? UNION SELECT spread_dispatch_id FROM generation_requests WHERE owner_id=? AND session_id=?)`,
          owner,
          owner,
          id,
          owner,
          id,
        ),
      );
    }
    await db.batch([
      ...statements,
      copies.erased(),
      imports.erased(),
      q(db, 'UPDATE accounts SET data_revision=data_revision+1 WHERE id=?', owner),
      q(
        db,
        `UPDATE deletion_jobs SET state='erasing',completed_at=coalesce(completed_at,${DB_NOW}) WHERE id=?`,
        jobId,
      ),
    ]);
  }
}
