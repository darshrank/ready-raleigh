// The planning HUD (DESIGN.md "Layouts", planning): plates that float on the full-bleed map.
// Top center: budget, timer, residents covered. Bottom: the tray of chunky pieces, the placed
// pieces, Start the storm, and the status line above them. Top right: Tilt, Satellite, Light or
// Dark, Layers, Sound.
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { BUDGET } from '@shared/config';
import type { Placement, ScoreResult } from '@shared/types';
import type { MapData } from '../data';
import { DISC_BOX, PIECE_INFO, cityPieces, discSvg, minPieceCost, pieceCost, pieceCovers, pieceName, type FloodPiece } from '../plan/pieces';
import { currentStory } from '../story';
import { targetOf, usePlan } from '../plan/store';
import { targetLabel } from '../plan/targets';
import { pieceGain, type Preview } from '../plan/usePlanScore';
import { useMapUi } from '../store';
import { useTheme } from '../theme';
import { tokens } from '../tokens';
import { clock, money } from './format';
import { FacilitiesControl, Legend, PeopleLayerControl } from './MapRail';
import { unlockAudio, useSound } from './sound';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const CHIP = 1_000_000;
/** The timer turns --alarm and pulses for this many final seconds. */
const HURRY_S = 30;

/** A floating plate: bond, ink rule, hard ink shadow. */
export const PLATE = 'border-(length:--rule) border-ink bg-bond shadow-plate';

export function Disc({ piece, size, selected = false, shadow = true }: { piece: FloodPiece; size: number; selected?: boolean; shadow?: boolean }) {
  const { hex } = tokens();
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      // Without the shadow, crop to the rim (face radius 30 + half the 5-unit stroke, around 36,36).
      viewBox={shadow ? `0 0 ${DISC_BOX} ${DISC_BOX}` : '3.5 3.5 65 65'}
      className="shrink-0 overflow-visible"
      dangerouslySetInnerHTML={{ __html: discSvg(piece, { ink: hex.ink, face: selected ? hex.signal : hex.bond }, shadow) }}
    />
  );
}

/** Budget: the amount left over a row of --signal chips, one per $1M, spent ones hollow. */
function Budget({ left, compact }: { left: number; compact: boolean }) {
  const total = Math.round(BUDGET / CHIP);
  const have = Math.max(0, Math.round(left / CHIP));
  return (
    <div className="flex flex-col justify-center px-3 py-1.5 lg:px-4 lg:py-2" role="img" aria-label={`${money(left)} left in budget`}>
      <p className="tabular flex items-baseline gap-1.5 leading-none">
        <span className={'font-display font-extrabold ' + (compact ? 'text-32' : 'text-48')}>{money(left)}</span>
        <span className="text-13">left</span>
      </p>
      <span aria-hidden className={'mt-1 flex ' + (compact ? 'gap-0.5' : 'gap-1')}>
        {Array.from({ length: total }, (_, k) => (
          <span
            key={k}
            className={
              'rounded-full border-[1.5px] border-ink ' +
              (compact ? 'size-[7px] ' : 'size-2.5 ') +
              (k < have ? 'bg-signal' : 'border-dashed bg-transparent opacity-50')
            }
          />
        ))}
      </span>
    </div>
  );
}

/** Planning clock. When it runs out, planning ends as if the player started the storm. */
function Timer({ compact }: { compact: boolean }) {
  const endsAt = usePlan((s) => s.endsAt);
  const phase = usePlan((s) => s.phase);
  const endPlanning = usePlan((s) => s.endPlanning);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== 'planning' || endsAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [phase, endsAt]);
  const left = endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));
  useEffect(() => {
    if (phase === 'planning' && left === 0) endPlanning();
  }, [phase, left, endPlanning]);
  const hurry = phase === 'planning' && left !== null && left <= HURRY_S;
  return (
    <p
      className={
        'tabular flex items-center justify-center font-display leading-none font-extrabold ' +
        (hurry ? 'animate-[timer-pulse_1s_ease-in-out_infinite] bg-alarm text-ink ' : 'bg-ink text-signal ') +
        (compact ? 'min-w-[4.2ch] px-2 text-32' : 'min-w-[4.2ch] px-4 text-72')
      }
      aria-label={left === null ? 'Planning timer' : `${left} seconds left to plan`}
    >
      {phase !== 'planning' ? clock(0) : clock(left ?? 0)}
    </p>
  );
}

