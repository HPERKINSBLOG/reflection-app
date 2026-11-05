import type { BirthDraft } from '../contracts/astrology.ts';
import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { apiSchemas, Id, ImportSource, ImportChunkDocument } from '../contracts/index.ts';
import { IMPORT_LIMITS } from '../contracts/import-policy.ts';
import { parseImportFile } from '../domain/imports/parse.ts';
import { decodeImportBytes, readJson } from '../domain/imports/json.ts';
import { importLabel } from '../domain/imports/review.ts';
import { buildImportGroups } from '../domain/imports/chunks.ts';
import type {
  ImportGroup,
  NormalizedImport,
  Recovery,
  Source,
  Unit,
} from '../domain/imports/types.ts';
import { api, ApiFailure } from './api.ts';
import { Button, TextLink } from './design/components.tsx';
import { date } from './date.ts';
import botanical from './design/art/import/botanical.png';
import './import-review.css';

const formats = [
  ['tarot-json', 'Tarot journal'],
  ['patternlike-export', 'Patternlike 0.7.0 or 0.8.0'],
  ['reflection-import.v1', 'Canonical reading archive'],
  ['reflection-export.v1', 'Reflection export v1 (NDJSON)'],
  ['reflection-export.v2', 'Reflection export v2 (NDJSON)'],
  ['pixel-json', 'Native Pixel'],
] as const;
type Review = {
  group: Pick<ImportGroup, 'id' | 'unresolved'>;
  recovery: Recovery;
  items: (z.infer<typeof apiSchemas.ImportPreview>['items'][number] & {
    label?: string;
    unit?: Unit;
  })[];
  status: z.infer<typeof apiSchemas.ImportGroupStatus>;
  key: string;
  failure?: string;
  results?: z.infer<typeof apiSchemas.ImportGroupResultPage>['items'];
};
type Progress = {
  status: z.infer<typeof apiSchemas.ImportGroupStatus>;
  items: z.infer<typeof apiSchemas.ImportGroupResultPage>['items'];
  saved: { title: string; path: string }[];
};

