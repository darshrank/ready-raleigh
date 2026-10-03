// Planning juice (DESIGN.md "Game pieces"): the "+N residents" chip above the aim point, and what
// happens when a piece lands: a --safe coverage ring pulses out, a +N chip floats away, the stamp
// sound plays, and phones vibrate 15 ms. The disc's own stamp is in plan/layers.ts.
import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { score } from '@shared/engine';
import type { Placement } from '@shared/types';
import type { MapData } from '../data';
import { playStamp } from '../ui/sound';
import { targetOf, usePlan } from './store';
import { anchorOf } from './targets';
import { soloPlan, type Preview } from './usePlanScore';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
/** The chip sits this far above the target, clear of the 30 px disc. */
const CHIP_LIFT_PX = 26;

/** Re-render when the map moves, so screen positions follow it. */
function useMapMoves(map: MapLibreMap | null, active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!map || !active) return;
    let raf = 0;
    const onMove = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    map.on('move', onMove);
    return () => {
      cancelAnimationFrame(raf);
      map.off('move', onMove);
    };
  }, [map, active]);
}

const chipClass =
  'pointer-events-none absolute z-10 whitespace-nowrap border-(length:--rule) border-ink bg-safe px-2 py-0.5 font-display text-24 leading-none font-extrabold text-ink shadow-piece tabular';

/** "+N residents" riding above the piece being aimed (mouse hover, drag, or keyboard cursor). */
export function AimChip({ map, data, preview }: { map: MapLibreMap | null; data: MapData; preview: Preview | null }) {
  const show = !!map && !!preview && !preview.problem && preview.gain !== 0;
  useMapMoves(map, show);
  if (!show || !map || !preview) return null;
  const t = targetOf(preview.piece);
  const at = t && anchorOf(data, t);
  if (!at) return null;
  const p = map.project(at);
  return (
    <p
      key={JSON.stringify(t)}
      aria-hidden
      className={chipClass + ' animate-[chip-pop_160ms_ease-out_both]'}
      style={{ left: p.x, top: p.y - CHIP_LIFT_PX, transform: 'translate(-50%, -100%)' }}
    >
      {signed(preview.gain)} <span className="font-body text-13 font-semibold">residents</span>
    </p>
  );
}

interface Landing {
  key: number;
  x: number;
  y: number;
  gain: number;
}

const coarse = () => window.matchMedia('(pointer: coarse)').matches;

/** Effects for each piece that lands (placed or moved). */
export function LandingFx({ map, data }: { map: MapLibreMap | null; data: MapData }) {
  const [fx, setFx] = useState<Landing[]>([]);
  const next = useRef(0);
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(
    () =>
      usePlan.subscribe((s, prev) => {
        if (s.placements === prev.placements || s.phase !== 'planning') return;
        const before = new Map(prev.placements.map((p) => [p.id, JSON.stringify(targetOf(p))]));
        const landed = s.placements.filter((p: Placement) => before.get(p.id) !== JSON.stringify(targetOf(p)));
        const m = mapRef.current;
        if (landed.length === 0 || !m) return;
        const gain = score(soloPlan(s.placements), data).protectedPeople - score(soloPlan(prev.placements), data).protectedPeople;
        playStamp();
        if (coarse()) navigator.vibrate?.(15);
        const out: Landing[] = [];
        for (const p of landed) {
          const t = targetOf(p);
          const at = t && anchorOf(data, t);
          if (!at) continue;
          const { x, y } = m.project(at);
          out.push({ key: next.current++, x, y, gain });
        }
        setFx((list) => [...list, ...out]);
        const keys = new Set(out.map((f) => f.key));
        window.setTimeout(() => setFx((list) => list.filter((f) => !keys.has(f.key))), 1300);
      }),
    [data],
  );

  return (
    <>
      {fx.map((f) => (
        <div key={f.key} aria-hidden>
          <span
            className="pointer-events-none absolute size-[150px] rounded-full border-[3px] border-safe opacity-0 outline-2 outline-ink animate-[ring-pulse_650ms_cubic-bezier(.2,.7,.3,1)_both]"
            style={{ left: f.x, top: f.y }}
          />
          <p
            className={chipClass + ' opacity-0 animate-[chip-float_1250ms_ease-out_both]'}
            style={{ left: f.x, top: f.y - CHIP_LIFT_PX }}
          >
            {signed(f.gain)} <span className="font-body text-13 font-semibold">residents</span>
          </p>
        </div>
      ))}
    </>
  );
}
