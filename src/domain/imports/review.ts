import type { Unit } from './types.ts';

/** One record label for the local file review and the same encrypted preview on resume. */
export function importLabel(unit: Unit): string {
  if (unit.kind === 'legacy-reading') return unit.record.question ?? 'Question unavailable';
  if (unit.kind === 'legacy-authored') return unit.record.label;
  const record = unit.record;
  switch (record.kind) {
    case 'reading':
      return record.value.kind === 'legacy.imported.v1'
        ? (record.value.record.question ?? 'Question unavailable')
        : record.value.kind === 'reading.unavailable.v1'
          ? 'Unavailable reading'
          : record.value.kind === 'astrology.pattern.accepted.v1'
            ? record.value.chapter.prompt
            : record.value.question;
    case 'session':
      return record.value.question ?? 'Saved reading';
    case 'reflection':
      return record.value.text;
    case 'revisit':
      return 'note' in record.value ? record.value.note : 'Revisit note';
    case 'generation_receipt':
      return 'Historical generation receipt';
    case 'permission':
      return 'Historical AI permission';
    case 'grant':
      return 'Historical excerpt permission';
  }
}
