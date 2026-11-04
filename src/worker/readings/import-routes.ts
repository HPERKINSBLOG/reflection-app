import { apiSchemas, Id } from '../../contracts/index.ts';
import type { Session } from '../identity/types.ts';
import type { RecordBase } from './base.ts';
import { ReadingImports } from './imports.ts';

/** Called after same-origin authentication, CSRF, write fences, rate and streaming bounds. */
export async function importRoute(
  base: RecordBase,
  session: Session,
  method: string,
  path: string,
  cursor: string | null,
  body: unknown,
  key: () => string,
) {
  const service = new ReadingImports(base.db, base.identity);
  if (method === 'POST' && path === '/imports')
    return {
      value: await service.preview(session, key(), apiSchemas.ImportWrite.parse(body)),
      status: 201,
    };
  const group = path.match(/^\/imports\/groups\/([^/]+)(?:\/(commit|results|review))?$/);
  if (!group) return null;
  const id = Id.parse(group[1]);
  if (method === 'POST' && group[2] === 'commit')
    return {
      value: await service.commitGroup(
        session,
        id,
        key(),
        apiSchemas.ImportGroupCommit.parse(body),
      ),
      status: 200,
    };
  if (method === 'GET' && group[2] === 'review')
    return { value: await service.reviewPage(session, id, cursor), status: 200 };
  if (method === 'GET' && group[2] === 'results')
    return { value: await service.groupResults(session, id, cursor), status: 200 };
  if (method === 'GET' && !group[2])
    return { value: await service.groupStatus(session, id), status: 200 };
  return null;
}
