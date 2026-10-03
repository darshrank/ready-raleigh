// Planning phase controls (P6): budget chips, timer, residents covered, tray, status, plan list.
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { BUDGET } from '@shared/config';
import type { Placement, ScoreResult } from '@shared/types';
import type { MapData } from '../data';
import { DISC_BOX, FLOOD_PIECES, PIECE_INFO, discSvg, pieceCost, type FloodPiece } from '../plan/pieces';
import { targetOf, usePlan } from '../plan/store';
import { targetLabel } from '../plan/targets';
import { pieceGain, type Preview } from '../plan/usePlanScore';
import { tokens } from '../tokens';
import { clock, money } from './format';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const CHIP = 1_000_000;

export function Disc({ piece, size, selected = false }: { piece: FloodPiece; size: number; selected?: boolean }) {
  const { hex } = tokens();
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox={`0 0 ${DISC_BOX} ${DISC_BOX}`}
      className="shrink-0"
      dangerouslySetInnerHTML={{ __html: discSvg(piece, { ink: hex.ink, face: selected ? hex.signal : hex.bond }) }}
    />
  );
}

/** Budget: a stack of --signal chips, one per $1M, that shrinks as money is spent. */
export function Budget({ left, compact = false }: { left: number; compact?: boolean }) {
  const total = Math.round(BUDGET / CHIP);
  const have = Math.max(0, Math.round(left / CHIP));
  return (
    <div className="flex items-end gap-3" aria-label={`${money(left)} left in budget`} role="img">
      <div aria-hidden className={'flex flex-col-reverse ' + (compact ? 'gap-px' : 'gap-0.5')}>
        {Array.from({ length: total }, (_, k) => (
          <span
            key={k}
            className={
              (compact ? 'h-[3px] w-6 ' : 'h-[7px] w-10 ') +
              (k < have ? 'bg-signal outline-[1.5px] outline-ink outline -outline-offset-[1.5px]' : 'bg-transparent')
            }
          />
        ))}
      </div>
      <p className="tabular leading-none">
        <span className={'block font-display font-extrabold ' + (compact ? 'text-24' : 'text-48')}>{money(left)}</span>
        <span className="text-13">left in budget</span>
      </p>
    </div>
  );
}

/** Planning clock. When it runs out, planning ends as if the player started the storm. */
export function Timer({ compact = false }: { compact?: boolean }) {
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
  return (
    <p
      className={
        'tabular border-(length:--rule) border-ink bg-ink px-3 font-display font-bold leading-none text-signal ' +
        (compact ? 'py-1 text-24' : 'py-2 text-48')
      }
      aria-label={left === null ? 'Planning timer' : `${left} seconds left to plan`}
    >
      {phase !== 'planning' ? '0:00' : clock(left ?? 0)}
    </p>
  );
}

/** "Residents covered", straight from score().protectedPeople, with the hovered piece's gain. */
export function Covered({ result, preview }: { result: ScoreResult | null; preview: Preview | null }) {
  const atRiskPeople = result ? result.protectedPeople + result.strandedPeople : 0;
  const gain = preview && !preview.problem ? preview.gain : null;
  return (
    <div aria-live="polite" aria-atomic>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular font-display text-48 leading-none font-extrabold lg:text-72">
          {fmt(result?.protectedPeople ?? 0)}
        </span>
        <span className="text-18 font-semibold">residents covered</span>
        {gain !== null && (
          <span className="tabular bg-safe px-2 py-0.5 text-15 font-semibold text-ink">
            {gain >= 0 ? '+' : '−'}
            {fmt(Math.abs(gain))}
          </span>
        )}
      </p>
      <p className="tabular mt-1 text-13">
        of {fmt(atRiskPeople)} residents at risk ({Math.round(result?.score ?? 0)} on the score)
      </p>
    </div>
  );
}

