import { BirthProfileV1 } from '../../src/contracts/astrology.ts';
import { canonicalJson } from '../../src/domain/json.ts';
import type { RecordBase } from '../../src/worker/readings/base.ts';
import type { Session } from '../../src/worker/identity/types.ts';
import { patternFixture } from './pattern.ts';

export async function seedPattern(base: RecordBase, session: Session) {
  const { reading, release } = await patternFixture();
  const owner = session.subjectId,
    now = Date.now();
  const profile = BirthProfileV1.parse({
    kind: 'birth.profile.v1',
    id: reading.basis.profileId,
    revision: 1,
    birth: reading.basis.calculation.input.birth,
    resolved: reading.basis.calculation.resolved,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  });
  const seal = (table: string, id: string, value: unknown) =>
    base.crypt.seal(
      { ownerId: owner, table, column: 'body_enc', recordId: id, aadRevision: 1 },
      value,
      1,
    );
  const questionEnc = await base.crypt.seal(
    {
      ownerId: owner,
      table: 'reading_sessions',
      column: 'question_enc',
      recordId: reading.sessionId,
      aadRevision: 1,
    },
    { v: 1, text: reading.chapter.prompt },
    1,
  );
  const profileEnc = await seal('birth_profiles', profile.id, profile);
  const basisEnc = await seal('basis_snapshots', reading.basis.basisId, reading.basis);
  const readingEnc = await seal('reading_editions', reading.editionId, reading);
  const sourceHmac = await base.crypt.hash(owner, 'pattern-source.v1', [
    profile.revision,
    reading.basis.semanticHash,
    release.releaseHash,
    reading.chapter.id,
  ]);
  await base.atomic(session, [
    base.db
      .prepare(
        "INSERT OR IGNORE INTO pattern_content_releases(hash,state,release_json,created_at) VALUES(?,'active',?,?)",
      )
      .bind(release.releaseHash, canonicalJson(release), now),
    base.db
      .prepare(
        'INSERT INTO birth_profiles(owner_id,id,revision,body_enc,key_version,created_at,updated_at) VALUES(?,?,1,?,1,?,?)',
      )
      .bind(owner, profile.id, profileEnc, now, now),
    base.db
      .prepare(
        "INSERT INTO reading_sessions(id,owner_id,status,revision,created_at,saved_at,method,question_enc) VALUES(?,?,'saved',1,?,?,'astrology',?)",
      )
      .bind(reading.sessionId, owner, now, now, questionEnc),
    base.db
      .prepare(
        "INSERT INTO basis_snapshots(id,owner_id,session_id,kind,schema_version,body_enc,key_version,created_at) VALUES(?,?,?,'astrology.natal.v2',2,?,1,?)",
      )
      .bind(reading.basis.basisId, owner, reading.sessionId, basisEnc, now),
    base.db
      .prepare(
        "INSERT INTO reading_editions(id,owner_id,session_id,edition_number,basis_id,status,mode,body_enc,key_version,pattern_content_hash,accepted_at) VALUES(?,?,?,1,?,'accepted','pattern',?,1,?,?)",
      )
      .bind(
        reading.editionId,
        owner,
        reading.sessionId,
        reading.basis.basisId,
        readingEnc,
        release.releaseHash,
        now,
      ),
    base.db
      .prepare(
        'INSERT INTO pattern_saved_sources(owner_id,source_hmac,session_id,edition_id,key_version,created_at) VALUES(?,?,?,?,1,?)',
      )
      .bind(owner, sourceHmac, reading.sessionId, reading.editionId, now),
    base.db
      .prepare(
        'INSERT INTO astrology_admissions(owner_id,quota_day,input_hmac,key_version,created_at,expires_at) VALUES(?,?,?,1,?,?)',
      )
      .bind(owner, new Date(now).toISOString().slice(0, 10), sourceHmac, now, now + 86400000),
  ]);
  return { reading, profile, release };
}
