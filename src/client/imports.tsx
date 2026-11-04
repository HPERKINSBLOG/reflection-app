import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { apiSchemas, Id, ImportSource } from '../contracts/index.ts';
import { IMPORT_LIMITS } from '../contracts/import-policy.ts';
import { parseImportFile } from '../domain/imports/parse.ts';
import { decodeImportBytes, readJson } from '../domain/imports/json.ts';
import { importLabel } from '../domain/imports/review.ts';
import { buildImportGroups } from '../domain/imports/chunks.ts';
import type { ImportGroup, NormalizedImport, Recovery, Source } from '../domain/imports/types.ts';
import { api, ApiFailure } from './api.ts';
import { Button } from './design/components.tsx';

const formats = [
  ['tarot-json', 'Tarot journal'],
  ['patternlike-export', 'Patternlike 0.7.0 or 0.8.0'],
  ['reflection-import.v1', 'Canonical reading archive'],
  ['reflection-export.v1', 'Reflection export (NDJSON)'],
  ['pixel-json', 'Native Pixel'],
] as const;
type Review = {
  group: Pick<ImportGroup, 'id' | 'unresolved'>;
  recovery: Recovery;
  items: (z.infer<typeof apiSchemas.ImportPreview>['items'][number] & { label?: string })[];
  status: z.infer<typeof apiSchemas.ImportGroupStatus>;
  key: string;
};
type Progress = {
  status: z.infer<typeof apiSchemas.ImportGroupStatus>;
  items: z.infer<typeof apiSchemas.ImportGroupResultPage>['items'];
};
async function defaultDataset(owner: string, format: string) {
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(['reflection-journal-source.v1', owner, format])),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '5' + hash.slice(13, 16),
    'a' + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}
