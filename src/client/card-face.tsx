import type { CSSProperties } from 'react';
import { Art, type ArtName } from './art.tsx';

type Suit = { label: string; art: ArtName; focus: readonly [x: number, y: number] };
const suits: Record<string, Suit> = {
  major: { label: 'Major Arcana', art: 'study-perspective', focus: [64, 38] },
  cups: { label: 'Cups', art: 'study-stillness', focus: [60, 45] },
  pentacles: { label: 'Pentacles', art: 'study-possibility', focus: [74, 36] },
  wands: { label: 'Wands', art: 'study-tension', focus: [50, 50] },
  swords: { label: 'Swords', art: 'study-return', focus: [50, 50] },
};
function cardArt(cardId: string) {
  const prefix = cardId.split('-')[0]!;
  const suit = Object.hasOwn(suits, prefix) ? prefix : 'major';
  return { suit, ...suits[suit]! };
}
type CropStyle = CSSProperties &
  Record<'--art-x' | '--art-y' | '--art-zoom' | '--art-flip', string>;
/**
 * Each card gets its own crop of its suit's study, so two cards from one suit don't show the
 * same picture. The card number picks one of 36 crops: three focal points across and three
 * down around the suit's focus, two zoom levels, and a mirror. Stepping by 13 keeps
 * neighbouring numbers apart, and no two cards in a suit share a crop.
 */
export function cardCrop(cardId: string): CropStyle {
  const [x, y] = cardArt(cardId).focus;
  const number = Number.parseInt(cardId.split('-')[1] ?? '', 10) || 0;
  const crop = (number * 13) % 36;
  const clamp = (value: number) => Math.min(82, Math.max(18, value));
  const across = (Math.floor(crop / 12) % 3) - 1;
  const down = (Math.floor(crop / 4) % 3) - 1;
  return {
    '--art-x': `${clamp(x + across * 20)}%`,
    '--art-y': `${clamp(y + down * 14)}%`,
    '--art-zoom': Math.floor(crop / 2) % 2 ? '1.9' : '1.5',
    '--art-flip': crop % 2 ? '-1' : '1',
  };
}
export function CardFace({
  cardId,
  orientation,
  name,
}: {
  cardId: string;
  orientation: 'upright' | 'reversed';
  name: string | undefined;
}) {
  const { suit, label, art } = cardArt(cardId);
  return (
    <div className={`card-face suit-${suit}`} aria-hidden="true">
      <div className="card-face-inner">
        <div className={`card-face-art ${orientation}`} style={cardCrop(cardId)}>
          <Art name={art} />
        </div>
        <div className="card-face-caption">
          <span className="caption">{label}</span>
          <span className="card-face-name">{name ?? cardId}</span>
          <span className="caption orientation">{orientation}</span>
        </div>
      </div>
    </div>
  );
}
export function CardThumbnail({
  cardId,
  orientation,
}: {
  cardId: string;
  orientation: 'upright' | 'reversed';
}) {
  const { suit, art } = cardArt(cardId);
  return <Art name={art} className={`source-art suit-${suit} ${orientation}`} />;
}
