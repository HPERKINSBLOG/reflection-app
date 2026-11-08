import type { ReactNode, Ref, RefObject } from 'react';
import { Art } from './art.tsx';
import { Button, Input, ReflectionField } from './design/components.tsx';
import { Icon } from './icon.tsx';
import { Notice } from './notice.tsx';

/** One decision per screen before a new reading starts; Review is the only screen that can start. */
export type ComposerStep = 'question' | 'spread' | 'photo' | 'review';
export type SpreadChoice = 'draw' | 'photo';

export const QUESTION_SUGGESTIONS = [
  'What deserves more space in my life?',
  'How can I make room for my own needs?',
] as const;

const STEPS = [
  { key: 'question', number: '01', label: 'Question' },
  { key: 'spread', number: '02', label: 'Spread' },
  { key: 'cards', number: '03', label: 'Cards' },
  { key: 'reading', number: '04', label: 'Reading' },
] as const;

export function ReadingSteps({ current }: { current: 'question' | 'spread' | 'cards' }) {
  return (
    <ol className="reading-steps" aria-label="Reading steps">
      {STEPS.map((item) => (
        <li key={item.key} aria-current={item.key === current ? 'step' : undefined}>
          <span className="reading-step-number">{item.number}</span> {item.label}
        </li>
      ))}
    </ol>
  );
}

function StepHeading({
  eyebrow,
  title,
  lead,
  headingRef,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  headingRef: Ref<HTMLHeadingElement>;
  children?: ReactNode;
}) {
  return (
    <header className="tarot-step-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h2 ref={headingRef} tabIndex={-1}>
        {title}
      </h2>
      <p className="tarot-step-lead">{lead}</p>
      {children}
    </header>
  );
}

function StepAside({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <aside className="reading-preflight tarot-step-aside" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </aside>
  );
}

export function QuestionStep({
  hidden = false,
  headingRef,
  fieldRef,
  question,
  error,
  continueError,
  busy,
  context,
  onQuestion,
  onContinue,
  onJournal,
}: {
  hidden?: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  question: string;
  error: string | null;
  continueError: string | null;
  busy: boolean;
  context: ReactNode;
  onQuestion: (value: string) => void;
  onContinue: () => void;
  onJournal: () => void;
}) {
  return (
    <div className="new-reading-layout tarot-step tarot-step-question" hidden={hidden}>
      <div className="new-reading-content">
        <StepHeading
          eyebrow="A new tarot reading"
          title="What is on your mind?"
          lead="Bring a question you would like a little space to consider."
          headingRef={headingRef}
        >
          <Art name="spread-ribbon" mobileName="mobile-corner" className="new-reading-art" />
        </StepHeading>
        <ReflectionField
          ref={fieldRef}
          id="reading-question"
          label="Your question"
          hint="Up to 500 characters · Start with what you are considering."
          rows={3}
          maxLength={500}
          required
          value={question}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'reading-question-error' : undefined}
          onChange={(event) => onQuestion(event.target.value)}
          disabled={busy}
        />
        {error && (
          <div id="reading-question-error" className="tarot-step-error">
            <Notice message={{ tone: 'error', text: error }} />
          </div>
        )}
        {!question.trim() && (
          <fieldset className="question-suggestions">
            <legend>A place to begin</legend>
            <div className="question-suggestion-list">
              {QUESTION_SUGGESTIONS.map((text) => (
                <Button
                  key={text}
                  variant="secondary"
                  className="question-suggestion"
                  disabled={busy}
                  onClick={() => {
                    onQuestion(text);
                    fieldRef.current?.focus();
                  }}
                >
                  {text}
                </Button>
              ))}
            </div>
          </fieldset>
        )}
        {context}
        {continueError && (
          <div className="tarot-step-error">
            <Notice message={{ tone: 'error', text: continueError }} />
          </div>
        )}
        <div className="actions tarot-step-actions">
          <Button disabled={busy} onClick={onContinue}>
            Choose your spread
            <Icon name="chevron" />
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onJournal}>
            Open your journal
          </Button>
        </div>
      </div>
      <StepAside id="question-step-aside" title="A little space to reflect.">
        <p>
          You can be new to tarot or bring an established practice. Begin with your own question;
          decide what feels useful to you.
        </p>
      </StepAside>
    </div>
  );
}

