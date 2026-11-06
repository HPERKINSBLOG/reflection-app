import { expect, test } from 'vitest';
import draft from '../../content/launch-canon-draft.json';
import { cardCrop } from '../../src/client/card-face.tsx';

test('no two cards in a suit share a crop of the suit study', () => {
  const crops = new Map<string, string>();
  for (const card of draft.deck) {
    const key = `${card.id.split('-')[0]}:${JSON.stringify(cardCrop(card.id))}`;
    expect(crops.get(key), `${card.id} repeats the crop of ${crops.get(key)}`).toBeUndefined();
    crops.set(key, card.id);
  }
  expect(crops.size).toBe(78);
  // The critique's example: The Hermit and Temperance showed the same picture.
  expect(cardCrop('major-09')).not.toEqual(cardCrop('major-14'));
});
