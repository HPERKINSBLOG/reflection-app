import { ImportUnit, LegacyAuthoredRecord } from '../../contracts/index.ts';
import {
  field,
  raw,
  textField,
  assertFields,
  pointerPart,
  projectFields,
  type JsonNode,
} from './json.ts';
import { assertRecordSize, common, groupKey, identity, rawHash, readingUnit } from './legacy.ts';
import type { NormalizedImport, Source, Unit, Identity } from './types.ts';

const ENTRY = [
  'id',
  'ts',
  'spread',
  'spreadKey',
  'question',
  'personalReading',
  'cards',
  'themes',
  'reflections',
  'context',
  'provider',
  'deckId',
  'followUps',
];
const CARD = [
  'position',
  'slot',
  'name',
  'card',
  'canonicalName',
  'canonicalKey',
  'displayName',
  'number',
  'suit',
  'rank',
  'rankValue',
  'orientation',
  'isReversed',
  'upright',
  'reversed',
  'meaning',
  'userReflection',
  'callerMeaning',
  'decisionPath',
];
const TURN = [
  'turnNumber',
  'question',
  'answer',
  'canonicalAnswer',
  'createdAt',
  'isInterrupted',
  'journalContext',
];

/** A selected-fields claim is validated again on the server-side carrier path. */
export function assertTarotProjection(node: JsonNode, child: boolean): void {
  const allowed = child
    ? TURN.filter((key) => key !== 'journalContext')
    : ENTRY.filter((key) => !['followUps', 'reflections', 'context', 'themes'].includes(key));
  assertFields(node, allowed);
  const scalar = (value: unknown) =>
    value === null || ['string', 'number', 'boolean'].includes(typeof value);
  for (const [key, value] of node.members) {
    if (key === 'cards') {
      if (!Array.isArray(value.value)) throw new Error('IMPORT_INVALID');
      for (const card of value.elements) {
        assertFields(
          card,
          CARD.filter((k) => k !== 'userReflection'),
        );
        for (const [field, metadata] of card.members) {
          if (field === 'decisionPath' && metadata.value !== null) {
            assertFields(metadata, ['key', 'label', 'rawLabel']);
            if ([...metadata.members.values()].some((n) => !scalar(n.value)))
              throw new Error('IMPORT_INVALID');
          } else if (!scalar(metadata.value)) throw new Error('IMPORT_INVALID');
        }
      }
    } else if (!scalar(value.value)) throw new Error('IMPORT_INVALID');
  }
}