/**
 * Residents the plan covers, out of the people still at risk once the existing shelters are full
 * (score() minus its baseline).
 */
function Covered({ result, compact }: { result: ScoreResult | null; compact: boolean }) {
  const existing = result?.baseline.protectedPeople ?? 0;
  const stillAtRisk = result ? result.protectedPeople + result.strandedPeople - existing : 0;
  const covered = result ? result.protectedPeople - existing : 0;
  return (
    <div className="flex flex-col justify-center px-3 py-1.5 lg:px-4 lg:py-2" aria-live="polite" aria-atomic>
      <p className="tabular flex items-baseline gap-1.5 leading-none">
        <span className={'font-display font-extrabold ' + (compact ? 'text-32' : 'text-48')}>{fmt(covered)}</span>
        <span className="text-13">covered</span>
      </p>
      <p className="tabular mt-1 text-13 leading-none">
        of {fmt(stillAtRisk)} at risk{compact ? '' : `, score ${Math.round(result?.score ?? 0)}`}
      </p>
      {!compact && existing >= 1 && (
        <p className="tabular mt-1 text-13 leading-none">existing shelters already take {fmt(existing)}</p>
      )}
    </div>
  );
}

/** Top center: budget, timer, covered, in one plate. */
export function TopHud({ left, result, compact }: { left: number; result: ScoreResult | null; compact: boolean }) {
  return (
    <div className={PLATE + ' pointer-events-auto flex items-stretch divide-x-(length:--rule) divide-ink'}>
      <Budget left={left} compact={compact} />
      <Timer compact={compact} />
      <Covered result={result} compact={compact} />
    </div>
  );
}

/** One chunky piece in the tray: lifts when armed or hovered, presses down when clicked. */
function TrayPiece({ piece, left, size, onArmed }: { piece: FloodPiece; left: number; size: number; onArmed: (byKeyboard: boolean) => void }) {
  const armed = usePlan((s) => s.armed);
  const arm = usePlan((s) => s.arm);
  const phase = usePlan((s) => s.phase);
  const cost = pieceCost(piece);
  const least = minPieceCost(piece);
  const planning = phase === 'planning';
  const affordable = least <= left;
  const usable = affordable && planning;
  const on = armed === piece;
  const info = PIECE_INFO[piece];
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-disabled={!usable}
      aria-keyshortcuts={info.key}
      title={`${pieceCovers(piece)}. Key ${info.key}.`}
      onClick={(e: MouseEvent) => {
        unlockAudio();
        if (!planning) return;
        if (!affordable) {
          arm(piece); // explains why in the status line
          return;
        }
        arm(on ? null : piece);
        // e.detail is 0 for a keyboard click: hand the keys to the map.
        if (!on) onArmed(e.detail === 0);
      }}
      className={'group flex flex-col items-center gap-1 px-1 text-center ' + (usable ? '' : 'opacity-40')}
    >
      <span
        className={
          'block rounded-full transition-[transform,filter] duration-100 ' +
          (on
            ? '-translate-x-0.5 -translate-y-1 drop-shadow-[7px_7px_0_var(--ink)]'
            : 'drop-shadow-[5px_5px_0_var(--ink)] group-hover:-translate-y-0.5 group-hover:drop-shadow-[6px_6px_0_var(--ink)] group-active:translate-x-0.5 group-active:translate-y-0.5 group-active:drop-shadow-[2px_2px_0_var(--ink)]')
        }
      >
        <Disc piece={piece} size={size} selected={on} shadow={false} />
      </span>
      <span className="mt-1 text-13 leading-tight font-semibold lg:text-15">{pieceName(piece)}</span>
      <span className={'tabular font-display text-24 leading-none font-extrabold ' + (affordable || !planning ? '' : 'text-alarm')}>
        {least < cost ? `$${least / 1e6}–${cost / 1e6}M` : money(cost)}
      </span>
    </button>
  );
}

