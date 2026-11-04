import type { z } from 'zod';
import type { Reading, SelectedFragment } from './index.ts';
import { codePointLength } from './context-policy.ts';

type Authorship = z.infer<typeof SelectedFragment>['authorship'];
export interface ContextPassage {
  text: string;
  authorship: Authorship;
  start: number;
  end: number;
}

/** Edition offsets use the reviewed prose in display order, then the separately authored
 * saved question. Two line feeds separate paragraphs and passages. No excerpt crosses
 * a passage boundary. Keep this projection shared with the range picker.
 */
export function editionContextPassages(reading: z.infer<typeof Reading>): ContextPassage[] {
  if (reading.kind === 'reading.unavailable.v1') return [];
  let prose: (string | null)[], question: string | null;
  let proseAuthor: Authorship = 'generated',
    questionAuthor: Authorship = 'user';
  if (reading.kind === 'legacy.imported.v1') {
    prose = [reading.record.generatedText];
    question = reading.record.question;
    proseAuthor = questionAuthor = 'legacy_unknown';
  } else {
    question = reading.question;
    prose =
      reading.kind !== 'tarot.accepted.v2'
        ? [
            ...reading.units.flatMap((unit) => [unit.interpretation, unit.reflectionQuestion]),
            reading.closing,
          ]
        : [
            ...reading.units.map((unit) => unit.interpretation),
            reading.synthesis.text,
            reading.action.text,
            reading.reflectionQuestion?.text ?? null,
          ];
  }
  const generated = prose.filter(Boolean).join('\n\n');
  const passages: ContextPassage[] = [];
  if (generated)
    passages.push({
      text: generated,
      authorship: proseAuthor,
      start: 0,
      end: codePointLength(generated),
    });
  const start = generated ? passages[0]!.end + 2 : 0;
  if (question)
    passages.push({
      text: question,
      authorship: questionAuthor,
      start,
      end: start + codePointLength(question),
    });
  return passages;
}