function unitDescription(unit: Unit) {
  if (unit.kind === 'legacy-reading') return 'Imported reading';
  if (unit.kind === 'legacy-authored') return 'Imported personal writing';
  return {
    session: 'Saved reading',
    reading: 'Reading edition',
    reflection: 'Your reflection',
    revisit: 'Your revisit note',
    generation_receipt: 'Historical generation receipt',
    permission: 'Historical AI permission',
    grant: 'Historical excerpt permission',
  }[unit.record.kind];
}
function originalDate(unit: Unit): string | null {
  if (unit.kind === 'legacy-reading' || unit.kind === 'legacy-authored')
    return (
      unit.record.originalTimestamp ??
      (unit.record.occurredAt ? date(unit.record.occurredAt) : null)
    );
  const record = unit.record;
  if (record.kind === 'session' || record.kind === 'generation_receipt')
    return date(record.value.createdAt);
  if (record.kind === 'reflection' || record.kind === 'revisit')
    return date('updatedAt' in record.value ? record.value.updatedAt : record.value.createdAt);
  if (record.kind !== 'reading') return null;
  const reading = record.value;
  if (reading.kind === 'legacy.imported.v1')
    return (
      reading.record.originalTimestamp ??
      (reading.record.occurredAt ? date(reading.record.occurredAt) : null)
    );
  return date(
    reading.kind === 'reading.unavailable.v1' ? reading.unavailableAt : reading.acceptedAt,
  );
}
function groupPrimary(review: Review) {
  const units = review.items.flatMap((item) => (item.unit ? [item.unit] : []));
  return (
    units.find((unit) => unit.kind === 'portable' && unit.record.kind === 'session') ??
    units.find(
      (unit) =>
        unit.kind === 'legacy-reading' ||
        (unit.kind === 'portable' && unit.record.kind === 'reading'),
    ) ??
    units[0]
  );
}
function groupTitle(review: Review) {
  const primary = groupPrimary(review);
  return primary
    ? primary.kind === 'legacy-authored' ||
      (primary.kind === 'portable' && ['reflection', 'revisit'].includes(primary.record.kind))
      ? unitDescription(primary)
      : importLabel(primary)
    : (review.items[0]?.label ?? 'Selected records');
}
function recordStatus(status: Review['items'][number]['status']) {
  return {
    ready: 'Ready to import',
    duplicate: 'Already saved — skipped',
    conflict: 'Needs review — different content',
    erased: 'Previously deleted — confirmation needed',
    invalid: 'Cannot import yet',
  }[status];
}
function reviewSummary(review: Review) {
  const complete = review.status.state === 'complete';
  const ready = complete
    ? (review.results?.filter((item) => item.status === 'imported').length ?? 0)
    : review.items.filter((item) => item.status === 'ready').length;
  const duplicates = complete
    ? (review.results?.filter((item) => item.status === 'duplicate').length ?? 0)
    : review.items.filter((item) => item.status === 'duplicate').length;
  const invalid = review.items.length - ready - duplicates;
  const failed = Boolean(review.failure) || ['failed', 'expired'].includes(review.status.state);
  const blocked = !complete && (failed || invalid > 0);
  const duplicateOnly = duplicates === review.status.totalItems;
  const canConfirm = review.status.state === 'staged' && !!review.status.previewHash && !blocked;
  const missingParent = review.items.some((item) =>
    /DEPENDENCY_MISSING|MISSING_PARENT|PARENT_NOT_FOUND/.test(item.error ?? ''),
  );
  const erased = review.items.some((item) => item.status === 'erased');
  const conflict = review.items.some((item) => item.status === 'conflict');
  const remedy = erased
    ? 'This record was previously deleted. To recreate it, choose “Recreate in a new namespace” in the recovery options, then review the group again. Other saved records are unchanged.'
    : conflict
      ? 'A saved record has different content. Keep it by leaving this group unconfirmed, or choose a new source revision in the recovery options and review again.'
      : missingParent
        ? 'The parent reading or a required source is missing. Include its original reading and required records, then review the selection again. Other independent groups can still be imported.'
        : invalid
          ? 'One or more records could not be validated. Correct the original file or leave those records unselected, then review again.'
          : !review.status.previewHash && review.status.state === 'staged'
            ? 'This group is not ready to confirm. Include all of its related records and review the original file again.'
            : null;
  const label = complete
    ? duplicateOnly
      ? 'Already saved — skipped'
      : 'Import complete'
    : blocked
      ? missingParent
        ? 'Blocked · Parent missing'
        : 'Blocked · Needs review'
      : duplicateOnly
        ? 'Already saved — skipped'
        : review.group.unresolved.length > 0
          ? 'Parent check required'
          : canConfirm
            ? 'Ready to import'
            : 'Checking import status';
  return {
    ready,
    duplicates,
    blocked,
    complete,
    duplicateOnly,
    canConfirm,
    erased,
    conflict,
    remedy,
    label,
  };
}