/** Every placed piece as a small disc button: the keyboard way to select one. */
function Placed({ data, onSelect }: { data: MapData; onSelect: (id: string, byKeyboard: boolean) => void }) {
  const placements = usePlan((s) => s.placements);
  const selectedId = usePlan((s) => s.selectedId);
  if (placements.length === 0) return null;
  return (
    <ul aria-label="Your plan" className="flex max-w-[220px] flex-wrap content-center gap-1.5">
      {placements.map((p: Placement) => {
        const t = targetOf(p);
        const on = p.id === selectedId;
        return (
          <li key={p.id}>
            <button
              type="button"
              aria-pressed={on}
              aria-label={`${pieceName(p.type as FloodPiece)} at ${t ? targetLabel(data, t) : ''}`}
              title={`${pieceName(p.type as FloodPiece)} at ${t ? targetLabel(data, t) : ''}`}
              onClick={(e) => onSelect(p.id, e.detail === 0)}
              className="block rounded-full"
            >
              <Disc piece={p.type as FloodPiece} size={34} selected={on} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function StartStorm({ wide }: { wide: boolean }) {
  const phase = usePlan((s) => s.phase);
  const endPlanning = usePlan((s) => s.endPlanning);
  if (phase !== 'planning') return null;
  return (
    <button
      type="button"
      onClick={() => {
        unlockAudio();
        endPlanning();
      }}
      className={
        'border-(length:--rule) border-ink bg-ink px-5 py-3 font-display text-24 leading-none font-extrabold text-signal shadow-piece hover:bg-signal hover:text-ink active:translate-x-0.5 active:translate-y-0.5 active:shadow-none lg:text-32 ' +
        (wide ? 'w-full' : 'self-center')
      }
    >
      {currentStory().start}
    </button>
  );
}

/** Bottom: the tray of pieces, the placed pieces and Start the storm. */
export function Tray({
  data,
  left,
  compact,
  onArmed,
  onSelect,
}: {
  data: MapData;
  left: number;
  compact: boolean;
  onArmed: (byKeyboard: boolean) => void;
  onSelect: (id: string, byKeyboard: boolean) => void;
}) {
  return (
    <div className={PLATE + ' pointer-events-auto flex flex-col gap-3 px-3 pt-3 pb-3 lg:flex-row lg:items-stretch lg:gap-5 lg:px-5'}>
      <div role="group" aria-label="Pieces" className="grid gap-2 lg:gap-4" style={{ gridTemplateColumns: `repeat(${cityPieces().length}, minmax(0, 1fr))` }}>
        {cityPieces().map((piece) => (
          <TrayPiece key={piece} piece={piece} left={left} size={compact ? 56 : 76} onArmed={onArmed} />
        ))}
      </div>
      {!compact && (
        <div className="flex items-center gap-5 border-l-(length:--rule) border-ink pl-5">
          <Placed data={data} onSelect={onSelect} />
          <StartStorm wide={false} />
        </div>
      )}
      {compact && <StartStorm wide />}
    </div>
  );
}

const ARMED_HINT: Record<FloodPiece, () => string> = {
  shelter: () => `Tap a building square on the map to open a ${pieceName('shelter').toLowerCase()} there. Green houses already exist.`,
  bus_pickup: () => 'Tap a yellow block, where people without a car are at risk. Small squares are existing bus stops ($0.5M).',
  road_protection: () => `Tap a pink ${currentStory().roadKind} road to keep it open.`,
};

/** What to do next, what the hovered target would do, or the selected piece with Remove. */
export function Status({ data, preview }: { data: MapData; preview: Preview | null }) {
  const placements = usePlan((s) => s.placements);
  const armed = usePlan((s) => s.armed);
  const selectedId = usePlan((s) => s.selectedId);
  const notice = usePlan((s) => s.notice);
  const phase = usePlan((s) => s.phase);
  const remove = usePlan((s) => s.remove);
  const selected = placements.find((p) => p.id === selectedId) ?? null;
  const gain = useMemo(() => (selected ? pieceGain(data, placements, selected.id) : 0), [data, placements, selected]);

  let body: ReactNode;
  if (phase !== 'planning') body = <p>Planning is over. Your plan is locked in.</p>;
  else if (notice) body = <p className="border-l-4 border-alarm pl-2">{notice}</p>;
  else if (preview) {
    const t = targetOf(preview.piece);
    const name = t ? targetLabel(data, t) : '';
    const site = preview.piece.type === 'shelter' ? data.sites.find((s) => s.id === preview.piece.siteId) : null;
    const current = placements.find((p) => p.id === preview.piece.id);
    const inPlace = !!current && JSON.stringify(targetOf(current)) === JSON.stringify(t);
    body = (
      <p>
        <strong>{name}</strong>
        {preview.problem
          ? `. ${preview.problem}`
          : inPlace
            ? '. The piece is here now. Move the cursor to pick another spot, then press Enter.'
            : site && site.floodStep !== null
              ? `. ${currentStory().siteLost}, so a ${pieceName('shelter').toLowerCase()} here helps no one.`
              : preview.piece.type === 'bus_pickup' && preview.gain < 0.5
                ? `. No ${pieceName('shelter').toLowerCase()} within 15 minutes of these blocks has seats left for bus riders.`
                : `: covers ${fmt(preview.gain)} more residents${preview.piece.stopId ? '. Existing stop, $0.5M' : ''}.`}
      </p>
    );
  } else if (armed) body = <p>{ARMED_HINT[armed]()} Press Esc to cancel.</p>;
  else if (selected) {
    const t = targetOf(selected);
    body = (
      <div className="flex items-center justify-between gap-3">
        <p>
          <strong>
            {pieceName(selected.type as FloodPiece)} at {t ? targetLabel(data, t) : 'nowhere'}
          </strong>
          . Adds {fmt(gain)} residents. Drag it to move it.
        </p>
        <button
          type="button"
          onClick={() => remove(selected.id)}
          className="shrink-0 border-(length:--rule) border-ink bg-bond px-3 py-1 text-15 font-semibold shadow-piece hover:bg-chalk"
        >
          Remove
        </button>
      </div>
    );
  } else if (placements.length === 0)
    body = (
      <p>
        Place your first {pieceName('shelter').toLowerCase()}. Pick it below, then tap a building square on the map.
        {(data.existingShelters?.length ?? 0) > 0 ? ' Green dots are people the existing shelters already keep safe.' : ''}
      </p>
    );
  else body = <p>Tap a piece on the map to move or remove it.</p>;

  return (
    <div aria-live="polite" className={PLATE + ' pointer-events-auto max-w-xl px-3 py-2 text-15'}>
      {body}
    </div>
  );
}

/** A small square control on the map: bond plate, ink rule, hard shadow; ink when on. */
export function MapButton({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={
        'pointer-events-auto flex h-10 min-w-10 items-center justify-center gap-1.5 border-(length:--rule) border-ink px-2.5 text-15 font-semibold shadow-piece ' +
        (on ? 'bg-ink text-bond' : 'bg-bond text-ink hover:bg-chalk')
      }
    >
      {children}
    </button>
  );
}

/** Sound on or off (DESIGN.md "Sound": always show a mute toggle). */
export function SoundButton() {
  const on = useSound((s) => s.on);
  const toggle = useSound((s) => s.toggle);
  return (
    <MapButton on={!on} label={on ? 'Sound on. Turn it off.' : 'Sound off. Turn it on.'} onClick={toggle}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="fill-current stroke-current">
        <path d="M3 7h3l5-4v14l-5-4H3z" strokeWidth="0" />
        {on ? (
          <path d="M14 6.5a5 5 0 0 1 0 7M16 4a8.5 8.5 0 0 1 0 12" fill="none" strokeWidth="2" strokeLinecap="round" />
        ) : (
          <path d="M14 7l5 6M19 7l-5 6" fill="none" strokeWidth="2" strokeLinecap="round" />
        )}
      </svg>
    </MapButton>
  );
}

/** Light or Dark map (theme.ts). The sun and moon say which one is on. */
export function ThemeButton() {
  const dark = useTheme((s) => s.theme === 'dark');
  const toggle = useTheme((s) => s.toggle);
  return (
    <MapButton on={dark} label={dark ? 'Dark map. Switch to light.' : 'Light map. Switch to dark.'} onClick={toggle}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="fill-current stroke-current">
        {dark ? (
          <path d="M12.5 2.5a7.5 7.5 0 1 0 5 12 6.5 6.5 0 0 1-5-12z" strokeWidth="0" />
        ) : (
          <>
            <circle cx="10" cy="10" r="3.6" strokeWidth="0" />
            <path d="M10 1.5v2.2M10 16.3v2.2M1.5 10h2.2M16.3 10h2.2M4 4l1.6 1.6M14.4 14.4 16 16M4 16l1.6-1.6M14.4 5.6 16 4" fill="none" strokeWidth="1.8" strokeLinecap="round" />
          </>
        )}
      </svg>
    </MapButton>
  );
}

/** Satellite imagery under the streets, names and water instead of the printed land. */
export function SatelliteButton() {
  const on = useMapUi((s) => s.satellite);
  const set = useMapUi((s) => s.setSatellite);
  return (
    <MapButton on={on} label={on ? 'Satellite map. Switch to the printed map.' : 'Printed map. Switch to satellite.'} onClick={() => set(!on)}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="fill-none stroke-current" strokeWidth="1.8" strokeLinejoin="round">
        <rect x="7.2" y="7.2" width="5.6" height="5.6" transform="rotate(45 10 10)" />
        <path d="M5.8 5.8 2.5 2.5M14.2 14.2l3.3 3.3M2 6.5 6.5 2M13.5 18 18 13.5" strokeLinecap="round" />
        <path d="M13 3.5a4.5 4.5 0 0 1 3.5 3.5" strokeLinecap="round" />
      </svg>
      <span className="hidden lg:inline">Satellite</span>
    </MapButton>
  );
}

/** The two looks of the map, together wherever the map has controls. */
export function MapLookButtons() {
  return (
    <>
      <SatelliteButton />
      <ThemeButton />
    </>
  );
}

/** Top right: Tilt, Satellite, Light or Dark, Layers (toggles, the legend, the keys) and Sound. */
export function MapControls({ phase }: { phase: 'planning' | 'storm' | 'results' }) {
  const tilt = useMapUi((s) => s.tilt);
  const setTilt = useMapUi((s) => s.setTilt);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        {phase !== 'storm' && (
          <MapButton on={tilt} label="Tilt the map to 3D" onClick={() => setTilt(!tilt)}>
            3D
          </MapButton>
        )}
        <MapLookButtons />
        <MapButton on={open} label="Layers and legend" onClick={() => setOpen(!open)}>
          Layers
        </MapButton>
        <SoundButton />
      </div>
      {open && (
        <div className={PLATE + ' pointer-events-auto grid max-h-[60svh] w-72 gap-4 overflow-y-auto p-4'}>
          <div className="grid gap-3">
            <FacilitiesControl />
            <PeopleLayerControl />
          </div>
          <Legend planning={phase === 'planning'} storm={phase !== 'planning'} />
          <p className="hidden text-13 lg:block">
            Keys: 1, 2, 3 pick a piece. Arrows move the cursor, Enter places or moves, Delete removes, Esc cancels, + and − zoom.
          </p>
        </div>
      )}
    </div>
  );
}
