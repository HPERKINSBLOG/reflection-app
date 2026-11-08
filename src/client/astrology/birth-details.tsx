import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { z } from 'zod';
import {
  BirthDraft,
  BirthProfileView,
  BirthTimeResolution,
  BirthPlaceResults,
  type BirthPlace,
  type PlaceCandidate,
} from '../../contracts/astrology.ts';
import { api, ApiFailure } from '../api.ts';
import { Button, Input } from '../design/components.tsx';
import { Art } from '../art.tsx';
import { Notice } from '../notice.tsx';
import { useAstrologyAction } from './use-action.ts';
import { civilDateLabel, timeLabel } from './chart-context.tsx';
export interface BirthDetailsHandle {
  hasUnsavedChanges(): boolean;
  isBusy(): boolean;
}
type View = z.infer<typeof BirthProfileView>;
export function BirthDetails({
  ref,
  view,
  initialBirth,
  csrf,
  onSaved,
  onCancel,
  onExpired,
}: {
  ref?: Ref<BirthDetailsHandle>;
  view: View;
  initialBirth?: BirthDraft;
  csrf: string;
  onSaved: (view: View) => void;
  onCancel: () => void;
  onExpired: () => void;
}) {
  const initial = useRef(initialBirth ?? view.profile?.birth);
  const [date, setDate] = useState(initial.current?.date ?? '');
  const [place, setPlace] = useState<BirthPlace | null>(initial.current?.place ?? null);
  const [manual, setManual] = useState(initial.current?.place.source === 'manual');
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<PlaceCandidate[] | null>(null);
  const [label, setLabel] = useState(initial.current?.place.label ?? '');
  const [latitude, setLatitude] = useState(
    initial.current ? String(initial.current.place.latitudeDeg) : '',
  );
  const [longitude, setLongitude] = useState(
    initial.current ? String(initial.current.place.longitudeEastDeg) : '',
  );
  const [zone, setZone] = useState(initial.current?.place.zone ?? '');
  const [certainty, setCertainty] = useState<BirthDraft['time']['certainty']>(
    initial.current?.time.certainty ?? 'exact',
  );
  const [clock, setClock] = useState(
    initial.current?.time.certainty === 'exact' ? initial.current.time.localTime : '',
  );
  const [earliest, setEarliest] = useState(
    initial.current?.time.certainty === 'approximate' ? initial.current.time.earliestLocalTime : '',
  );
  const [latest, setLatest] = useState(
    initial.current?.time.certainty === 'approximate' ? initial.current.time.latestLocalTime : '',
  );
  const [historical, setHistorical] = useState(initial.current?.historicalZoneConfirmed ?? false);
  const [resolution, setResolution] = useState<BirthTimeResolution | null>(null),
    [review, setReview] = useState<BirthDraft | null>(null);
  const [revision, setRevision] = useState(view.revision),
    [changed, setChanged] = useState<View | null>(null),
    [conflict, setConflict] = useState(false);
  const [retention, setRetention] = useState(false),
    [dirty, setDirty] = useState(Boolean(initialBirth));
  const intent = useRef<{ payload: string; key: string } | null>(null),
    unresolved = useRef<BirthDraft | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { busy, notice, setNotice, run } = useAstrologyAction(onExpired);
  useImperativeHandle(ref, () => ({ hasUnsavedChanges: () => dirty || busy, isBusy: () => busy }));
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const edited = () => {
    setDirty(true);
    setResolution(null);
    setReview(null);
    setRetention(false);
    setNotice(null);
  };
  const reviewBirth = (birth: BirthDraft) =>
    void run(async (current) => {
      unresolved.current = birth;
      const value = await api('/astrology/birth/resolve', BirthTimeResolution, birth, csrf);
      if (!current()) return;
      setResolution(value);
      if (value.kind === 'resolved') {
        setReview(birth);
        setRetention(false);
        requestAnimationFrame(() => heading.current?.focus());
      }
    });
  const draft = (): BirthDraft | null => {
    if (manual && (!latitude.trim() || !longitude.trim())) {
      setNotice({ tone: 'error', text: 'Enter both coordinates, including 0 when appropriate.' });
      return null;
    }
    const input = BirthDraft.safeParse({
      date,
      place: manual
        ? {
            source: 'manual',
            label,
            latitudeDeg: Number(latitude),
            longitudeEastDeg: Number(longitude),
            zone,
          }
        : place,
      time:
        certainty === 'exact'
          ? { certainty, localTime: clock }
          : certainty === 'approximate'
            ? { certainty, earliestLocalTime: earliest, latestLocalTime: latest }
            : { certainty },
      historicalZoneConfirmed: historical,
    });
    if (!input.success) {
      setNotice({
        tone: 'error',
        text: 'Check the birth date, select a birthplace and complete the time information. An approximate range must end after it starts on the same day.',
      });
      return null;
    }
    return input.data;
  };
  const save = () => {
    if (!review || !retention || conflict) return;
    void run(async (current) => {
      const body = { birth: review, expectedRevision: revision, confirmedRetention: true as const };
      const payload = JSON.stringify(body);
      if (intent.current?.payload !== payload)
        intent.current = { payload, key: crypto.randomUUID() };
      try {
        const result = await api('/astrology/profile', BirthProfileView, body, csrf, {
          method: 'PUT',
          key: intent.current.key,
        });
        if (current()) {
          setDirty(false);
          onSaved(result);
        }
      } catch (error) {
        if (
          current() &&
          error instanceof ApiFailure &&
          error.status === 409 &&
          error.code === 'CONFLICT'
        ) {
          setConflict(true);
          setNotice({
            tone: 'error',
            text: 'Your birth details changed in another window. Your draft is still here. Review the current profile before replacing it.',
          });
        } else throw error;
      }
    });
  };
  return (
    <section className="birth-details" aria-busy={busy}>
      <header className="pattern-page-heading">
        <p className="eyebrow">Your chart · {review ? '2' : '1'} of 2</p>
        <h2 ref={heading} tabIndex={-1}>
          {review ? 'Does this look right?' : 'Your birth details'}
        </h2>
        <p>
          {review
            ? 'These details determine which chart information we can show.'
            : 'Start with what you know. You can update this later.'}
        </p>
      </header>
      <Notice message={notice} />
      {busy && (
        <p role="status">{review ? 'Saving your birth details…' : 'Checking your details…'}</p>
      )}
      <div className="birth-columns">
        <div>
          {conflict && (
            <section className="notice" aria-label="Birth profile conflict">
              <h3>Review the current profile</h3>
              {changed ? (
                <>
                  <p>
                    {changed.profile
                      ? `${civilDateLabel(changed.profile.birth.date)} · ${changed.profile.birth.place.label} · ${timeLabel(changed.profile.birth)}`
                      : 'The current profile was removed.'}
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setRevision(changed.revision);
                      setConflict(false);
                      setChanged(null);
                      setReview(null);
                      setRetention(false);
                      intent.current = null;
                      setNotice({
                        tone: 'notice',
                        text: 'Your draft is kept. Review it again before replacing the current profile.',
                      });
                    }}
                  >
                    Review my draft again
                  </Button>
                </>
              ) : (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async (current) => {
                      const value = await api('/astrology/profile', BirthProfileView);
                      if (current()) setChanged(value);
                    })
                  }
                >
                  Load current birth details
                </Button>
              )}
            </section>
          )}
          {review ? (
            <div className="birth-review">
              <dl>
                <dt>Birth date</dt>
                <dd>{civilDateLabel(review.date)}</dd>
                <dt>Birthplace</dt>
                <dd>
                  {review.place.label}
                  <small>{review.place.zone} · local civil time</small>
                </dd>
                <dt>Birth time</dt>
                <dd>{timeLabel(review)}</dd>
              </dl>
              <p>
                Houses, angles and aspects are not calculated. We only show sign placements
                supported throughout the time you supplied.
              </p>
              <p>
                Creating a chart stores these birth details in your encrypted account until you
                remove them. Saved chapters keep their original birth details; delete those readings
                separately to remove their copies.
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={retention}
                  disabled={busy || conflict}
                  onChange={(e) => setRetention(e.target.checked)}
                />
                Keep these birth details in my account.
              </label>
              <div className="actions">
                <Button disabled={busy || !retention || conflict} onClick={save}>
                  {view.profile ? 'Update my chart' : 'Create my chart'}
                </Button>
                <Button
                  variant="text-button"
                  disabled={busy}
                  onClick={() => {
                    setReview(null);
                    setRetention(false);
                    setResolution(null);
                  }}
                >
                  Edit date, place or time
                </Button>
              </div>
            </div>
          ) : (
            <form
              autoComplete="off"
              onSubmit={(event) => {
                event.preventDefault();
                const birth = draft();
                if (birth) reviewBirth(birth);
              }}
              onChange={edited}
            >
              <fieldset disabled={busy || conflict} className="birth-fields">
                <label htmlFor="birth-date">Birth date</label>
                <Input
                  id="birth-date"
                  type="date"
                  min="1900-01-01"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
                <p className="field-hint">Use the date recorded at your birthplace.</p>
                {!manual ? (
                  <>
                    <label htmlFor="birthplace-search">Find your birthplace</label>
                    <div className="place-search">
                      <Input
                        id="birthplace-search"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setResults(null);
                        }}
                        placeholder="City or town"
                        maxLength={240}
                      />
                      <Button
                        variant="secondary"
                        disabled={[...query.trim()].length < 2}
                        onClick={() =>
                          void run(async (current) => {
                            const value = await api(
                              '/astrology/places/search',
                              BirthPlaceResults,
                              { query },
                              csrf,
                            );
                            if (current()) setResults(value.items);
                          })
                        }
                      >
                        Search places
                      </Button>
                    </div>
                    {results && (
                      <section aria-label="Birthplace results">
                        <p className="field-hint">
                          Choose the place and time zone that match your record.
                        </p>
                        {results.length === 0 && (
                          <p>No matching places. You can enter the place manually.</p>
                        )}
                        <ul className="place-results">
                          {results.map((candidate) => (
                            <li key={candidate.sourceId}>
                              <Button
                                variant="text-button"
                                onClick={() => {
                                  setPlace(candidate);
                                  setResults(null);
                                  edited();
                                }}
                              >
                                {candidate.label}
                                <small>{candidate.zone}</small>
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {place && (
                      <p role="status" className="selected-place">
                        Selected: {place.label} · {place.zone}
                      </p>
                    )}
                    <Button
                      variant="text-button"
                      onClick={() => {
                        setManual(true);
                        setPlace(null);
                        edited();
                      }}
                    >
                      Enter a place manually
                    </Button>
                  </>
                ) : (
                  <>
                    <label htmlFor="manual-place">Place name</label>
                    <Input
                      id="manual-place"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      required
                      maxLength={200}
                    />
                    <div className="birth-coordinate-fields">
                      <label htmlFor="birth-latitude">
                        Latitude (north positive)
                        <Input
                          id="birth-latitude"
                          type="number"
                          step="any"
                          min="-90"
                          max="90"
                          value={latitude}
                          onChange={(e) => setLatitude(e.target.value)}
                          required
                        />
                      </label>
                      <label htmlFor="birth-longitude">
                        Longitude (east positive)
                        <Input
                          id="birth-longitude"
                          type="number"
                          step="any"
                          min="-180"
                          max="180"
                          value={longitude}
                          onChange={(e) => setLongitude(e.target.value)}
                          required
                        />
                      </label>
                    </div>
                    <label htmlFor="birth-zone">IANA time zone</label>
                    <Input
                      id="birth-zone"
                      value={zone}
                      onChange={(e) => setZone(e.target.value)}
                      placeholder="e.g. America/New_York"
                      required
                      maxLength={100}
                    />
                    <p className="field-hint">
                      Confirm the coordinates and historical time zone for this place.
                    </p>
                    <Button
                      variant="text-button"
                      onClick={() => {
                        setManual(false);
                        setPlace(null);
                        edited();
                      }}
                    >
                      Search for a birthplace instead
                    </Button>
                  </>
                )}
                <fieldset className="birth-certainty">
                  <legend>How well do you know the time?</legend>
                  {(['exact', 'approximate', 'unknown'] as const).map((value) => (
                    <Button
                      key={value}
                      variant={certainty === value ? 'primary' : 'secondary'}
                      aria-pressed={certainty === value}
                      onClick={() => {
                        setCertainty(value);
                        edited();
                      }}
                    >
                      {value === 'exact'
                        ? 'Exact'
                        : value === 'approximate'
                          ? 'Approximate'
                          : 'Unknown'}
                    </Button>
                  ))}
                </fieldset>
                {certainty === 'exact' && (
                  <>
                    <label htmlFor="birth-clock">Local birth time</label>
                    <Input
                      id="birth-clock"
                      type="time"
                      step={1}
                      value={clock}
                      onChange={(e) => setClock(e.target.value)}
                      required
                    />
                  </>
                )}
                {certainty === 'approximate' && (
                  <div className="birth-coordinate-fields">
                    <label htmlFor="birth-earliest">
                      Earliest local time
                      <Input
                        id="birth-earliest"
                        type="time"
                        step={1}
                        value={earliest}
                        onChange={(e) => setEarliest(e.target.value)}
                        required
                      />
                    </label>
                    <label htmlFor="birth-latest">
                      Latest local time
                      <Input
                        id="birth-latest"
                        type="time"
                        step={1}
                        value={latest}
                        onChange={(e) => setLatest(e.target.value)}
                        required
                      />
                    </label>
                  </div>
                )}
                {certainty === 'unknown' && (
                  <p>We use the whole local day. Time-sensitive placements may be left out.</p>
                )}
                {resolution?.kind === 'fold' && (
                  <section className="notice">
                    <h3>This time happened twice.</h3>
                    <p>
                      The clocks moved back on this date. Choose the occurrence from your birth
                      record.
                    </p>
                    {resolution.choices.map((choice) => (
                      <Button
                        key={choice.at}
                        variant="secondary"
                        onClick={() => {
                          const b = unresolved.current;
                          if (b?.time.certainty === 'exact')
                            reviewBirth({
                              ...b,
                              time: {
                                ...b.time,
                                fold: choice.fold,
                                offsetSeconds: choice.offsetSeconds,
                              },
                            });
                        }}
                      >
                        {choice.fold === 'earlier' ? 'Earlier occurrence' : 'Later occurrence'} ·
                        UTC{choice.offsetSeconds >= 0 ? '+' : '−'}
                        {Math.abs(choice.offsetSeconds / 3600)}
                      </Button>
                    ))}
                  </section>
                )}
                {(resolution?.kind === 'gap' || resolution?.kind === 'invalid') && (
                  <Notice message={{ tone: 'error', text: resolution.message }} />
                )}
                {resolution?.kind === 'historical_confirmation_required' && (
                  <p className="notice">{resolution.message}</p>
                )}
                {(date < '1970-01-01' || historical) && date && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={historical}
                      onChange={(e) => setHistorical(e.target.checked)}
                    />
                    I have checked the historical time zone for this place.
                  </label>
                )}
                <Button type="submit">Review details</Button>
              </fieldset>
            </form>
          )}
          <Button variant="text-button" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <aside className="pattern-context birth-guidance">
          <h3>{review ? 'Room for uncertainty' : 'An honest starting point'}</h3>
          <p>
            An uncertain time is useful information. We make the limits visible and leave out
            details that depend on a time you do not know.
          </p>
          <Art name="account-sprig" className="pattern-sprig" sizes="320px" />
          <p className="field-hint">
            Place search uses GeoNames (CC BY 4.0). Smaller localities may need manual entry.
          </p>
        </aside>
      </div>
    </section>
  );
}
