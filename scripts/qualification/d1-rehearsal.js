/** Run against a NEW database already migrated through 0020. No account secrets. */
export default async function run(query, fixture) {
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const equal = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message);
  const rows = async (sql, params = []) => (await query({ sql, params }))[0].results;
  await query({ batch: fixture.batches });
  const tables = ['basis_snapshots', 'reading_editions', 'reflections', 'reflection_revisions', 'revisits', 'revisit_revisions', 'context_grants', 'generation_requests', 'generation_attempts', 'import_identities'];
  const read = async () => {
    const result = {};
    for (const name of tables) result[name] = await rows(`SELECT * FROM ${name} ORDER BY rowid`);
    return result;
  };
  const before = await read();
  const storage = await rows('SELECT id,storage_bytes FROM accounts ORDER BY id');
  const marker = 'DROP TABLE reading_editions;';
  check(fixture.migration.includes(marker), 'Rollback injection point missing');
  let rejected = false;
  try { await query({ sql: fixture.migration.replace(marker, `${marker}\nINSERT INTO assertion_probe VALUES(0);`) }); }
  catch { rejected = true; }
  check(rejected, 'Injected migration must fail');
  equal(await read(), before, 'Failed migration did not roll back original rows');
  equal(await rows('SELECT id,storage_bytes FROM accounts ORDER BY id'), storage, 'Failed migration changed accounting');
  check(!(await rows("SELECT name FROM sqlite_master WHERE name='pattern_content_releases'")).length, 'Failed migration left its new table');
  await query({ sql: fixture.migration });
  const after = await read();
  for (const name of tables) {
    equal(after[name].length, before[name].length, `${name} row count`);
    before[name].forEach((row, i) => { for (const key of Object.keys(row)) equal(after[name][i][key], row[key], `${name}.${key} changed`); });
  }
  equal(await rows('SELECT id,storage_bytes FROM accounts ORDER BY id'), storage, 'Migration changed accounting');
  equal(await rows('PRAGMA foreign_key_check'), [], 'Migration foreign key violations');
  const imported = await rows("SELECT count(*) n FROM reading_sessions WHERE method='imported'");
  equal(imported[0].n, 2, 'Imported and withdrawn families should retain imported identity');
  const session = crypto.randomUUID(), basis = crypto.randomUUID(), edition = crypto.randomUUID(), release = 'd'.repeat(64);
  await query({ batch: [
    {sql:"INSERT INTO pattern_content_releases(hash,state,release_json,created_at) VALUES(?,'active','synthetic-catalogue-not-a-content-approval',1)",params:[release]},
    {sql:"INSERT INTO reading_sessions(id,owner_id,status,method,question_enc,created_at,saved_at) VALUES(?,?,'saved','astrology','chapter-title',1,1)",params:[session,fixture.owner]},
    {sql:"INSERT INTO basis_snapshots(id,owner_id,session_id,kind,schema_version,body_enc,key_version,created_at) VALUES(?,?,?,'astrology.natal.v2',2,'synthetic-basis-bytes',1,1)",params:[basis,fixture.owner,session]}
  ]});
  const insert = (owner, basisId, contentHash, parentId = null) => query({sql:"INSERT INTO reading_editions(id,owner_id,session_id,edition_number,basis_id,status,mode,body_enc,key_version,pattern_content_hash,parent_edition_id,accepted_at) VALUES(?,?,?,1,?,'accepted','pattern','synthetic-pattern-bytes',1,?,?,1)",params:[edition,owner,session,basisId,contentHash,parentId]});
  let constraints = 0;
  for (const args of [[fixture.other,basis,release],[fixture.owner,null,release],[fixture.owner,fixture.plan.basisId,release],[fixture.owner,basis,null],[fixture.owner,basis,release,fixture.editions[0]]]) {
    let failed = false; try { await insert(...args); } catch { failed = true; }
    check(failed, 'Invalid Pattern association accepted'); constraints++;
  }
  await insert(fixture.owner,basis,release);
  for (const command of [
    {sql:"UPDATE basis_snapshots SET kind='tarot.v1',schema_version=1 WHERE id=?",params:[basis]},
    {sql:"UPDATE reading_sessions SET method='tarot' WHERE id=?",params:[session]}
  ]) {
    let failed = false; try { await query(command); } catch { failed = true; }
    check(failed, 'Pattern method could be changed'); constraints++;
  }
  equal(await rows('PRAGMA foreign_key_check'), [], 'Final foreign key violations');
  equal((await rows('SELECT count(*) n FROM pattern_state WHERE enabled=1'))[0].n, 0, 'Migration activated Pattern');
  return {kind:'pattern.hosted-migration-rehearsal.v1',generatedAt:new Date().toISOString(),rollbackPassed:true,preservationPassed:true,tables:Object.fromEntries(tables.map(name=>[name,before[name].length])),storage,importedFamilies:2,invalidAssociationsRejected:constraints,validPatternInserted:true,foreignKeyViolations:0,publicationEnabled:false,limitations:['Synthetic placeholder ciphertext tests exact-byte preservation, not encryption or full application recovery.','No existing preview data was accessed.','This is a same-account isolated D1 rehearsal, not the distinct-account hosted recovery gate.']};
}
