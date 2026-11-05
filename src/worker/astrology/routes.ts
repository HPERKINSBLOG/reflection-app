import { apiSchemas } from '../../contracts/index.ts';
import {
  BirthDraft,
  BirthProfileWrite,
  BirthPlaceSearch,
  BirthPlaceResults,
  PatternSaveInput,
  type PatternContentRelease,
} from '../../contracts/astrology.ts';
import { ASTROLOGY_LIMITS } from '../../contracts/astrology-policy.ts';
import type { Session } from '../identity/types.ts';
import type { SessionErasure } from '../readings/erasure.ts';
import { type RecordBase, RecordError } from '../readings/base.ts';
import { recordResponse } from '../readings/routes.ts';
import { BirthProfiles } from './profiles.ts';
import { Patterns } from './patterns.ts';
import { findBirthplaces } from './places.ts';

/** Runs only after the shared authenticated route's CSRF, fence, rate and body checks. */
export async function astrologyRoute(
  request: Request,
  base: RecordBase,
  session: Session,
  body: unknown,
  key: () => string,
  revision: () => number,
  erasure: SessionErasure,
  allowSynthetic: boolean,
  approvedPreviewRelease?: PatternContentRelease,
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace('/api/v1', ''),
    method = request.method;
  if (!path.startsWith('/astrology/')) return null;
  const profiles = new BirthProfiles(base),
    patterns = new Patterns(base, {
      allowSynthetic,
      ...(approvedPreviewRelease ? { approvedPreviewRelease } : {}),
    });
  if (method === 'GET' && path === '/astrology/profile')
    return recordResponse(await profiles.read(session));
  if (method === 'DELETE' && path === '/astrology/profile') {
    // The receipt must be replayable even after the current profile body is gone.
    const current = await base.db
      .prepare('SELECT id FROM birth_profiles WHERE owner_id=?')
      .bind(session.subjectId)
      .first<{ id: string }>();
    if (!current) throw new RecordError(404, 'NOT_FOUND');
    return recordResponse(
      await erasure.removeBirthProfile(
        session,
        current.id,
        revision(),
        key(),
        apiSchemas.DeleteRequest.parse(body),
      ),
      202,
    );
  }
  if (!allowSynthetic && !approvedPreviewRelease) throw new RecordError(410, 'CONTENT_UNAVAILABLE');
  if (method === 'POST' && path === '/astrology/places/search') {
    const { query } = BirthPlaceSearch.parse(body),
      length = [...query.trim()].length;
    if (
      length < ASTROLOGY_LIMITS.queryMinCodePoints ||
      length > ASTROLOGY_LIMITS.queryMaxCodePoints
    )
      throw new RecordError(400, 'BAD_INPUT');
    await base.checked(session);
    return recordResponse(BirthPlaceResults.parse({ items: await findBirthplaces(query) }));
  }
  if (method === 'POST' && path === '/astrology/birth/resolve') {
    await base.checked(session);
    return recordResponse(await profiles.resolve(BirthDraft.parse(body)));
  }
  if (method === 'PUT' && path === '/astrology/profile')
    return recordResponse(await profiles.write(session, BirthProfileWrite.parse(body), key()));
  if (method === 'GET' && path === '/astrology/pattern')
    return recordResponse(await patterns.preview(session));
  if (method === 'POST' && path === '/astrology/pattern/saves')
    return recordResponse(await patterns.save(session, PatternSaveInput.parse(body), key()), 201);
  throw new RecordError(404, 'NOT_FOUND');
}
