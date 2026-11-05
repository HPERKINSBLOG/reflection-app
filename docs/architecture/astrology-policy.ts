export const ASTROLOGY_LIMITS = Object.freeze({
  bodyBytes: 32768,
  placeResults: 20,
  queryMinCodePoints: 2,
  queryMaxCodePoints: 120,
  calculationsPerDay: 30,
  evaluatedInstants: 2048,
  minimumGuardDeg: 0.05,
  earliestDate: '1900-01-01',
});

export const CHAPTER_BODIES = {
  self: 'sun',
  connection: 'venus',
  rest: 'saturn',
  growth: 'jupiter',
} as const;

export const ZODIAC_SIGNS = [
  'aries',
  'taurus',
  'gemini',
  'cancer',
  'leo',
  'virgo',
  'libra',
  'scorpio',
  'sagittarius',
  'capricorn',
  'aquarius',
  'pisces',
] as const;

export const NATAL_BODIES = [
  'sun',
  'moon',
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
] as const;