/** The tray: one disc per flood piece, its cost under it. Pieces the budget can't cover are dimmed. */
export function Tray({ left, onArmed }: { left: number; onArmed: (byKeyboard: boolean) => void }) {
  const armed = usePlan((s) => s.armed);
  const arm = usePlan((s) => s.arm);
  const phase = usePlan((s) => s.phase);
  return (
    <div role="group" aria-label="Pieces" className="grid grid-cols-3 gap-2">
      {FLOOD_PIECES.map((piece) => {
        const cost = pieceCost(piece);
        const planning = phase === 'planning';
        const affordable = cost <= left;
        const usable = affordable && planning;
        const on = armed === piece;
        const info = PIECE_INFO[piece];
        return (
          <button
            key={piece}
            type="button"
            aria-pressed={on}
            aria-disabled={!usable}
            aria-keyshortcuts={info.key}
            title={`${info.covers}. Key ${info.key}.`}
            onClick={(e: MouseEvent) => {
              if (!planning) return;
              if (!affordable) {
                arm(piece); // explains why in the status line
                return;
              }
              arm(on ? null : piece);
              // e.detail is 0 for a keyboard click: hand the keys to the map.
              if (!on) onArmed(e.detail === 0);
            }}
            className={
              'flex flex-col items-center gap-1 border-(length:--rule) px-1 pt-2 pb-1.5 text-center ' +
              (on ? 'border-ink bg-chalk ' : 'border-transparent hover:border-ink ') +
              (usable ? '' : 'opacity-40')
            }
          >
            <Disc piece={piece} size={52} selected={on} />
            <span className="text-13 leading-tight font-semibold">{info.name}</span>
            <span className={'tabular font-display text-24 leading-none font-bold ' + (affordable || !planning ? '' : 'text-alarm')}>
              {money(cost)}
            </span>
          </button>
        );
      })}
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
  const gain = useMemo(
    () => (selected ? pieceGain(data, placements, selected.id) : 0),
    [data, placements, selected],
  );

  let body;
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
      <div className="flex items-start justify-between gap-3">
        <p>
          <strong>
            {PIECE_INFO[selected.type as FloodPiece].name} at {t ? targetLabel(data, t) : 'nowhere'}
          </strong>
          . Adds {fmt(gain)} residents. Drag it to move it.
        </p>
        <button
          type="button"
          onClick={() => remove(selected.id)}
          className="shrink-0 border-(length:--rule) border-ink bg-bond px-3 py-1 text-15 font-semibold hover:bg-chalk"
        >
          Remove
        </button>
      </div>
    );
  } else if (placements.length === 0)
    body = <p>Place your first shelter. Pick it below, then tap a building square on the map.</p>;
  else body = <p>Tap a piece on the map to move or remove it.</p>;

  return (
    <div aria-live="polite" className="min-h-[3.2em] text-15">
      {body}
    </div>
  );
}

/** Every placed piece, as buttons: the keyboard way to select one. */
export function PlanList({ data, onSelect }: { data: MapData; onSelect: (id: string, byKeyboard: boolean) => void }) {
  const placements = usePlan((s) => s.placements);
  const selectedId = usePlan((s) => s.selectedId);
  const remove = usePlan((s) => s.remove);
  const phase = usePlan((s) => s.phase);
  if (placements.length === 0) return null;
  return (
    <section aria-labelledby="plan-title">
      <h2 id="plan-title" className="text-15 font-semibold">
        Your plan
      </h2>
      <ul className="mt-1.5 grid grid-cols-[minmax(0,1fr)] gap-1">
        {placements.map((p: Placement) => {
          const t = targetOf(p);
          const on = p.id === selectedId;
          return (
            <li key={p.id} className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={on}
                disabled={phase !== 'planning'}
                onClick={(e) => onSelect(p.id, e.detail === 0)}
                className={'flex min-w-0 flex-1 items-center gap-2 px-1 py-0.5 text-left text-15 ' + (on ? 'bg-signal' : 'hover:bg-chalk')}
              >
                <Disc piece={p.type as FloodPiece} size={26} selected={on} />
                <span className="truncate">
                  <span className="font-semibold">{PIECE_INFO[p.type as FloodPiece].name}</span>{' '}
                  {t ? targetLabel(data, t) : ''}
                </span>
              </button>
              {phase === 'planning' && (
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  className="shrink-0 px-2 py-0.5 text-13 underline"
                  aria-label={`Remove ${PIECE_INFO[p.type as FloodPiece].name.toLowerCase()} at ${t ? targetLabel(data, t) : ''}`}
                >
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function StartStorm() {
  const phase = usePlan((s) => s.phase);
  const endPlanning = usePlan((s) => s.endPlanning);
  if (phase !== 'planning') return null;
  return (
    <button
      type="button"
      onClick={endPlanning}
      className="w-full border-(length:--rule) border-ink bg-ink px-4 py-3 text-left font-display text-24 font-extrabold text-signal hover:bg-bond hover:text-ink"
    >
      Start the storm
    </button>
  );
}
