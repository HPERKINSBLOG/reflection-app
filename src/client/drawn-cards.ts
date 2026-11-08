import { cardName } from './card-names.ts';

type Position = 'situation' | 'tension' | 'possibility';
type Orientation = 'upright' | 'reversed';

export const POSITION_LABELS = {
  situation: 'Situation',
  tension: 'Tension',
  possibility: 'Possibility',
} as const satisfies Record<Position, string>;

export interface DrawnCard {
  position: Position;
  label: (typeof POSITION_LABELS)[Position];
  cardId: string;
  orientation: Orientation;
  name: string | undefined;
}

/** The parts of an accepted tarot reading that name its three cards. */
export interface DrawnCardSource {
  kind: string;
  basis: {
    deckEdition: string;
    cards: ReadonlyArray<{ position: Position; cardId: string; orientation: Orientation }>;
  };
  draw?: ReadonlyArray<{ position: Position; name: string }>;
}

const ORDER: readonly Position[] = ['situation', 'tension', 'possibility'];

/**
 * The spread's cards left to right. A v2 reading carries the names it was drawn with;
 * older and v3 readings look theirs up in the exact deck edition's catalogue.
 */
export function drawnCards(reading: DrawnCardSource): DrawnCard[] {
  return ORDER.flatMap((position) => {
    const card = reading.basis.cards.find((item) => item.position === position);
    if (!card) return [];
    const name =
      reading.kind === 'tarot.accepted.v2'
        ? reading.draw?.find((item) => item.position === position)?.name
        : cardName(reading.basis.deckEdition, card.cardId);
    return [
      {
        position,
        label: POSITION_LABELS[position],
        cardId: card.cardId,
        orientation: card.orientation,
        name,
      },
    ];
  });
}