function externalDependencies(items: Review['items']) {
  const units = items.flatMap((item) => (item.unit ? [item.unit] : []));
  const entityKey = (identity: Unit['identity']) =>
    JSON.stringify([
      identity.source.namespaceId,
      identity.source.revision,
      identity.kind,
      identity.recordId,
    ]);
  const entities = new Set(units.map((unit) => entityKey(unit.identity)));
  const revisions = new Set(
    units.map((unit) => `${entityKey(unit.identity)}/${unit.identity.recordRevision}`),
  );
  return units
    .flatMap((unit) => unit.dependencies)
    .filter((dependency) => {
      const key = entityKey({ ...dependency, recordRevision: dependency.recordRevision ?? 1 });
      return dependency.recordRevision === null
        ? !entities.has(key)
        : !revisions.has(`${key}/${dependency.recordRevision}`);
    });
}
export function ImportRecordContent({ unit }: { unit: Unit }) {
  if (unit.kind === 'legacy-authored')
    return <p className="import-kept-text">{unit.record.text}</p>;
  if (unit.kind === 'legacy-reading')
    return (
      <>
        <p className="import-kept-text">
          {unit.record.question ?? 'The file did not include a question.'}
        </p>
        <p>Source: {unit.record.source} · Imported, unverified</p>
        <h6>Original interpretation</h6>
        <p className="import-kept-text">
          {unit.record.generatedText ?? 'The file did not include an interpretation.'}
        </p>
        {unit.record.userStatements.map((entry, i) => (
          <section key={entry.originalId ?? i}>
            <h6>Reader’s words</h6>
            <p className="import-kept-text">{entry.text}</p>
            <p className="muted">
              {entry.originalTimestamp ?? 'Original date unavailable'}
              {entry.revision !== null ? ` · Revision ${entry.revision}` : ''}
            </p>
          </section>
        ))}
        {unit.record.basis.cards.length > 0 && (
          <ul>
            {unit.record.basis.cards.map((card) => (
              <li key={`${card.position}:${card.name}:${card.orientation}`}>
                {card.name}
                {card.position ? ` · ${card.position}` : ''} · {card.orientation}
              </li>
            ))}
          </ul>
        )}
        {unit.record.provenanceGaps.length > 0 && (
          <p className="muted">
            Unavailable in the original file:{' '}
            {unit.record.provenanceGaps.map((gap) => gap.replaceAll('_', ' ')).join(', ')}.
          </p>
        )}
      </>
    );
  const record = unit.record;
  switch (record.kind) {
    case 'session':
      return (
        <p className="import-kept-text">
          {record.value.question ?? 'The archive did not include a question.'}
        </p>
      );
    case 'reflection':
      return <p className="import-kept-text">{record.value.text}</p>;
    case 'revisit':
      return (
        <p className="import-kept-text">
          {'note' in record.value
            ? record.value.note
            : 'The archive did not retain this note’s text.'}
        </p>
      );
    case 'reading': {
      const reading = record.value;
      if (reading.kind === 'legacy.imported.v1')
        return (
          <ImportRecordContent
            unit={{
              ...unit,
              kind: 'legacy-reading',
              rawScope: 'selected-fields.v1',
              record: reading.record,
            }}
          />
        );
      if (reading.kind === 'reading.unavailable.v1')
        return (
          <p>
            This edition was recorded as {reading.reason.replaceAll('_', ' ')}. Its unavailable
            state and original date are preserved; importing does not restore erased text.
          </p>
        );
      if (reading.kind === 'astrology.pattern.accepted.v1')
        return (
          <>
            <p>Your Pattern · Original saved chapter</p>
            <h6>{reading.chapter.title}</h6>
            <p>{reading.chapter.factualLabel}</p>
            <p className="import-kept-text">{reading.chapter.text}</p>
            <p>{reading.chapter.prompt}</p>
            <p>Import preserves the original calculation and chapter as a historical reading.</p>
          </>
        );
      return (
        <>
          <p>Original generated interpretation · Edition {reading.editionNumber}</p>
          <p className="import-kept-text">{reading.question}</p>
          {reading.units.map((part) => (
            <section key={part.position}>
              <h6>{part.position}</h6>
              <p className="import-kept-text">{part.basisText}</p>
              <p className="import-kept-text">{part.interpretation}</p>
              {'reflectionQuestion' in part && (
                <p className="import-kept-text">{part.reflectionQuestion}</p>
              )}
            </section>
          ))}
          {reading.kind === 'tarot.accepted.v2' ? (
            <>
              <h6>Synthesis</h6>
              <p className="import-kept-text">{reading.synthesis.text}</p>
              <h6>Optional next step</h6>
              <p className="import-kept-text">{reading.action.text}</p>
              {reading.reflectionQuestion && (
                <>
                  <h6>Reflection question</h6>
                  <p className="import-kept-text">{reading.reflectionQuestion.text}</p>
                </>
              )}
            </>
          ) : (
            <p className="import-kept-text">{reading.closing}</p>
          )}
          <p className="muted">
            The archive’s source and generation information stays with this edition. Imported
            permissions remain historical.
          </p>
        </>
      );
    }
    case 'permission':
      return (
        <p>
          This historical AI permission is kept as an archive record. It does not change your
          account’s current permission.
        </p>
      );
    case 'grant':
      return (
        <p>
          This historical excerpt permission does not make the imported writing eligible for new
          readings.
        </p>
      );
    case 'generation_receipt':
      return (
        <p>
          The original generation record is preserved with state {record.value.state}. Importing it
          does not run the writer.
        </p>
      );
  }
}
function RecordIdentifiers({ unit }: { unit: Unit }) {
  return (
    <details className="import-identifiers">
      <summary>Record identifiers</summary>
      <dl>
        <dt>Record type</dt>
        <dd>{unit.identity.kind}</dd>
        <dt>Original record</dt>
        <dd>{unit.identity.recordId}</dd>
        <dt>Record revision</dt>
        <dd>{unit.identity.recordRevision}</dd>
        <dt>Source namespace</dt>
        <dd>{unit.identity.source.namespaceId}</dd>
        <dt>Source revision</dt>
        <dd>{unit.identity.source.revision}</dd>
        <dt>File location</dt>
        <dd>{unit.sourcePointer}</dd>
      </dl>
    </details>
  );
}
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
  onRestoreProfile,
}: {
  owner: string;
  csrf: string;
  onExpired: () => void;
  onRestoreProfile: (birth: BirthDraft) => void;
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
  const [setupOpen, setSetupOpen] = useState(true);
  const [reviews, setReviews] = useState<Review[]>([]),
    [progress, setProgress] = useState<Progress | null>(null);
  const [previewGroup, setPreviewGroup] = useState<string | null>(null),
    [previewLimit, setPreviewLimit] = useState(25);
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
    setPreviewGroup(null);
    setPreviewLimit(25);
    setMessage('');
    setError('');
  };
  const reset = () => {
    setSetupOpen(true);
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
          const chunkItems = ImportChunkDocument.parse(JSON.parse(chunk.document)).items;
          const preview = await api(
            '/imports',
            apiSchemas.ImportPreview,
            { ...chunk, source, recovery },
            csrf,
            { key: crypto.randomUUID() },
          );
          if (!current()) return;
          items.push(
            ...preview.items.map((item) => {
              const entry = chunkItems[item.index];
              if (!entry)
                throw new Error(
                  'The review did not match the selected records. Read the file again.',
                );
              return {
                ...item,
                index: entry.ordinal,
                label: importLabel(entry.unit),
                unit: entry.unit,
              };
            }),
          );
        }
        const status = await api('/imports/groups/' + group.id, apiSchemas.ImportGroupStatus);
        collected.push({ group, recovery, items, status, key: crypto.randomUUID() });
        if (!current()) return;
        setReviews([...collected]);
        setPreviewGroup((previous) => previous ?? group.id);
        setResumeId(group.id);
      }
      setSetupOpen(false);
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
          group: { id, unresolved: externalDependencies(previewItems) },
          recovery,
          items: previewItems,
          status,
          key: crypto.randomUUID(),
        },
      ]);
      setPreviewGroup(id);
      setPreviewLimit(25);
      setSetupOpen(false);
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
    setReviews((rs) =>
      rs.map((r) =>
        r.group.id === id
          ? {
              ...r,
              status,
              ...(status.state === 'complete' || status.state === 'failed'
                ? { results: items }
                : {}),
            }
          : r,
      ),
    );
    const sessions = [
      ...new Set(items.flatMap((item) => (item.sessionId ? [item.sessionId] : []))),
    ].slice(0, 10);
    const saved = (
      await Promise.all(
        sessions.map(async (sessionId) => {
          try {
            const record = await api('/sessions/' + sessionId, apiSchemas.SessionRecord);
            const editionId = record.editionIds.at(-1);
            if (record.id !== sessionId || record.status !== 'saved' || !editionId) return null;
            return {
              title: record.question ?? 'Saved reading',
              path: `/saved/${record.id}/${editionId}`,
            };
          } catch (error) {
            if (error instanceof ApiFailure && error.status === 401) throw error;
            return null;
          }
        }),
      )
    ).filter((value) => value !== null);
    if (!current()) return;
    if (status.state === 'expired')
      setReviews((previous) => previous.filter((r) => r.group.id !== id));
    setProgress({ status, items, saved });
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
        if (e instanceof ApiFailure && e.status < 500) {
          if (current())
            setReviews((previous) =>
              previous.map((review) =>
                review.group.id === id
                  ? {
                      ...review,
                      failure: /DEPENDENCY_MISSING|MISSING_PARENT|PARENT_NOT_FOUND/.test(
                        e.code ?? '',
                      )
                        ? 'The required parent could not be found. Include the original parent reading and required records, then review the selection again.'
                        : 'This group could not be confirmed. Review the selected records and recovery options before creating a fresh review. Earlier completed groups stay saved.',
                    }
                  : review,
              ),
            );
          throw e;
        }
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
  const selectedReview = reviews.find((r) => r.group.id === previewGroup) ?? reviews[0];
  const selectedState = selectedReview ? reviewSummary(selectedReview) : null;
  const selectedCount = selectedState?.canConfirm ? selectedState.ready : 0;
  const importedCount = reviews.reduce(
    (count, r) => count + (r.status.state === 'complete' ? reviewSummary(r).ready : 0),
    0,
  );
  const duplicateCount = reviews.reduce((count, r) => count + reviewSummary(r).duplicates, 0);
  const blockedCount = reviews.reduce((count, r) => {
    const v = reviewSummary(r);
    return count + (!v.complete && v.blocked ? r.items.length - v.duplicates : 0);
  }, 0);
  const openSetup = (target: 'file' | 'records' | 'recovery') => {
    setSetupOpen(true);
    requestAnimationFrame(() => {
      const node = document.getElementById(
        target === 'recovery'
          ? 'import-recovery-options'
          : target === 'records'
            ? 'import-file-records'
            : 'import-review',
      );
      if (node instanceof HTMLDetailsElement) node.open = true;
      node?.scrollIntoView({ block: 'start' });
      node
        ?.querySelector<HTMLElement>(
          target === 'file'
            ? 'input[type="file"]'
            : target === 'records'
              ? 'input[type="checkbox"]'
              : 'select',
        )
        ?.focus();
    });
  };
  return (
    <div className={`import-tools${open ? ' is-open' : ''}`}>
      {!open && (
        <Button ref={opener} type="button" variant="secondary" onClick={() => setOpen(true)}>
          Import records
        </Button>
      )}
      {open && (
        <section id="import-review" aria-labelledby="import-title">
          <header className="import-introduction">
            <div>
              <h3 id="import-title" ref={heading} tabIndex={-1}>
                Review your import
              </h3>
              <p>Bring earlier readings and your own reflections into one place.</p>
            </div>
            <img className="import-botanical" src={botanical} alt="" width="542" height="368" />
          </header>
          {(file || reviews.length > 0) && (
            <div className="import-file-banner">
              <span className="import-design-icon import-file-icon" aria-hidden="true" />
              <div>
                <strong>{file?.name ?? 'Resumed import'}</strong>
                <p>
                  {file ? formats.find(([key]) => key === format)?.[1] : 'Saved import preview'} ·{' '}
                  {selectedReview?.items[0]?.unit?.identity.source.revision ?? sourceRevision}
                </p>
              </div>
              <p>Imports preserve the export. Missing dates and sources stay marked as unknown.</p>
            </div>
          )}
          <details
            className="import-setup"
            open={setupOpen}
            onToggle={(event) => setSetupOpen(event.currentTarget.open)}
          >
            <summary>File and record selection</summary>
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
              <fieldset disabled={busy} id="import-file-records">
                <legend>Records in the file</legend>
                {parsed.profileCandidates?.map((candidate) => (
                  <section key={candidate.id} className="notice">
                    <h3>Birth profile in this file</h3>
                    <p>
                      {candidate.birth.date} · {candidate.birth.place.label}
                    </p>
                    <p>
                      This profile is not included in reading imports. Review it separately before
                      explicitly replacing your current birth details.
                    </p>
                    <Button variant="secondary" onClick={() => onRestoreProfile(candidate.birth)}>
                      Review birth profile for restoration
                    </Button>
                  </section>
                ))}
                {parsed.errors.map((e) => (
                  <p key={e.pointer}>
                    {e.pointer} · Invalid record ({e.code})
                  </p>
                ))}
                {parsed.units.slice(0, visible).map((u) => (
                  <div className="import-file-record" key={u.key}>
                    <label className="import-choice">
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
                          {unitDescription(u)} · {originalDate(u) ?? 'Original date unavailable'}
                        </small>
                        {u.kind === 'legacy-reading' && (
                          <small>{u.record.generatedText ?? 'Interpretation unavailable'}</small>
                        )}
                        {u.kind === 'legacy-authored' && <small>{u.record.text}</small>}
                        {u.dependencies.length > 0 && (
                          <small>
                            Includes related records. Its original reading and required sources must
                            be available.
                          </small>
                        )}
                      </span>
                    </label>
                    <RecordIdentifiers unit={u} />
                  </div>
                ))}
                {visible < parsed.units.length && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setVisible((n) => n + 25)}
                  >
                    Show more records
                  </Button>
                )}
                <details id="import-recovery-options">
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
          </details>
          {reviews.length > 0 && selectedReview && (
            <>
              <div className="import-review-layout">
                <section className="import-group-list" aria-label="Reading groups">
                  <h4>Reading groups</h4>
                  <p className="muted">
                    Choose a group to review. Import one related group at a time.
                  </p>
                  {[
                    {
                      label: 'Available to import',
                      rows: reviews.filter((r) => {
                        const v = reviewSummary(r);
                        return !v.complete && !v.duplicateOnly && !v.blocked;
                      }),
                    },
                    {
                      label: 'Not included in a new import',
                      rows: reviews.filter((r) => {
                        const v = reviewSummary(r);
                        return v.complete || v.duplicateOnly || v.blocked;
                      }),
                    },
                  ].map(
                    ({ label, rows }) =>
                      rows.length > 0 && (
                        <div className="import-group-category" key={label}>
                          <p className="eyebrow">{label}</p>
                          {rows.map((r) => {
                            const v = reviewSummary(r);
                            const primary = groupPrimary(r);
                            const chosen = selectedReview.group.id === r.group.id;
                            return (
                              <section
                                key={r.group.id}
                                className={`import-group${chosen ? ' is-selected' : ''}`}
                              >
                                <Button
                                  variant="text-button"
                                  className="import-group-choice"
                                  aria-label={`Preview ${groupTitle(r)}`}
                                  aria-pressed={chosen}
                                  aria-controls="import-selected-preview"
                                  disabled={busy}
                                  onClick={() => {
                                    setError('');
                                    setPreviewGroup(r.group.id);
                                    setPreviewLimit(25);
                                  }}
                                >
                                  <span className="import-group-association">
                                    {chosen ? 'Preview shown' : 'Preview this group'}
                                    <span
                                      className="import-design-icon import-arrow-icon"
                                      aria-hidden="true"
                                    />
                                  </span>
                                  <span className="import-group-identity">
                                    <strong>{groupTitle(r)}</strong>
                                    <span>
                                      {primary
                                        ? (originalDate(primary) ?? 'Original date unavailable')
                                        : 'Original date unavailable'}
                                    </span>
                                    <span>
                                      {r.status.totalItems} related{' '}
                                      {r.status.totalItems === 1 ? 'record' : 'records'}
                                    </span>
                                  </span>
                                  <span
                                    className={`import-row-status${v.blocked ? ' is-blocked' : v.duplicateOnly || v.complete ? ' is-muted' : ''}`}
                                  >
                                    {v.label}
                                  </span>
                                </Button>
                                {v.duplicateOnly && (
                                  <p>
                                    Finishing this review adds no new records. Your existing reading
                                    stays saved.
                                  </p>
                                )}
                                {r.recovery.kind !== 'none' && (
                                  <p>
                                    {r.recovery.kind === 'new_revision'
                                      ? 'New source revision'
                                      : 'Recreation in a new namespace'}{' '}
                                    · Existing records remain unchanged.
                                  </p>
                                )}
                              </section>
                            );
                          })}
                        </div>
                      ),
                  )}
                </section>
                {(() => {
                  const r = selectedReview;
                  const v = reviewSummary(r);
                  const duplicateOnly = v.duplicateOnly;
                  const primary = groupPrimary(r);
                  const resultStatuses = new Map(
                    r.results?.map((result) => [result.index, result.status]),
                  );
                  return (
                    <section
                      id="import-selected-preview"
                      className="import-preview-panel"
                      aria-label="Selected group preview"
                    >
                      <div className="import-preview-association">
                        <span className="import-design-icon import-book-icon" aria-hidden="true" />
                        <span>
                          Selected group preview · {r.status.totalItems}{' '}
                          {r.status.totalItems === 1 ? 'record' : 'records'}
                        </span>
                      </div>
                      <div className="import-group-preview">
                        <h4>{groupTitle(r)}</h4>
                        <p className="muted">
                          {primary
                            ? (originalDate(primary) ?? 'Original date unavailable')
                            : 'Original date unavailable'}
                        </p>
                        <p className="import-group-counts">
                          {v.complete
                            ? `${v.ready} imported · ${v.duplicates} already saved · Finished`
                            : `${v.ready} ready · ${v.duplicates} already saved · ${r.items.length - v.ready - v.duplicates} need review`}
                        </p>
                        {r.items.slice(0, previewLimit).map((item, j) => (
                          <section className="import-record-preview" key={item.index}>
                            <h5>
                              {item.unit
                                ? unitDescription(item.unit)
                                : (item.label ?? `Record ${j + 1}`)}
                            </h5>
                            {item.unit && (
                              <p className="import-record-date">
                                {originalDate(item.unit) ?? 'Original date unavailable'}
                              </p>
                            )}
                            <p className={`import-record-status is-${item.status}`}>
                              {duplicateOnly
                                ? 'This record is already saved.'
                                : v.complete
                                  ? resultStatuses.get(item.index) === 'duplicate'
                                    ? 'This record was already saved.'
                                    : resultStatuses.get(item.index) === 'imported'
                                      ? 'Imported and saved.'
                                      : 'Review complete.'
                                  : recordStatus(item.status)}
                            </p>
                            {item.unit ? (
                              <ImportRecordContent unit={item.unit} />
                            ) : (
                              <p>
                                Original content is unavailable in this review. Read the original
                                file again to inspect it.
                              </p>
                            )}
                            {item.unit && <RecordIdentifiers unit={item.unit} />}
                          </section>
                        ))}
                        {r.items.length > previewLimit && (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => setPreviewLimit((n) => n + 25)}
                          >
                            Show more related records
                          </Button>
                        )}

                        {v.remedy && (
                          <p className="import-remedy" id={`import-remedy-${r.group.id}`}>
                            {v.remedy}
                          </p>
                        )}
                        {r.group.unresolved.length > 0 && (
                          <p className="import-remedy">
                            This group references a parent reading or source outside this selection.
                            It must already be saved with the same source and revision. Otherwise,
                            include its original reading and required records, then review the
                            selection again.
                          </p>
                        )}
                        {r.failure && (
                          <p className="import-remedy" role="alert">
                            {r.failure}
                          </p>
                        )}
                        {r.failure && parsed && (
                          <Button
                            variant="text-button"
                            disabled={busy}
                            onClick={() => openSetup('records')}
                          >
                            Review record selection
                          </Button>
                        )}
                        {(v.erased || v.conflict) && parsed && (
                          <Button
                            variant="text-button"
                            disabled={busy}
                            onClick={() => openSetup('recovery')}
                          >
                            Review recovery options
                          </Button>
                        )}
                        <details className="import-identifiers">
                          <summary>Import details</summary>
                          <dl>
                            <dt>Import ID</dt>
                            <dd>{r.group.id}</dd>
                            <dt>Review state</dt>
                            <dd>{r.status.state}</dd>
                            {r.recovery.kind !== 'none' && (
                              <>
                                <dt>Previous source namespace</dt>
                                <dd>{r.recovery.previousSource.namespaceId}</dd>
                                <dt>Previous source revision</dt>
                                <dd>{r.recovery.previousSource.revision}</dd>
                              </>
                            )}
                            {r.items.map((item) => (
                              <div key={item.index}>
                                <dt>Record status</dt>
                                <dd>
                                  {item.status}
                                  {item.error ? ` · ${item.error}` : ''}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      </div>
                    </section>
                  );
                })()}
              </div>
              <section className="import-outcome" aria-label="Import summary">
                <div className="import-outcome-main">
                  <div>
                    <h4>
                      {importedCount
                        ? `${importedCount} ${importedCount === 1 ? 'record' : 'records'} imported.`
                        : 'No new records imported yet.'}
                    </h4>
                    <ul className="import-outcome-counts">
                      <li>
                        <strong>{selectedCount}</strong>{' '}
                        {selectedCount === 1 ? 'record' : 'records'} selected for this import
                      </li>
                      <li>
                        <strong>{duplicateCount}</strong>{' '}
                        {duplicateCount === 1 ? 'duplicate' : 'duplicates'} skipped
                      </li>
                      <li>
                        <strong>{blockedCount}</strong> {blockedCount === 1 ? 'record' : 'records'}{' '}
                        blocked
                      </li>
                    </ul>
                  </div>
                  <div className="import-outcome-actions">
                    <Button variant="text-button" disabled={busy} onClick={() => openSetup('file')}>
                      Choose a different file
                    </Button>
                    {selectedReview.status.state === 'staged' && (
                      <Button
                        disabled={busy || !selectedState?.canConfirm}
                        aria-describedby={
                          selectedState?.remedy
                            ? `import-remedy-${selectedReview.group.id}`
                            : undefined
                        }
                        onClick={() => commit(selectedReview)}
                      >
                        {selectedState?.duplicateOnly
                          ? 'Finish review — no new records'
                          : `Import ${selectedState?.ready ?? 0} ${selectedState?.ready === 1 ? 'record' : 'records'}`}
                      </Button>
                    )}
                  </div>
                </div>
                <p className="import-privacy">
                  <span className="import-design-icon import-shield-icon" aria-hidden="true" />
                  Importing saves this group’s eligible records. It does not send them to an AI
                  provider. Other groups need their own confirmation.
                </p>
              </section>
            </>
          )}
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
              <>
                <p>
                  {progress.status.completedItems} of {progress.status.totalItems} completed.{' '}
                  {progress.items.filter((i) => i.status === 'duplicate').length} duplicates
                  skipped.
                </p>
                {progress.status.state === 'expired' && (
                  <p>
                    This private preview expired after 24 hours. Read the original file to create a
                    fresh preview. Earlier completed groups stay saved.
                  </p>
                )}
                {progress.saved.length > 0 && (
                  <ul className="import-saved-links">
                    {progress.saved.map((saved) => (
                      <li key={saved.path}>
                        <TextLink href={saved.path}>Open saved reading: {saved.title}</TextLink>
                      </li>
                    ))}
                  </ul>
                )}
              </>
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
