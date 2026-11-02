import { canonicalJson } from '../json.ts';
import type { Identity } from './types.ts';
export const importKeyInput = (id: Identity) =>
  [
    'import-key.v1',
    id.source.namespaceId,
    id.source.revision,
    id.kind,
    id.recordId,
    id.recordRevision,
  ] as const;
export const importEntityInput = (id: Identity) =>
  ['import-entity.v1', id.source.namespaceId, id.kind, id.recordId, id.recordRevision] as const;
/** Transport key only; persistence uses account-key HMAC over importKeyInput. */
export const identityKey = (id: Identity) => canonicalJson(importKeyInput(id));
export const sameSource = (a: Identity['source'], b: Identity['source']) =>
  a.namespaceId === b.namespaceId && a.revision === b.revision;
