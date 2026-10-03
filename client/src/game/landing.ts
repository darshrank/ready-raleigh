// Landing (PLAN §8.3 #1): orbiting 3D Raleigh with light rain; start a solo game.
import { DEFAULT_SETTINGS, ROUND_COUNTS, TIMERS_S, type GameSettings, type Rules } from '@rr/shared';
import type { GameMap } from '../map/createMap.ts';
import { h, svg } from '../ui/dom.ts';
import { reducedMotion } from '../ui/format.ts';
import { icons } from '../ui/icons.ts';

const ORBIT_CENTER: [number, number] = [-78.6342, 35.8215]; // Crabtree Creek at Anderson Drive
const PREFS = 'rr.soloSettings';

function loadPrefs(): GameSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<GameSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export class Landing {
  private root: HTMLElement;
  private orbit = 0;
  private rain: Rain | null = null;
  private settings = loadPrefs();

  constructor(
    private gm: GameMap,
    ui: HTMLElement,
    onPlay: (s: GameSettings) => Promise<void>,
    party: { create: () => void; join: () => void },
  ) {
    const play = h('button', { class: 'btn btn--big', 'data-play-solo': '' }, 'Play solo') as HTMLButtonElement;
    play.addEventListener('click', async () => {
      play.disabled = true;
      play.textContent = 'Starting…';
      try {
        localStorage.setItem(PREFS, JSON.stringify(this.settings));
      } catch {}
      try {
        await onPlay(this.settings);
      } finally {
        play.disabled = false;
        play.textContent = 'Play solo';
      }
    });
    const seg = <T extends string | number>(label: string, key: keyof GameSettings, opts: readonly T[], fmt: (v: T) => string) =>
      h(
        'div',
        { class: 'seg', role: 'radiogroup', 'aria-label': label },
        h('span', { class: 'seg__label' }, label),
        ...opts.map((v) => {
          const b = h('button', { class: `seg__opt ${this.settings[key] === v ? 'is-on' : ''}`, role: 'radio', 'aria-checked': String(this.settings[key] === v) }, fmt(v));
          b.addEventListener('click', () => {
            (this.settings as unknown as Record<string, unknown>)[key] = v;
            b.parentElement!.querySelectorAll('.seg__opt').forEach((x) => {
              x.classList.toggle('is-on', x === b);
              x.setAttribute('aria-checked', String(x === b));
            });
          });
          return b;
        }),
      );
    const rules: Record<Rules, string> = { normal: 'Normal', no_lenses: 'No lenses', pro: 'Pro' };
    this.root = h(
      'div',
      { class: 'landing' },
      h(
        'section',
        { class: 'card hero' },
        h('div', { class: 'hero__brand' }, h('div', { class: 'brand__mark' }, svg(icons.mark)), h('span', { class: 'eyebrow' }, 'Crabtree Creek · Raleigh, NC')),
        h('h1', { class: 'hero__title' }, 'Ready Raleigh'),
        h('p', { class: 'hero__tag' }, 'Read real neighborhoods like a GeoGuessr pro. Learn where the water goes — and who it reaches.'),
        play,
        h('div', { class: 'hero__soon' }, h('button', { class: 'btn btn--ghost', 'data-party': '', onclick: party.create }, 'Play with friends'), h('button', { class: 'chip', 'data-join': '', onclick: party.join }, 'Join with code'), h('button', { class: 'chip', disabled: true }, 'Daily Challenge', h('span', { class: 'pill pill--soon' }, 'Soon'))),
        h('details', { class: 'hero__opts' }, h('summary', {}, 'Game options'), seg('Rounds', 'rounds', ROUND_COUNTS, String), seg('Timer', 'timerS', TIMERS_S, (v) => `${v}s`), seg('Rules', 'rules', ['normal', 'no_lenses', 'pro'] as const, (v) => rules[v])),
      ),
      h('footer', { class: 'landing__foot' }, 'Educational game, not official emergency guidance. In a real flood, follow ', h('a', { href: 'https://www.readync.gov', target: '_blank', rel: 'noopener' }, 'ReadyNC'), ' and the ', h('a', { href: 'https://www.weather.gov/rah/', target: '_blank', rel: 'noopener' }, 'National Weather Service'), '.'),
    );
    ui.append(this.root);
    this.startOrbit();
    if (!reducedMotion()) this.rain = new Rain(this.root);
  }

  private startOrbit(): void {
    const map = this.gm.map;
    map.jumpTo({ center: ORBIT_CENTER, zoom: 14.6, pitch: 55, bearing: map.getBearing() });
    if (reducedMotion()) return;
    let last = performance.now();
    let pausedUntil = 0;
    const pause = () => (pausedUntil = performance.now() + 8000); // let the user look around
    map.getCanvas().addEventListener('pointerdown', pause);
    map.getCanvas().addEventListener('wheel', pause, { passive: true });
    const step = (t: number) => {
      const dt = t - last;
      last = t;
      if (!map.isMoving() && t > pausedUntil) map.setBearing((map.getBearing() + dt * 0.004) % 360);
      this.orbit = requestAnimationFrame(step);
    };
    this.orbit = requestAnimationFrame(step);
  }

  destroy(): void {
    cancelAnimationFrame(this.orbit);
    this.rain?.stop();
    this.root.remove();
  }
}

/** Light rain: a few hundred streaks on a canvas, paused when the tab is hidden. */
class Rain {
  private canvas = h('canvas', { class: 'rain', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  private raf = 0;
  private drops: { x: number; y: number; v: number; l: number }[] = [];

  constructor(parent: HTMLElement) {
    parent.prepend(this.canvas);
    const ctx = this.canvas.getContext('2d')!;
    const resize = () => {
      this.canvas.width = innerWidth;
      this.canvas.height = innerHeight;
    };
    resize();
    addEventListener('resize', resize);
    const n = Math.round((innerWidth * innerHeight) / 9000);
    this.drops = Array.from({ length: n }, () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, v: 6 + Math.random() * 6, l: 8 + Math.random() * 10 }));
    const draw = () => {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.strokeStyle = 'rgba(200, 220, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of this.drops) {
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 2, d.y + d.l);
        d.y += d.v;
        d.x -= 0.6;
        if (d.y > this.canvas.height) {
          d.y = -d.l;
          d.x = Math.random() * (this.canvas.width + 50);
        }
      }
      ctx.stroke();
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
  }
}
