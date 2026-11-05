import type { Ref } from 'react';
import type { z } from 'zod';
import type { AnyAcceptedReading } from '../contracts/index.ts';
import type { ContextSubmission } from './context-selection.tsx';
import { Button } from './design/components.tsx';
import { date } from './date.ts';

export function FollowUpReview({
  parent,
  question,
  context,
  notice,
  heading,
  disabled,
  onBack,
}: {
  parent: z.infer<typeof AnyAcceptedReading>;
  question: string;
  context: ContextSubmission;
  notice: string | null;
  heading: Ref<HTMLHeadingElement>;
  disabled: boolean;
  onBack: () => void;
}) {
  return (
    <section className="submission-review" aria-label="Review follow-up">
      <h2 ref={heading} tabIndex={-1}>
        Review follow-up
      </h2>
      <div className="submission-review-section">
        <h3>Following this exact edition</h3>
        <p>{parent.question}</p>
        <p className="muted">
          {parent.editionNumber === 1
            ? 'Original reading'
            : `Follow-up ${parent.editionNumber - 1}`}{' '}
          · {date(parent.acceptedAt)}
        </p>
        <p>
          <strong>No new draw</strong> · The original three cards and orientations are reused.
        </p>
      </div>
      <div className="submission-review-section">
        <h3>Your question</h3>
        <p className="review-question">{question}</p>
      </div>
      <div className="submission-review-section">
        <h3>Selected context</h3>
        {!context.count ? (
          <p>No excerpts selected. No earlier writing will be sent.</p>
        ) : (
          context.reviewedExcerpts?.map((excerpt) => (
            <div key={excerpt.id} className="review-excerpt">
              <p>
                {excerpt.authorship === 'user'
                  ? 'Your words'
                  : excerpt.authorship === 'generated'
                    ? 'Generated text'
                    : 'Unknown authorship'}{' '}
                · {excerpt.title}
              </p>
              <p className="muted">{date(excerpt.at)}</p>
              <blockquote>{excerpt.text}</blockquote>
            </div>
          ))
        )}
      </div>
      {notice && <p>{notice}</p>}
      <p>
        This follow-up stays with the original saved reading until deletion. Deleting the reading
        also deletes all of its follow-ups.
      </p>
      <p className="muted">Counts as a new reading.</p>
      <div className="actions">
        <Button type="submit" disabled={disabled}>
          Start follow-up
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Back to question and context
        </Button>
      </div>
    </section>
  );
}
