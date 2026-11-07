import { expect, test } from 'vitest';
import { civilDateLabel, timeLabel } from '../../src/client/astrology/chart-context.tsx';
import type { BirthDraft } from '../../src/contracts/astrology.ts';

const place = {
  source: 'manual',
  label: 'Kathmandu',
  latitudeDeg: 27.7,
  longitudeEastDeg: 85.3,
  zone: 'Asia/Kathmandu',
} as const;
const birth = (time: BirthDraft['time']): BirthDraft => ({
  date: '1992-10-12',
  place,
  time,
  historicalZoneConfirmed: false,
});

test('a civil birth date reads as day, month and year, with no time zone to shift it', () => {
  expect(civilDateLabel('1992-10-12')).toBe('12 October 1992');
  expect(civilDateLabel('2024-03-01')).toBe('1 March 2024');
  expect(civilDateLabel('1900-12-31')).toBe('31 December 1900');
});

test('birth times read on a 12-hour clock and keep their seconds, occurrence and range', () => {
  expect(timeLabel(birth({ certainty: 'exact', localTime: '08:30' }))).toBe('Exact · 8:30 AM');
  expect(timeLabel(birth({ certainty: 'exact', localTime: '08:30:15' }))).toBe(
    'Exact · 8:30:15 AM',
  );
  expect(timeLabel(birth({ certainty: 'exact', localTime: '00:05' }))).toBe('Exact · 12:05 AM');
  expect(timeLabel(birth({ certainty: 'exact', localTime: '12:00' }))).toBe('Exact · 12:00 PM');
  expect(timeLabel(birth({ certainty: 'exact', localTime: '23:59' }))).toBe('Exact · 11:59 PM');
  expect(timeLabel(birth({ certainty: 'exact', localTime: '01:30', fold: 'earlier' }))).toBe(
    'Exact · 1:30 AM · earlier occurrence',
  );
  expect(
    timeLabel(
      birth({ certainty: 'approximate', earliestLocalTime: '08:00', latestLocalTime: '10:00' }),
    ),
  ).toBe('Approximate · 8:00–10:00 AM');
  expect(
    timeLabel(
      birth({ certainty: 'approximate', earliestLocalTime: '11:00', latestLocalTime: '13:30' }),
    ),
  ).toBe('Approximate · 11:00 AM–1:30 PM');
  expect(timeLabel(birth({ certainty: 'unknown' }))).toBe('Birth time unknown · full local day');
});