function SpreadOption({
  id,
  title,
  detail,
  caption,
  busy,
  onChoose,
}: {
  id: string;
  title: string;
  detail: string;
  caption?: string;
  busy: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      className="secondary spread-option"
      aria-labelledby={`${id}-title`}
      aria-describedby={caption ? `${id}-detail ${id}-caption` : `${id}-detail`}
      disabled={busy}
      onClick={onChoose}
    >
      <span id={`${id}-title`} className="spread-option-title">
        {title}
      </span>
      <span id={`${id}-detail`}>{detail}</span>
      {caption && (
        <span id={`${id}-caption`} className="spread-option-caption">
          {caption}
        </span>
      )}
    </button>
  );
}

export function SpreadStep({
  headingRef,
  reversals,
  busy,
  onReversals,
  onDraw,
  onPhysical,
  onBack,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  reversals: boolean;
  busy: boolean;
  onReversals: (value: boolean) => void;
  onDraw: () => void;
  onPhysical: () => void;
  onBack: () => void;
}) {
  return (
    <div className="new-reading-layout tarot-step tarot-step-spread">
      <div className="new-reading-content">
        <StepHeading
          eyebrow="A new tarot reading"
          title="One question. Three perspectives."
          lead="Situation, Tension, and Possibility—from left to right."
          headingRef={headingRef}
        />
        <label className="check" htmlFor="check-reversals">
          <Input
            id="check-reversals"
            type="checkbox"
            checked={reversals}
            onChange={(event) => onReversals(event.target.checked)}
            disabled={busy}
          />
          Include reversed cards
        </label>
        <div className="spread-options">
          <SpreadOption
            id="spread-draw"
            title="Let Reflection draw"
            detail="Draw three cards for this question."
            caption="Situation · Tension · Possibility"
            busy={busy}
            onChoose={onDraw}
          />
          <SpreadOption
            id="spread-physical"
            title="Use my physical spread"
            detail="Bring a photo of three cards you have already drawn."
            busy={busy}
            onChoose={onPhysical}
          />
        </div>
        <div className="actions tarot-step-actions">
          <Button variant="secondary" disabled={busy} onClick={onBack}>
            Back to your question
          </Button>
        </div>
      </div>
      <StepAside id="spread-step-aside" title="Three positions, in order.">
        <p>
          Situation looks at what is present. Tension explores what feels difficult. Possibility
          makes room for a next perspective.
        </p>
      </StepAside>
    </div>
  );
}

export function PhotoStep({
  headingRef,
  inputRef,
  chooseRef,
  photo,
  notice,
  busy,
  onFile,
  onRemove,
  onContinue,
  onAppDraw,
  onBack,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  inputRef: RefObject<HTMLInputElement | null>;
  chooseRef: Ref<HTMLButtonElement>;
  photo: { dataUrl: string | null; name: string | null; preparing: boolean; announcement: string };
  notice: string;
  busy: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
  onContinue: () => void;
  onAppDraw: () => void;
  onBack: () => void;
}) {
  const attached = Boolean(photo.dataUrl || photo.preparing);
  return (
    <div className="new-reading-layout tarot-step tarot-step-photo">
      <div className="new-reading-content">
        <StepHeading
          eyebrow="A new tarot reading"
          title="Bring the cards you drew."
          lead="Place three cards in order, with their whole faces visible."
          headingRef={headingRef}
        />
        <div className="spread-upload-field">
          <label htmlFor="reading-spread-photo">Photo of your spread</label>
          <p id="reading-spread-photo-help" className="muted">
            Situation, tension, possibility — from left to right. Use a photo of three cards you
            have already drawn to recognize your cards and orientations instead of drawing new ones.
          </p>
          <p id="reading-photo-processing" aria-live="polite">
            {notice}
          </p>
          <Input
            ref={inputRef}
            id="reading-spread-photo"
            aria-describedby="reading-spread-photo-help reading-photo-processing"
            className="photo-file-input"
            tabIndex={-1}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
            }}
          />
          <div
            className={`spread-attachment ${attached ? 'has-photo' : ''}`}
            data-testid={attached ? 'spread-photo-preview' : undefined}
          >
            <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {photo.announcement}
            </p>
            {attached ? (
              <div className="spread-photo-preview">
                {photo.dataUrl && <img src={photo.dataUrl} alt="Uploaded tarot spread preview" />}
                {photo.preparing && <p className="photo-preparing">Preparing photo…</p>}
              </div>
            ) : (
              <div className="spread-photo-empty">
                <Art name="three-card-spread" className="spread-intro-art" />
                <p>Illustration only</p>
              </div>
            )}
            <div className="spread-photo-meta">
              <div className="spread-file-description">
                {attached && <p>{photo.name ?? 'Spread photo attached'}</p>}
                <p className="muted">JPEG, PNG or WebP · up to 10 MB</p>
              </div>
              <div className="spread-photo-actions">
                <Button
                  ref={chooseRef}
                  className="secondary choose-photo"
                  aria-describedby="reading-spread-photo-help reading-photo-processing"
                  disabled={busy}
                  onClick={() => inputRef.current?.click()}
                >
                  Choose photo
                </Button>
                {attached && (
                  <Button variant="secondary" disabled={busy} onClick={onRemove}>
                    Remove photo
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="actions tarot-step-actions">
          <Button disabled={busy || !photo.dataUrl || photo.preparing} onClick={onContinue}>
            Review your reading
            <Icon name="chevron" />
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onAppDraw}>
            Use an app draw instead
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onBack}>
            Back to spread choices
          </Button>
        </div>
      </div>
      <StepAside id="photo-step-aside" title="Keep the order visible.">
        <p>
          Left: Situation. Middle: Tension. Right: Possibility. Keep reversed cards as you drew
          them.
        </p>
      </StepAside>
    </div>
  );
}