export function ImportRecords({
  owner,
  csrf,
  onExpired,
}: {
  owner: string;
  csrf: string;
  onExpired: () => void;
}) {
  const [open, setOpen] = useState(false),
    heading = useRef<HTMLHeadingElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  const [format, setFormat] = useState<string>('tarot-json'),
    [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<NormalizedImport | null>(null),
    [selected, setSelected] = useState<string[]>([]);
  const [namespace, setNamespace] = useState(''),
    [sourceRevision, setSourceRevision] = useState('original'),
    [recoveryMode, setRecoveryMode] = useState<Recovery['kind']>('none');
  const [newRevision, setNewRevision] = useState(''),
    [freshNamespace, setFreshNamespace] = useState('');
  const [visible, setVisible] = useState(25);
  const [reviews, setReviews] = useState<Review[]>([]),
    [progress, setProgress] = useState<Progress | null>(null);
  const [resumeId, setResumeId] = useState(''),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    active = useRef(false),
    operation = useRef(0);
  useEffect(
    () => () => {
      operation.current++;
    },
    [],
  );
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);
  const clearReview = () => {
    setSelected([]);
    setVisible(25);
    setReviews([]);
    setProgress(null);
    setMessage('');
    setError('');
  };
  const reset = () => {
    setParsed(null);
    clearReview();
  };
  const run = async (work: (current: () => boolean) => Promise<void>) => {
    if (active.current) return;
    active.current = true;
    const id = ++operation.current;
    const current = () => id === operation.current;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work(current);
    } catch (e) {
      if (current()) {
        if (e instanceof ApiFailure && e.status === 401) {
          onExpired();
          return;
        }
        setError(
          e instanceof ApiFailure
            ? e.message
            : e instanceof Error && !e.message.startsWith('IMPORT_')
              ? e.message
              : 'We could not read this file in the selected format. Check its version and format.',
        );
      }
    } finally {
      if (current()) {
        active.current = false;
        setBusy(false);
      }
    }
  };
  const read = () =>
    run(async (current) => {
      reset();
      if (!file || file.size > IMPORT_LIMITS.fileBytes)
        throw new Error('Choose a file of 32 MiB or less.');
      const document = decodeImportBytes(new Uint8Array(await file.arrayBuffer()));
      let source: Source = {
        namespaceId: namespace.trim() || (await defaultDataset(owner, format)),
        revision: sourceRevision,
      };
      if (format === 'reflection-import.v1') {
        const envelope = readJson(document).value as {
          records?: Array<{ identity?: { source?: unknown } }>;
        };
        source = ImportSource.parse(envelope?.records?.[0]?.identity?.source);
      }
      const result = await parseImportFile({
        format,
        document,
        source: ImportSource.parse(source),
        recovery: { kind: 'none' },
      });
      if (!current()) return;
      setParsed(result);
      setMessage(
        `${result.units.length} records available for review. ${result.errors.length} invalid.`,
      );
    });
  const review = () =>
    run(async (current) => {
      if (!parsed) return;
      const units = parsed.units.filter((u) => selected.includes(u.key));
      const groups = await buildImportGroups(units, () => crypto.randomUUID());
      const collected: Review[] = [];
      for (const group of groups) {
        if (!current()) return;
        const original = group.units[0]!.identity.source;
        const recovery: Recovery =
          recoveryMode === 'none'
            ? { kind: 'none' }
            : { kind: recoveryMode, previousSource: original };
        const source = ImportSource.parse(
          recoveryMode === 'new_revision'
            ? { ...original, revision: newRevision }
            : recoveryMode === 'reimport_erased'
              ? { namespaceId: freshNamespace, revision: newRevision || original.revision }
              : original,
        );
        setResumeId(group.id);
        const items: Review['items'] = [];
        for (const chunk of group.chunks) {
          const preview = await api(
            '/imports',
            apiSchemas.ImportPreview,
            { ...chunk, source, recovery },
            csrf,
            { key: crypto.randomUUID() },
          );
          if (!current()) return;
          items.push(...preview.items);
        }
        const status = await api('/imports/groups/' + group.id, apiSchemas.ImportGroupStatus);
        collected.push({ group, recovery, items, status, key: crypto.randomUUID() });
        if (!current()) return;
        setReviews([...collected]);
        setResumeId(group.id);
      }
      setMessage('Review each group before confirming. The encrypted preview expires in 24 hours.');
    });
  async function reconcile(id: string, current: () => boolean) {
    const status = await api('/imports/groups/' + id, apiSchemas.ImportGroupStatus);
    const items: Progress['items'] = [];
    if (status.state === 'staged') {
      const previewItems: Review['items'] = [];
      let recovery: Recovery = { kind: 'none' },
        cursor: string | null = null;
      do {
        const page: z.infer<typeof apiSchemas.ImportReviewPage> = await api(
          '/imports/groups/' +
            id +
            '/review' +
            (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
          apiSchemas.ImportReviewPage,
        );
        if (!current()) return;
        previewItems.push(...page.items);
        recovery = page.recovery;
        cursor = page.nextCursor;
      } while (cursor);
      setReviews((previous) => [
        ...previous.filter((r) => r.group.id !== id),
        {
          group: { id, unresolved: [] },
          recovery,
          items: previewItems,
          status,
          key: crypto.randomUUID(),
        },
      ]);
    }
    if (status.state === 'complete' || status.state === 'failed') {
      let cursor: string | null = null;
      do {
        const page: z.infer<typeof apiSchemas.ImportGroupResultPage> = await api(
          '/imports/groups/' +
            id +
            '/results' +
            (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
          apiSchemas.ImportGroupResultPage,
        );
        if (!current()) return;
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
    }
    if (!current()) return;
    setReviews((rs) => rs.map((r) => (r.group.id === id ? { ...r, status } : r)));
    setProgress({ status, items });
    setResumeId(id);
    setMessage(status.state === 'complete' ? 'Group complete.' : 'Group ' + status.state + '.');
  }
  const commit = (r: Pick<Review, 'key' | 'status' | 'recovery'>) =>
    run(async (current) => {
      const id = r.status.groupId;
      setResumeId(id);
      if (!r.status.previewHash) return;
      try {
        await api(
          '/imports/groups/' + id + '/commit',
          apiSchemas.ImportGroupStatus,
          {
            version: 'import-group.v1',
            manifestHash: r.status.manifestHash,
            previewHash: r.status.previewHash,
            confirmedRecovery: r.recovery,
          },
          csrf,
          { key: r.key },
        );
      } catch (e) {
        if (e instanceof ApiFailure && e.status < 500) throw e;
      }
      if (current()) await reconcile(id, current);
    });
  function close() {
    operation.current++;
    active.current = false;
    setBusy(false);
    setOpen(false);
    setFile(null);
    reset();
    setResumeId('');
    setFreshNamespace('');
    setRecoveryMode('none');
    requestAnimationFrame(() => opener.current?.focus());
  }
  return (
    <div className="import-tools">
      {!open && (
        <Button ref={opener} type="button" variant="secondary" onClick={() => setOpen(true)}>
          Import records
        </Button>
      )}
      {open && (
        <section id="import-review" aria-labelledby="import-title">
          <h3 id="import-title" ref={heading} tabIndex={-1}>
            Review an import
          </h3>
          <p>
            Choose records from a journal or an earlier export. Saved imports are private and work
            with AI readings off.
          </p>
          <fieldset disabled={busy}>
            <legend>Choose a file</legend>
            <label>
              File format
              <select
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value);
                  reset();
                }}
              >
                {formats.map(([v, t]) => (
                  <option value={v} key={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {format === 'pixel-json' && (
              <p>Native Pixel files are unsupported. Choose a supported export to continue.</p>
            )}
            <label>
              Import file
              <input
                type="file"
                accept=".json,.ndjson,application/json,application/x-ndjson"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  reset();
                }}
              />
            </label>
            <p>
              UTF-8 JSON or NDJSON, up to 32 MiB. Only the records you select will be uploaded for
              review.
            </p>
            {(format === 'tarot-json' || format === 'patternlike-export') && (
              <details>
                <summary>Dataset identity</summary>
                <p>
                  The default identifies your {format === 'tarot-json' ? 'Tarot' : 'Patternlike'}{' '}
                  journal in this account. Use the same namespace and revision for overlapping
                  backups.
                </p>
                <label>
                  Dataset namespace (optional)
                  <input
                    value={namespace}
                    onChange={(e) => {
                      setNamespace(e.target.value);
                      reset();
                    }}
                  />
                </label>
                <label>
                  Dataset revision
                  <input
                    value={sourceRevision}
                    onChange={(e) => {
                      setSourceRevision(e.target.value);
                      reset();
                    }}
                  />
                </label>
              </details>
            )}
            <Button type="button" disabled={!file || format === 'pixel-json'} onClick={read}>
              Read file
            </Button>
          </fieldset>
          {parsed && (
            <fieldset disabled={busy}>
              <legend>Records in the file</legend>
              {parsed.errors.map((e) => (
                <p key={e.pointer}>
                  {e.pointer} · Invalid record ({e.code})
                </p>
              ))}
              {parsed.units.slice(0, visible).map((u) => (
                <label className="import-choice" key={u.key}>
                  <input
                    type="checkbox"
                    checked={selected.includes(u.key)}
                    onChange={(e) => {
                      setSelected((prev) =>
                        e.target.checked ? [...prev, u.key] : prev.filter((k) => k !== u.key),
                      );
                      setReviews([]);
                      setProgress(null);
                    }}
                  />
                  <span>
                    <strong>{importLabel(u)}</strong>
                    <small>
                      {u.identity.kind} · {u.sourcePointer} · Revision {u.identity.recordRevision}
                    </small>
                    {u.kind === 'legacy-reading' && (
                      <small>
                        {u.record.originalTimestamp ?? 'Original date unavailable'} ·{' '}
                        {u.record.source} · {u.record.generatedText ?? 'Interpretation unavailable'}
                      </small>
                    )}
                    {u.kind === 'legacy-authored' && <small>{u.record.text}</small>}
                    {u.dependencies.length > 0 && (
                      <small>
                        Needs {u.dependencies.map((d) => d.kind + ' ' + d.recordId).join(', ')}
                      </small>
                    )}
                  </span>
                </label>
              ))}
              {visible < parsed.units.length && (
                <Button type="button" variant="secondary" onClick={() => setVisible((n) => n + 25)}>
                  Show more records
                </Button>
              )}
              <details>
                <summary>Resolve a conflict or erased record</summary>
                <label>
                  Recovery action
                  <select
                    value={recoveryMode}
                    onChange={(e) => {
                      const v = e.target.value as Recovery['kind'];
                      setRecoveryMode(v);
                      setReviews([]);
                      setProgress(null);
                      if (v === 'reimport_erased' && !freshNamespace)
                        setFreshNamespace(crypto.randomUUID());
                    }}
                  >
                    <option value="none">Keep existing records</option>
                    <option value="new_revision">Confirm a new source revision</option>
                    <option value="reimport_erased">Recreate in a new namespace</option>
                  </select>
                </label>
                {recoveryMode === 'new_revision' && (
                  <label>
                    New source revision
                    <input
                      value={newRevision}
                      onChange={(e) => {
                        setNewRevision(e.target.value);
                        setReviews([]);
                      }}
                    />
                  </label>
                )}
                {recoveryMode === 'reimport_erased' && (
                  <p>
                    Explicit recreation uses new namespace {freshNamespace}. Review it before
                    confirming the group.
                  </p>
                )}
              </details>
              <Button type="button" disabled={!selected.length} onClick={review}>
                Review selected records
              </Button>
            </fieldset>
          )}
          {reviews.map((r, i) => (
            <section className="import-group" key={r.group.id}>
              <h4>Group {i + 1}</h4>
              <p>
                {r.status.totalItems} selected · {r.status.state} · Import ID {r.group.id}
              </p>
              <ul>
                {r.items.map((item, j) => (
                  <li
                    key={
                      item.identity ? JSON.stringify(item.identity) : `${item.index}:${item.error}`
                    }
                  >
                    {item.label ?? item.originalId ?? 'Item ' + (j + 1)} · {item.status}
                    {item.error && ' · ' + item.error}
                  </li>
                ))}
              </ul>
              {r.recovery.kind !== 'none' && (
                <p>
                  {r.recovery.kind === 'new_revision'
                    ? 'New source revision'
                    : 'Recreation in a new namespace'}{' '}
                  · Previous source {r.recovery.previousSource.namespaceId}, revision{' '}
                  {r.recovery.previousSource.revision}
                </p>
              )}
              {r.group.unresolved.length > 0 && (
                <p>External dependencies require an exact existing record.</p>
              )}
              {r.status.state === 'staged' && (
                <Button
                  type="button"
                  onClick={() => commit(r)}
                  disabled={
                    busy ||
                    !r.status.previewHash ||
                    r.items.some((x) => !['ready', 'duplicate'].includes(x.status))
                  }
                >
                  Confirm this group
                </Button>
              )}
            </section>
          ))}
          {reviews.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setReviews([]);
                setProgress(null);
                setMessage('Remaining groups cancelled. Completed groups stay saved.');
              }}
            >
              Cancel remaining groups
            </Button>
          )}
          <fieldset disabled={busy}>
            <legend>Resume an import</legend>
            <label>
              Import ID
              <input
                value={resumeId}
                onChange={(e) => {
                  setResumeId(e.target.value);
                  setProgress(null);
                }}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              disabled={!Id.safeParse(resumeId.trim()).success}
              onClick={() => run((current) => reconcile(resumeId.trim(), current))}
            >
              Check import status
            </Button>
            {progress && (
              <p>
                {progress.status.completedItems} of {progress.status.totalItems} completed.{' '}
                {progress.items.filter((i) => i.status === 'duplicate').length} duplicates skipped.
              </p>
            )}
          </fieldset>
          {busy && <p role="status">Checking the import…</p>}
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
          <Button type="button" variant="secondary" onClick={close}>
            Close import
          </Button>
        </section>
      )}
    </div>
  );
}
