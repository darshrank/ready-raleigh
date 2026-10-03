// Mayoral candidates: Open Peeps busts (CC0) printed in the design inks on a campaign card.
// The SVGs use var(--ink) and var(--bond), so they are inlined rather than shown with <img>.
import { useEffect, useState } from 'react';
import type { CandidateId } from '@shared';

/** Campaign card colours by seat: the spot inks that carry ink lines (DESIGN.md tokens). */
export const SEAT_INKS = ['var(--signal)', 'var(--safe)', 'var(--alarm)', 'var(--flood)'] as const;
export const seatInk = (seat: number) => SEAT_INKS[seat % SEAT_INKS.length]!;

const cache = new Map<string, Promise<string>>();
function portrait(id: CandidateId): Promise<string> {
  if (!cache.has(id)) cache.set(id, fetch(`/candidates/${id}.svg`).then((r) => (r.ok ? r.text() : '')));
  return cache.get(id)!;
}

export function Portrait({ id, bg, className = '' }: { id: CandidateId; bg: string; className?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let on = true;
    portrait(id).then((s) => on && setSvg(s));
    return () => {
      on = false;
    };
  }, [id]);
  return (
    <div
      className={`overflow-hidden border-(length:--rule) border-ink [&>svg]:mx-auto [&>svg]:mt-[6%] [&>svg]:h-[94%] ${className}`}
      style={{ background: bg }}
      // Trusted: our own build output (app/scripts/candidates.mjs), never user content.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** The campaign card: portrait, name, "for mayor". */
export function CandidateCard({
  id, name, seat, size = 'md', badge, dim = false,
}: { id: CandidateId; name: string; seat: number; size?: 'sm' | 'md' | 'lg'; badge?: string; dim?: boolean }) {
  const w = size === 'lg' ? 'w-48' : size === 'sm' ? 'w-28' : 'w-36';
  return (
    <figure className={`${w} shrink-0 border-(length:--rule) border-ink bg-bond p-2 shadow-plate ${dim ? 'opacity-50' : ''}`}>
      <Portrait id={id} bg={seatInk(seat)} className="aspect-square w-full" />
      <figcaption className="mt-2 text-center leading-tight">
        <span className="block truncate font-display text-18 font-extrabold uppercase">{name}</span>
        <span className="block text-13 tracking-wide">{badge ?? 'For mayor'}</span>
      </figcaption>
    </figure>
  );
}