export type ReviewSpread =
  | { kind: 'draw'; reversals: boolean }
  | { kind: 'photo'; name: string; dataUrl: string };

export function ReviewStep({
  headingRef,
  question,
  spread,
  context,
  notices,
  english,
  busy,
  startDisabled,
  startHint,
  remaining,
  onEnglish,
  onEditQuestion,
  onChangeSpread,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  question: string;
  spread: ReviewSpread;
  context: ReactNode | null;
  notices: ReactNode;
  english: boolean;
  busy: boolean;
  startDisabled: boolean;
  startHint: string | null;
  remaining: { day: number; month: number };
  onEnglish: (value: boolean) => void;
  onEditQuestion: () => void;
  onChangeSpread: () => void;
}) {
  return (
    <div className="new-reading-layout tarot-step tarot-step-review">
      <div className="new-reading-content">
        <StepHeading
          eyebrow="Review your reading"
          title="Ready when you are."
          lead="Check the question, the spread, and what will be shared."
          headingRef={headingRef}
        />
        <div className="submission-review-section">
          <h3>Your question</h3>
          <p className="review-question">{question}</p>
          <Button variant="text-button" disabled={busy} onClick={onEditQuestion}>
            Edit your question
          </Button>
        </div>
        <div className="submission-review-section">
          <h3>Spread</h3>
          {spread.kind === 'draw' ? (
            <p>App draw · Reversed cards: {spread.reversals ? 'On' : 'Off'}</p>
          ) : (
            <>
              <p>Your spread photo</p>
              <p className="muted">{spread.name}</p>
              <img
                className="review-spread-photo"
                src={spread.dataUrl}
                alt="Your attached spread"
              />
            </>
          )}
          <Button variant="text-button" disabled={busy} onClick={onChangeSpread}>
            Change the spread
          </Button>
        </div>
        {context}
      </div>
      <aside className="reading-preflight" aria-labelledby="reading-preflight-title">
        <h3 id="reading-preflight-title">Before you start</h3>
        {notices}
        <label className="check" htmlFor="check-english">
          <Input
            id="check-english"
            type="checkbox"
            required
            checked={english}
            onChange={(event) => onEnglish(event.target.checked)}
            disabled={busy}
          />
          Use English for this reading (required)
        </label>
        <div className="new-reading-footer">
          <Button
            type="submit"
            className="large"
            aria-describedby={startHint ? 'reading-start-help' : undefined}
            disabled={startDisabled}
          >
            Start reading
            <Icon name="chevron" />
          </Button>
          {startHint && (
            <p id="reading-start-help" className="muted">
              {startHint}
            </p>
          )}
          <p className="muted">
            Readings left: {remaining.day} today · {remaining.month} this month.
          </p>
        </div>
      </aside>
    </div>
  );
}
