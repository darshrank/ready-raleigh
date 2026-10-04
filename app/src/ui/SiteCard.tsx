import { FLOOD_STEP_NAMES, SHELTER_CAPACITY } from '@shared/config';
import { useMapUi } from '../store';

const KIND: Record<string, string> = {
  school: 'School',
  place_of_worship: 'Place of worship',
  library: 'Library',
  community_centre: 'Community center',
};

const WIDTH = 248;

/**
 * A shelter site's card (z15+, map/detail.ts): name, type and how many people a shelter there
 * holds. It follows the mouse on the site's building, or sits where a phone tapped it.
 */
export function SiteCard() {
  const card = useMapUi((s) => s.siteCard);
  if (!card) return null;
  const left = Math.max(8, Math.min(card.x + 16, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, card.y + 16);
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 border-(length:--rule) border-ink bg-bond px-3 py-2 text-ink shadow-piece"
      style={{ left, top, width: WIDTH }}
    >
      <p className="text-15 leading-snug font-semibold">{card.name}</p>
      <p className="text-13">{KIND[card.kind] ?? card.kind}</p>
      <p className="mt-1 text-13">
        {SHELTER_CAPACITY === null ? 'Shelter with no set capacity' : `Shelter for up to ${SHELTER_CAPACITY.toLocaleString('en-US')} people`}
      </p>
      {card.floodStep !== null && (
        <p className="mt-1 text-13 font-semibold">Floods ({FLOOD_STEP_NAMES[card.floodStep]}): a shelter here covers nobody</p>
      )}
    </div>
  );
}
