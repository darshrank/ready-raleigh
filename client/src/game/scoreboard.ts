// Animated scoreboard: rows reorder with a FLIP transition when the ranking changes.
import type { PublicState } from '@rr/shared';
import { h } from '../ui/dom.ts';
import { fmtScore, reducedMotion } from '../ui/format.ts';

let lastRects = new Map<number, number>();

export function scoreboard(s: PublicState, roundScores?: Map<number, number>): HTMLElement {
  const list = h(
    'ol',
    { class: 'board', 'aria-label': 'Scoreboard' },
    ...s.ranking.map((seat, i) => {
      const p = s.players.find((x) => x.seat === seat)!;
      const gained = roundScores?.get(seat);
      return h(
        'li',
        { class: `board__row ${seat === s.you ? 'is-you' : ''}`, 'data-seat': String(seat), style: `--pc:${p.color}` },
        h('span', { class: 'board__rank num' }, String(i + 1)),
        h('span', { class: 'board__hat', 'aria-hidden': 'true' }, p.shape),
        h('span', { class: 'board__name' }, p.name, p.spectator ? h('span', { class: 'avatar__tag' }, 'next round') : ''),
        gained !== undefined ? h('span', { class: 'board__gain num' }, `+${fmtScore(gained)}`) : '',
        h('span', { class: 'board__score num' }, fmtScore(p.score)),
      );
    }),
  );
  // FLIP: animate from the previous positions after insertion.
  requestAnimationFrame(() => {
    const rows = [...list.querySelectorAll<HTMLElement>('.board__row')];
    const now = new Map(rows.map((r) => [Number(r.dataset.seat), r.getBoundingClientRect().top]));
    if (!reducedMotion()) {
      for (const r of rows) {
        const prev = lastRects.get(Number(r.dataset.seat));
        const cur = now.get(Number(r.dataset.seat))!;
        if (prev !== undefined && Math.abs(prev - cur) > 1) {
          r.animate([{ transform: `translateY(${prev - cur}px)` }, { transform: 'translateY(0)' }], { duration: 700, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
        }
      }
    }
    lastRects = now;
  });
  return list;
}
