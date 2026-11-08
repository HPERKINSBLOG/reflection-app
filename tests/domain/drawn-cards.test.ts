import { expect, test } from 'vitest';
import catalog from '../../src/client/card-names.json';
import { drawnCards } from '../../src/client/drawn-cards.ts';

// Given out of order on purpose: the helper always reads left to right.
const cards = [
  { position: 'possibility', cardId: 'swords-02', orientation: 'upright' },
  { position: 'situation', cardId: 'major-09', orientation: 'reversed' },
  { position: 'tension', cardId: 'major-14', orientation: 'upright' },
] as const;

test('v2 names come from the draw, in position order', () => {
  const result = drawnCards({
    kind: 'tarot.accepted.v2',
    basis: { deckEdition: 'unknown', cards: [...cards] },
    draw: [
      { position: 'tension', name: 'B' },
      { position: 'possibility', name: 'C' },
      { position: 'situation', name: 'A' },
    ],
  });
  expect(result.map((card) => card.position)).toEqual(['situation', 'tension', 'possibility']);
  expect(result.map((card) => card.name)).toEqual(['A', 'B', 'C']);
  expect(result.map((card) => card.label)).toEqual(['Situation', 'Tension', 'Possibility']);
  expect(result.map((card) => [card.cardId, card.orientation])).toEqual([
    ['major-09', 'reversed'],
    ['major-14', 'upright'],
    ['swords-02', 'upright'],
  ]);
});

test('v1 and v3 names come from the edition catalogue', () => {
  const editions: Record<string, Record<string, string>> = catalog;
  const edition = Object.keys(editions)[0]!;
  for (const kind of ['tarot.accepted.v1', 'tarot.accepted.v3']) {
    const named = drawnCards({ kind, basis: { deckEdition: edition, cards: [...cards] } });
    expect(named.map((card) => card.name)).toEqual([
      editions[edition]!['major-09'],
      editions[edition]!['major-14'],
      editions[edition]!['swords-02'],
    ]);
    expect(named.every((card) => card.name)).toBe(true);
    const unknown = drawnCards({ kind, basis: { deckEdition: 'unknown', cards: [...cards] } });
    expect(unknown.map((card) => card.name)).toEqual([undefined, undefined, undefined]);
  }
});
