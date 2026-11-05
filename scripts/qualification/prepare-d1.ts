import { writeFileSync, readFileSync } from 'node:fs';
import {
  OWNER,
  OTHER,
  CONTENT,
  seedDatabase,
  seedHistoricalRequest,
} from '../../tests/fixtures/database.ts';

/** Serialize the established synthetic fixtures for an isolated hosted D1 rehearsal. */
const batches: { sql: string; params: (string | number | null)[] }[] = [];
const db = {
  prepare(sql: string) {
    const statement = {
      sql,
      params: [] as (string | number | null)[],
      bind(...params: (string | number | null)[]) {
        this.params = params;
        return this;
      },
    };
    return statement;
  },
  async batch(statements: typeof batches) {
    batches.push(...statements);
    return [];
  },
} as unknown as D1Database;
const add = (sql: string, ...params: (string | number | null)[]) => batches.push({ sql, params });
const plan = await seedDatabase(db);
add(
  "UPDATE reading_sessions SET status='saved',saved_at=1,retention_expires_at=NULL WHERE id=?",
  plan.sessionId,
);
let parent: string | null = null;
const editions: string[] = [];
for (let n = 1; n <= 3; n++) {
  const request = await seedHistoricalRequest(db, { ...plan, clientIntentId: crypto.randomUUID() });
  const edition = crypto.randomUUID();
  add(
    "INSERT INTO reading_editions(id,owner_id,session_id,edition_number,request_id,basis_id,parent_edition_id,status,mode,body_enc,key_version,content_hash,accepted_at) VALUES(?,?,?,?,?,?,?,'accepted','template',?,1,?,1)",
    edition,
    OWNER,
    plan.sessionId,
    n,
    request.requestId,
    plan.basisId,
    parent,
    `tarot-v${n}-unchanged-bytes`,
    CONTENT,
  );
  editions.push(edition);
  parent = edition;
}
const note = crypto.randomUUID(),
  reflection = crypto.randomUUID();
add(
  'INSERT INTO reflections(id,owner_id,session_id,edition_id) VALUES(?,?,?,?)',
  reflection,
  OWNER,
  plan.sessionId,
  parent,
);
add(
  "INSERT INTO reflection_revisions(reflection_id,owner_id,revision,body_enc,key_version,created_at) VALUES(?,?,1,'original-writing',1,1)",
  reflection,
  OWNER,
);
add(
  "INSERT INTO revisits(id,owner_id,edition_id,session_id,note_enc,key_version,created_at,current_revision,updated_at) VALUES(?,?,?,?,'current-revisit-bytes',1,1,2,2)",
  note,
  OWNER,
  parent,
  plan.sessionId,
);
add(
  "INSERT INTO revisit_revisions(revisit_id,owner_id,revision,body_enc,key_version,created_at) VALUES(?,?,1,'earlier-revisit-bytes',1,1)",
  note,
  OWNER,
);
add(
  "INSERT INTO context_grants(id,owner_id,revisit_id,revisit_revision,state,created_at,updated_at) VALUES(?,?,?,2,'allowed',1,1)",
  crypto.randomUUID(),
  OWNER,
  note,
);
add(
  "INSERT INTO import_identities(owner_id,source_key_hmac,source_entity_hmac,original_hmac,session_id,entity_kind,revisit_id,source_record_enc,key_version) VALUES(?,'source','entity','original',?,'revisit',?,'import-provenance-bytes',1)",
  OWNER,
  plan.sessionId,
  note,
);
for (const withdrawn of [false, true]) {
  const session = crypto.randomUUID();
  add(
    "INSERT INTO reading_sessions(id,owner_id,status,question_enc,created_at,saved_at) VALUES(?,?,'saved','imported-question',1,1)",
    session,
    OWNER,
  );
  add(
    "INSERT INTO reading_editions(id,owner_id,session_id,edition_number,status,mode,body_enc,key_version,accepted_at,invalidated_at) VALUES(?,?,?,1,?,'legacy',?,1,1,?)",
    crypto.randomUUID(),
    OWNER,
    session,
    withdrawn ? 'withdrawn' : 'imported',
    withdrawn ? null : 'imported-bytes',
    withdrawn ? 2 : null,
  );
}
const [output] = process.argv.slice(2);
if (!output) throw Error('Usage: tsx scripts/qualification/prepare-d1.ts OUTPUT_JSON');
writeFileSync(
  output,
  JSON.stringify(
    {
      batches,
      owner: OWNER,
      other: OTHER,
      plan,
      editions,
      migration: readFileSync('src/worker/db/migrations/0021_astrology_pattern.sql', 'utf8'),
    },
    null,
    2,
  ),
);
