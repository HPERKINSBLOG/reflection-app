import type { MouseEvent, ReactNode, Ref } from 'react';
import { Art } from './art.tsx';

export const signInPath = '/sign-in';

/** The three reading positions, as the welcome page introduces them. */
const positions = [
  { art: 'position-situation', name: 'Situation', detail: 'What’s here now' },
  { art: 'position-tension', name: 'Tension', detail: 'What pulls against it' },
  { art: 'position-possibility', name: 'Possibility', detail: 'What could open up' },
] as const;

/**
 * The signed-out welcome page invites a first reading; sign-in is one step away at /sign-in.
 * A deletion receipt, when present, comes first and carries the page heading.
 */
export function Invitation({
  heading,
  receipt,
  notice,
  checking,
  environment,
  onSignIn,
}: {
  heading: Ref<HTMLHeadingElement>;
  receipt: ReactNode;
  notice: ReactNode;
  checking: boolean;
  environment: string;
  onSignIn: (event: MouseEvent<HTMLAnchorElement>, startNew: boolean) => void;
}) {
  const title = 'A little space to reflect.';
  return (
    <main className="invitation">
      <Art name="hero-rose" className="landing-rose" fetchPriority="high" />
      <div className="shell-width invitation-content">
        <div className="invitation-intro">
          {receipt}
          {receipt ? (
            <h2 className="invitation-title">{title}</h2>
          ) : (
            <h1 ref={heading} tabIndex={-1} className="invitation-title">
              {title}
            </h1>
          )}
          <p className="invitation-lead">Bring a question. Make room for another perspective.</p>
          {notice}
          {checking ? (
            <p role="status" className="busy-line">
              <span className="spinner" aria-hidden="true" />
              Checking your session…
            </p>
          ) : (
            <div className="invitation-actions">
              <a
                className="button-link"
                href={`${signInPath}?start=new`}
                onClick={(event) => onSignIn(event, true)}
              >
                Draw three cards
              </a>
              <a
                className="button-link secondary"
                href={signInPath}
                onClick={(event) => onSignIn(event, false)}
              >
                I have an account
              </a>
            </div>
          )}
        </div>
        <section className="positions" aria-labelledby="positions-title">
          <h2 id="positions-title" className="positions-title">
            Reflection positions
          </h2>
          <ol className="position-tiles" aria-labelledby="positions-title">
            {positions.map((position, index) => (
              <li key={position.name} className="position-tile">
                <span className="position-tile-body">
                  <span className="position-tile-number">{index + 1}</span>
                  <span className="position-tile-copy">
                    <strong className="position-tile-name">{position.name}</strong>
                    <span className="position-tile-detail">{position.detail}</span>
                  </span>
                </span>
                <Art name={position.art} className="position-plate" loading="lazy" />
              </li>
            ))}
          </ol>
        </section>
        <p className="invitation-closing">
          Reflection, not prediction. Save what’s useful, write what it means to you, and return
          with time.
        </p>
        <p className="test-notice">{environment}</p>
      </div>
    </main>
  );
}
