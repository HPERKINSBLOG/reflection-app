import {
  PatternPreview,
  PatternSaveInput,
  PatternReadingV1,
  PatternSavedIdentity,
  PatternContentRelease,
  type AstrologyBasisV2,
} from '../../contracts/astrology.ts';
import { Reflection } from '../../contracts/index.ts';
import { calculateNatal, CALCULATION_IDENTITY } from '../../domain/astrology/calculate.ts';
import { semanticBasisHash } from '../../domain/astrology/identity.ts';
import { buildPatternChapters, syntheticPatternRelease } from '../../domain/astrology/chapters.ts';
import { canonicalJson, sha256Json } from '../../domain/json.ts';
import catalogue from '../../../content/pattern-draft.json';
import { BirthProfiles } from './profiles.ts';
import { AstrologyAdmission } from './admission.ts';
import type { Session } from '../identity/types.ts';
import { type RecordBase, RecordError, iso } from '../readings/base.ts';
import { statement as q } from '../db/core.ts';
import { assertion } from '../identity/checkpoint.ts';

type State = {
  content_hash: string;
  revision: number;
  enabled: number;
  calculation_hash: string;
  release_json: string;
  state: string;
};
export class PatternConflict extends RecordError {
  constructor(readonly existing: PatternSavedIdentity) {
    super(409, 'CONFLICT');
  }
}
export class Patterns {
  readonly profiles: BirthProfiles;
  constructor(
    readonly base: RecordBase,
    readonly options: { allowSynthetic?: boolean } = {},
  ) {
    this.profiles = new BirthProfiles(base);
  }
  private async content() {
    // This local bootstrap cannot enable a restored/disabled row or reactivate withdrawn content.
    if (this.options.allowSynthetic) {
      const release = await syntheticPatternRelease(catalogue);
      await this.base.db.batch([
        q(
          this.base.db,
          "INSERT OR IGNORE INTO pattern_content_releases(hash,state,release_json,created_at) VALUES(?,'active',?,?)",
          release.releaseHash,
          canonicalJson(release),
          Date.now(),
        ),
        q(
          this.base.db,
          'INSERT OR IGNORE INTO pattern_state(id,content_hash,revision,enabled,calculation_hash,updated_at) VALUES(1,?,1,1,?,?)',
          release.releaseHash,
          await sha256Json(CALCULATION_IDENTITY),
          Date.now(),
        ),
      ]);
    }
    const row = await q(
      this.base.db,
      'SELECT s.*,p.release_json,p.state FROM pattern_state s JOIN pattern_content_releases p ON p.hash=s.content_hash WHERE s.id=1',
    ).first<State>();
    // Hosted activation remains closed pending exact editorial and numerical qualification.
    if (
      !this.options.allowSynthetic ||
      !row ||
      !row.enabled ||
      row.state !== 'active' ||
      row.calculation_hash !== (await sha256Json(CALCULATION_IDENTITY))
    )
      throw new RecordError(410, 'CONTENT_UNAVAILABLE');
    const release = PatternContentRelease.parse(JSON.parse(row.release_json));
    if (release.releaseHash !== row.content_hash || release.review.kind !== 'synthetic_local')
      throw new RecordError(410, 'CONTENT_UNAVAILABLE');
    return { row, release };
  }
  private contentGuard(state: State) {
    return assertion(
      this.base.db,
      "EXISTS(SELECT 1 FROM pattern_state s JOIN pattern_content_releases p ON p.hash=s.content_hash WHERE s.id=1 AND s.enabled=1 AND s.revision=? AND s.content_hash=? AND s.calculation_hash=? AND p.state='active')",
      state.revision,
      state.content_hash,
      state.calculation_hash,
    );
  }
  private source(
    session: Session,
    p: Pick<PatternPreview, 'profileRevision' | 'basisHash' | 'releaseHash'>,
    chapter: string,
  ) {
    return this.base.crypt.hash(session.subjectId, 'pattern-source.v1', [
      p.profileRevision,
      p.basisHash,
      p.releaseHash,
      chapter,
    ]);
  }
  private async existing(session: Session, hash: string): Promise<PatternSavedIdentity | null> {
    const row = await q(
      this.base.db,
      "SELECT x.session_id AS sessionId,x.edition_id AS editionId,(SELECT id FROM reflections WHERE owner_id=x.owner_id AND edition_id=x.edition_id ORDER BY rowid LIMIT 1) AS reflectionId FROM pattern_saved_sources x JOIN reading_sessions s ON s.owner_id=x.owner_id AND s.id=x.session_id JOIN reading_editions e ON e.owner_id=x.owner_id AND e.id=x.edition_id WHERE x.owner_id=? AND x.source_hmac=? AND s.status!='deleted' AND e.status!='deleted'",
      session.subjectId,
      hash,
    ).first();
    return row ? PatternSavedIdentity.parse(row) : null;
  }
  private async replay(session: Session, resource: string) {
    const [sessionId, editionId, reflectionId] = resource.split(':');
    const value = PatternSavedIdentity.parse({
      sessionId,
      editionId,
      reflectionId: reflectionId || null,
    });
    await this.base.ownedSession(session, value.sessionId);
    if (
      !(await q(
        this.base.db,
        "SELECT 1 FROM reading_editions WHERE owner_id=? AND id=? AND session_id=? AND mode='pattern' AND status!='deleted'",
        session.subjectId,
        editionId!,
        sessionId!,
      ).first())
    )
      throw new RecordError(410, 'CONTENT_UNAVAILABLE');
    await this.base.checked(session, undefined, [this.base.sessionGuard(session, value.sessionId)]);
    return value;
  }
  private async calculated(session: Session) {
    const account = await this.base.account(session);
    if (!account.recovery_ack_at) throw new RecordError(403, 'FORBIDDEN');
    const { profile } = await this.profiles.read(session);
    if (!profile) throw new RecordError(404, 'NOT_FOUND');
    const { row, release } = await this.content();
    const input = {
      kind: 'astrology.natal.v2' as const,
      birth: profile.birth,
      calendar: 'gregorian' as const,
      zodiac: 'tropical' as const,
      houses: 'not_calculated' as const,
    };
    await new AstrologyAdmission(this.base).admit(session, {
      input,
      resolved: profile.resolved,
      identity: CALCULATION_IDENTITY,
    });
    const calculation = calculateNatal(input, profile.resolved, CALCULATION_IDENTITY);
    if (calculation.kind !== 'calculated') throw new RecordError(410, 'CONTENT_UNAVAILABLE');
    const basis: AstrologyBasisV2 = {
      kind: 'astrology.natal.v2',
      schemaVersion: 2,
      basisId: crypto.randomUUID(),
      calculationId: crypto.randomUUID(),
      profileId: profile.id,
      profileRevision: profile.revision,
      calculatedAt: iso(Date.now()),
      semanticHash: await semanticBasisHash(calculation),
      calculation,
    };
    const preview = PatternPreview.parse({
      profileRevision: profile.revision,
      basisHash: basis.semanticHash,
      releaseHash: release.releaseHash,
      basis,
      chapters: await buildPatternChapters(basis, release, this.options),
      saved: [],
    });
    for (const state of preview.chapters) {
      const chapter = state.status === 'available' ? state.chapter.id : state.id;
      const saved = await this.existing(session, await this.source(session, preview, chapter));
      if (saved) preview.saved.push({ ...saved, chapterId: chapter });
    }
    await this.base.checked(session, undefined, [
      this.profiles.guard(session, profile.revision),
      this.contentGuard(row),
    ]);
    return { preview, content: row, account };
  }
  async preview(session: Session) {
    return (await this.calculated(session)).preview;
  }
  async save(session: Session, raw: PatternSaveInput, key: string): Promise<PatternSavedIdentity> {
    const input = PatternSaveInput.parse(raw);
    await this.base.account(session);
    const mutation = await this.base.mutation(session, key, 'pattern.save', input);
    if (mutation.existing) return this.replay(session, mutation.existing);
    const { preview, content, account } = await this.calculated(session);
    if (
      preview.profileRevision !== input.expectedProfileRevision ||
      preview.basisHash !== input.basisHash ||
      preview.releaseHash !== input.releaseHash
    )
      throw new RecordError(409, 'CONFLICT', preview.profileRevision);
    const chapter = preview.chapters.find(
      (c) => c.status === 'available' && c.chapter.id === input.chapterId,
    );
    if (!chapter || chapter.status !== 'available')
      throw new RecordError(410, 'CONTENT_UNAVAILABLE');
    const hash = await this.source(session, preview, input.chapterId),
      writing = input.reflection?.text.trim() ? input.reflection : null;
    const already = await this.existing(session, hash);
    if (already) {
      if (writing) throw new PatternConflict(already);
      await this.base.atomic(session, [
        this.profiles.guard(session, preview.profileRevision),
        this.contentGuard(content),
        this.base.sessionGuard(session, already.sessionId),
        mutation.insert(`${already.sessionId}:${already.editionId}:${already.reflectionId ?? ''}`),
      ]);
      return already;
    }
    const sessionId = crypto.randomUUID(),
      editionId = crypto.randomUUID(),
      reflectionId = writing ? crypto.randomUUID() : null,
      now = Date.now();
    const reading = PatternReadingV1.parse({
      kind: 'astrology.pattern.accepted.v1',
      sessionId,
      editionId,
      editionNumber: 1,
      parentEditionId: null,
      basis: preview.basis,
      chapter: chapter.chapter,
      acceptedAt: iso(now),
    });
    const seal = (table: string, column: string, id: string, value: unknown) =>
      this.base.crypt.seal(
        { ownerId: session.subjectId, table, column, recordId: id, aadRevision: 1 },
        value,
        account.key_version,
      );
    const [question, basis, body, reflection] = await Promise.all([
      seal('reading_sessions', 'question_enc', sessionId, { v: 1, text: reading.chapter.prompt }),
      seal('basis_snapshots', 'body_enc', reading.basis.basisId, reading.basis),
      seal('reading_editions', 'body_enc', editionId, reading),
      writing
        ? seal(
            'reflection_revisions',
            'body_enc',
            `${reflectionId}:1`,
            Reflection.parse({
              id: reflectionId,
              sessionId,
              editionId,
              revision: 1,
              text: writing.text,
              stance: writing.stance,
              updatedAt: iso(now),
            }),
          )
        : null,
    ]);
    try {
      await this.base.atomic(session, [
        this.profiles.guard(session, preview.profileRevision),
        this.contentGuard(content),
        assertion(
          this.base.db,
          'EXISTS(SELECT 1 FROM accounts WHERE id=? AND recovery_ack_at IS NOT NULL AND key_version=?)',
          session.subjectId,
          account.key_version,
        ),
        q(
          this.base.db,
          "INSERT INTO reading_sessions(id,owner_id,status,revision,question_enc,created_at,saved_at,method) VALUES(?,?,'saved',1,?,?,?,'astrology')",
          sessionId,
          session.subjectId,
          question,
          now,
          now,
        ),
        q(
          this.base.db,
          "INSERT INTO basis_snapshots(id,owner_id,session_id,kind,schema_version,body_enc,key_version,created_at) VALUES(?,?,?,'astrology.natal.v2',2,?,?,?)",
          reading.basis.basisId,
          session.subjectId,
          sessionId,
          basis,
          account.key_version,
          now,
        ),
        q(
          this.base.db,
          "INSERT INTO reading_editions(id,owner_id,session_id,edition_number,basis_id,status,mode,body_enc,key_version,pattern_content_hash,accepted_at) VALUES(?,?,?,1,?,'accepted','pattern',?,?,?,?)",
          editionId,
          session.subjectId,
          sessionId,
          reading.basis.basisId,
          body,
          account.key_version,
          preview.releaseHash,
          now,
        ),
        q(
          this.base.db,
          'INSERT INTO pattern_saved_sources(owner_id,source_hmac,session_id,edition_id,key_version,created_at) VALUES(?,?,?,?,?,?)',
          session.subjectId,
          hash,
          sessionId,
          editionId,
          account.key_version,
          now,
        ),
        ...(reflectionId && reflection
          ? [
              q(
                this.base.db,
                'INSERT INTO reflections(id,owner_id,session_id,edition_id) VALUES(?,?,?,?)',
                reflectionId,
                session.subjectId,
                sessionId,
                editionId,
              ),
              q(
                this.base.db,
                'INSERT INTO reflection_revisions(reflection_id,owner_id,revision,body_enc,key_version,created_at) VALUES(?,?,1,?,?,?)',
                reflectionId,
                session.subjectId,
                reflection,
                account.key_version,
                now,
              ),
            ]
          : []),
        mutation.insert(`${sessionId}:${editionId}:${reflectionId ?? ''}`),
      ]);
    } catch (error) {
      await this.base.checked(session);
      const replay = await this.base.mutation(session, key, 'pattern.save', input);
      if (replay.existing) return this.replay(session, replay.existing);
      const raced = await this.existing(session, hash);
      if (raced) {
        if (writing) throw new PatternConflict(raced);
        return this.save(session, input, key);
      }
      const profile = await this.profiles.read(session);
      if (!profile.profile || profile.revision !== input.expectedProfileRevision)
        throw new RecordError(409, 'CONFLICT', profile.revision || null);
      await this.content();
      const requiredBytes =
        question.length +
        basis.length +
        body.length +
        (reflection?.length ?? 0) +
        1024 * (writing ? 7 : 5);
      if ((await this.base.account(session)).storage_bytes + requiredBytes > 20971520)
        throw new RecordError(409, 'STORAGE_LIMIT_EXCEEDED');
      if (error instanceof Error && /CHECK constraint/.test(error.message))
        throw new RecordError(409, 'CONFLICT', profile.revision);
      throw error;
    }
    return this.replay(session, `${sessionId}:${editionId}:${reflectionId ?? ''}`);
  }
}