export async function normalizeTarot(
  document: string,
  root: JsonNode,
  source: Source,
  result: NormalizedImport,
): Promise<void> {
  const entries = field(root, 'entries');
  if (
    !entries ||
    !Array.isArray(entries.value) ||
    typeof field(root, 'exportedAt')?.value !== 'string' ||
    field(root, 'entryCount')?.value !== entries.elements.length
  )
    throw new Error('IMPORT_INVALID');
  const emit = async (pointer: string, create: () => Promise<Unit>) => {
    try {
      result.units.push(await create());
    } catch (error) {
      result.errors.push({
        pointer,
        code:
          error instanceof Error && error.message === 'INPUT_TOO_LARGE'
            ? 'INPUT_TOO_LARGE'
            : 'IMPORT_INVALID',
      });
    }
  };
  for (const [index, entry] of entries.elements.entries()) {
    const pointer = `/entries/${index}`;
    await emit(pointer, async () => {
      assertFields(entry, ENTRY);
      const cards = field(entry, 'cards');
      if (cards && !Array.isArray(cards.value)) throw new Error('IMPORT_INVALID');
      const cardRaw = (cards?.elements ?? []).map((card) => {
        assertFields(card, CARD);
        return projectFields(
          document,
          card,
          CARD.filter((k) => k !== 'userReflection'),
        );
      });
      const overrides = new Map([['cards', `[${cardRaw.join(',')}]`]]);
      // Context/themes can contain earlier history. They are outside this bounded adapter.
      const baseRaw = projectFields(
        document,
        entry,
        ENTRY.filter((k) => !['followUps', 'reflections', 'context', 'themes'].includes(k)),
        overrides,
      );
      return readingUnit(document, entry, source, pointer, baseRaw, {
        originalId: textField(entry, 'id'),
        parent: null,
        group: null,
        system: 'tarot',
        question: textField(entry, 'question'),
        generatedText: textField(entry, 'personalReading'),
        ...(field(entry, 'ts') ? { time: field(entry, 'ts')! } : {}),
        cards: cards?.elements ?? [],
      });
    });
    const parent = result.units.find((u) => u.sourcePointer === pointer);
    if (!parent) continue;
    const rootIdentity = parent.identity,
      group = groupKey(rootIdentity);
    const authored = async (node: JsonNode, path: string, label: string) => {
      if (typeof node.value !== 'string') throw new Error('IMPORT_INVALID');
      if (!node.value.trim()) return;
      const originalJsonText = raw(document, node);
      const id = await identity(
        source,
        'reflection',
        `sha256:${await rawHash(JSON.stringify(['tarot-authored.v1', rootIdentity.source.namespaceId, rootIdentity.kind, rootIdentity.recordId, rootIdentity.recordRevision, path.slice(pointer.length)]))}`,
        originalJsonText,
      );
      const record = LegacyAuthoredRecord.parse({
        identity: id,
        parentIdentity: rootIdentity,
        label,
        text: node.value,
        originalTimestamp: null,
        occurredAt: null,
        originalJsonText,
        originalSha256: await rawHash(originalJsonText),
      });
      assertRecordSize(record);
      result.units.push(
        ImportUnit.parse({
          ...common(id, rootIdentity, path, group),
          kind: 'legacy-authored',
          rawScope: 'selected-fields.v1',
          record,
        }),
      );
    };
    const notes = field(entry, 'reflections');
    if (
      notes &&
      notes.value !== null &&
      (Array.isArray(notes.value) || typeof notes.value !== 'object')
    )
      result.errors.push({ pointer: `${pointer}/reflections`, code: 'IMPORT_INVALID' });
    if (notes && notes.value !== null)
      for (const [label, node] of notes.members) {
        const path = `${pointer}/reflections/${pointerPart(label)}`;
        try {
          await authored(node, path, label);
        } catch {
          result.errors.push({ pointer: path, code: 'IMPORT_INVALID' });
        }
      }
    for (const [i, card] of (field(entry, 'cards')?.elements ?? []).entries()) {
      const note = field(card, 'userReflection'),
        path = `${pointer}/cards/${i}/userReflection`;
      if (note && note.value !== null)
        try {
          await authored(note, path, `Card ${i + 1}`);
        } catch {
          result.errors.push({ pointer: path, code: 'IMPORT_INVALID' });
        }
    }
    const turns = field(entry, 'followUps');
    if (turns && !Array.isArray(turns.value)) {
      result.errors.push({ pointer: `${pointer}/followUps`, code: 'IMPORT_INVALID' });
      continue;
    }
    for (const [i, turn] of (turns?.elements ?? []).entries()) {
      const path = `${pointer}/followUps/${i}`;
      await emit(path, async () => {
        assertFields(turn, TURN);
        const ordinal = field(turn, 'turnNumber')?.value;
        if (ordinal !== undefined && (!Number.isSafeInteger(ordinal) || Number(ordinal) < 1))
          throw new Error('IMPORT_INVALID');
        let originalId = `${rootIdentity.recordId}:followup:${ordinal ?? i + 1}`;
        if (originalId.length > 200) originalId = `sha256:${await rawHash(originalId)}`;
        const original = projectFields(
          document,
          turn,
          TURN.filter((k) => k !== 'journalContext'),
        );
        return readingUnit(document, turn, source, path, original, {
          originalId,
          originalParentId: parent.kind === 'legacy-reading' ? parent.record.originalId : null,
          parent: rootIdentity as Identity,
          group,
          system: 'tarot',
          question: textField(turn, 'question'),
          generatedText: textField(turn, 'answer') ?? textField(turn, 'canonicalAnswer'),
          ...(field(turn, 'createdAt') ? { time: field(turn, 'createdAt')! } : {}),
        });
      });
    }
  }
}
