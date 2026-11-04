import type { z } from 'zod';
import { Grant } from '../../contracts/index.ts';
import { DB_NOW, statement as q } from '../db/core.ts';
import type { RecordBase } from './base.ts';

export interface GrantRow {
  id: string;
  revision: number;
  state: string;
  edition_id: string | null;
  reflection_id: string | null;
  reflection_revision: number | null;
  revisit_id: string | null;
  revisit_revision: number | null;
}

/** The database checks that exactly one of the three owner-scoped identities is set. */
export function grantFromRow(row: GrantRow): z.infer<typeof Grant> {
  const source =
    row.edition_id !== null
      ? { kind: 'edition', editionId: row.edition_id }
      : row.reflection_id !== null
        ? {
            kind: 'reflection_revision',
            reflectionId: row.reflection_id,
            revision: row.reflection_revision,
          }
        : { kind: 'revisit_revision', revisitId: row.revisit_id, revision: row.revisit_revision };
  return Grant.parse({ id: row.id, revision: row.revision, state: row.state, source });
}

/** These queries run inside the same batch as the edit/revocation that invalidates the grant. */
export function revokeGrants(
  base: RecordBase,
  owner: string,
  column: 'id' | 'reflection_id' | 'revisit_id',
  id: string,
) {
  const affected = {
    requestIds: `SELECT x.request_id FROM generation_context x JOIN context_grants g ON g.owner_id=x.owner_id AND g.id=x.grant_id WHERE g.owner_id=? AND g.${column}=? AND g.state='allowed'`,
    values: [owner, id],
  };
  return [
    ...base.stopStatements(owner, affected, 'blocked', 'CONTEXT_CHANGED'),
    q(
      base.db,
      `UPDATE context_grants SET state='revoked',revision=revision+1,updated_at=${DB_NOW} WHERE owner_id=? AND ${column}=? AND state='allowed'`,
      owner,
      id,
    ),
  ];
}
