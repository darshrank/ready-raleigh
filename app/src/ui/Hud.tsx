// The planning HUD (DESIGN.md "Layouts", planning): plates that float on the full-bleed map.
// Top center: budget, timer, residents covered. Bottom: the tray of chunky pieces, the placed
// pieces, Start the storm, and the status line above them. Top right: Tilt, Layers, Sound.
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { BUDGET } from '@shared/config';
import type { Placement, ScoreResult } from '@shared/types';
import type { MapData } from '../data';
import { DISC_BOX, FLOOD_PIECES, PIECE_INFO, discSvg, pieceCost, type FloodPiece } from '../plan/pieces';
import { targetOf, usePlan } from '../plan/store';
import { targetLabel } from '../plan/targets';
import { pieceGain, type Preview } from '../plan/usePlanScore';
import { useMapUi } from '../store';
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

/** "Residents covered", straight from score().protectedPeople. */
function Covered({ result, compact }: { result: ScoreResult | null; compact: boolean }) {
  const atRisk = result ? result.protectedPeople + result.strandedPeople : 0;
  return (
    <div className="flex flex-col justify-center px-3 py-1.5 lg:px-4 lg:py-2" aria-live="polite" aria-atomic>
      <p className="tabular flex items-baseline gap-1.5 leading-none">
        <span className={'font-display font-extrabold ' + (compact ? 'text-32' : 'text-48')}>{fmt(result?.protectedPeople ?? 0)}</span>
        <span className="text-13">covered</span>
      </p>
      <p className="tabular mt-1 text-13 leading-none">
        of {fmt(atRisk)} at risk{compact ? '' : `, score ${Math.round(result?.score ?? 0)}`}
      </p>
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
  const planning = phase === 'planning';
  const affordable = cost <= left;
  const usable = affordable && planning;
  const on = armed === piece;
  const info = PIECE_INFO[piece];
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-disabled={!usable}
      aria-keyshortcuts={info.key}
      title={`${info.covers}. Key ${info.key}.`}
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
      <span className="mt-1 text-13 leading-tight font-semibold lg:text-15">{info.name}</span>
      <span className={'tabular font-display text-24 leading-none font-extrabold ' + (affordable || !planning ? '' : 'text-alarm')}>
        {money(cost)}
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
              aria-label={`${PIECE_INFO[p.type as FloodPiece].name} at ${t ? targetLabel(data, t) : ''}`}
              title={`${PIECE_INFO[p.type as FloodPiece].name} at ${t ? targetLabel(data, t) : ''}`}
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
      Start the storm
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
      <div role="group" aria-label="Pieces" className="grid grid-cols-3 gap-2 lg:gap-4">
        {FLOOD_PIECES.map((piece) => (
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

const ARMED_HINT: Record<FloodPiece, string> = {
  shelter: 'Tap a building square on the map to open a shelter there.',
  bus_pickup: 'Tap the map where a bus should pick up people with no car.',
  road_protection: 'Tap a pink flood-prone road to keep it open.',
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
              ? '. This building floods, so a shelter here helps no one.'
              : `: covers ${fmt(preview.gain)} more residents.`}
      </p>
    );
  } else if (armed) body = <p>{ARMED_HINT[armed]} Press Esc to cancel.</p>;
  else if (selected) {
    const t = targetOf(selected);
    body = (
      <div className="flex items-center justify-between gap-3">
        <p>
          <strong>
            {PIECE_INFO[selected.type as FloodPiece].name} at {t ? targetLabel(data, t) : 'nowhere'}
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
  } else if (placements.length === 0) body = <p>Place your first shelter. Pick it below, then tap a building square on the map.</p>;
  else body = <p>Tap a piece on the map to move or remove it.</p>;

  return (
    <div aria-live="polite" className={PLATE + ' pointer-events-auto max-w-xl px-3 py-2 text-15'}>
      {body}
    </div>
  );
}

/** A small square control on the map: bond plate, ink rule, hard shadow; ink when on. */
function MapButton({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: ReactNode }) {
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

/** Top right: Tilt, Layers (the map's toggles, the legend, the keys) and Sound. */
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
