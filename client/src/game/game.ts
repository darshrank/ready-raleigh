// The game screen: brief → play → reveal → results, driven entirely by server state.
import { LineLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import maplibregl from 'maplibre-gl';
import { LENSES, type LensId, type LngLat, type PublicRound, type PublicState, type Reveal, type Source } from '@rr/shared';
import type { GameMap } from '../map/createMap.ts';
import { clearLenses, LENS_META, setLens } from '../map/lenses.ts';
import { call, serverNow } from '../net/socket.ts';
import { token } from '../tokens.ts';
import { h } from '../ui/dom.ts';
import { fmtDistance, fmtScore, fmtValue, reducedMotion } from '../ui/format.ts';
import { sourced } from '../ui/sourceSheet.ts';
import { lobbySheet } from './lobby.ts';
import { scoreboard } from './scoreboard.ts';
import { toast } from '../ui/toast.ts';

const TYPE_LABEL = { A: 'Read the Block', B: 'Pin It' } as const;
const STAGE_KINDS = new Set(['depth_1pct', 'first_building', 'first_road']);
const PLAZA: LngLat = [-78.6342, 35.8215]; // lobby avatars gather by the Anderson Dr gauge

interface StagesMeta {
  stages: { i: number; stage_ft: number }[];
  scenarios: Record<string, { stage_ft: number }>;
}

export class GameView {
  private root = h('div', { class: 'game' });
  private top = h('header', { class: 'card topbar' });
  private sheet = h('section', { class: 'card sheet game-sheet', 'aria-live': 'polite' });
  private rail = h('nav', { class: 'lens-rail', 'aria-label': 'Lenses' });
  private photo = h('div', { class: 'photo-slot' });
  private overlay = h('div', { class: 'brief-overlay', hidden: true });
  private state: PublicState | null = null;
  private renderedKey = '';
  private pin: LngLat | null = null;
  private pinMarker: maplibregl.Marker | null = null;
  private sliderValue: number | null = null;
  private lensOn = new Set<LensId>();
  private timerFrame = 0;
  private revealTimers: number[] = [];
  private rippleFrame = 0;
  private stagesMeta: Promise<StagesMeta> | null = null;
  private stageGeo = new Map<number, Promise<GeoJSON.FeatureCollection>>();
  private focused: string | null = null;
  private onMapClick = (e: maplibregl.MapMouseEvent) => this.placePin([e.lngLat.lng, e.lngLat.lat]);

  constructor(
    private gm: GameMap,
    private ui: HTMLElement,
    private area: string,
    private onExit: () => void,
    private tv = false,
  ) {
    this.root.classList.toggle('game--tv', tv);
    this.root.append(this.top, this.photo, this.rail, this.sheet, this.overlay);
    ui.append(this.root);
    this.ensureLayers();
    gm.map.on('click', this.onMapClick);
    // Phones: lens row sits above the sheet, and the camera centres in the visible map.
    this.resize = new ResizeObserver(() => {
      // Only a CSS variable here: changing map padding mid-flight would cancel the camera move.
      const hgt = this.sheet.hidden ? 0 : this.sheet.offsetHeight;
      this.root.style.setProperty('--sheet-h', `${hgt}px`);
    });
    this.resize.observe(this.sheet);
  }
  private resize: ResizeObserver;

  destroy(): void {
    this.resize.disconnect();
    cancelAnimationFrame(this.timerFrame);
    cancelAnimationFrame(this.rippleFrame);
    this.revealTimers.forEach(clearTimeout);
    this.gm.map.off('click', this.onMapClick);
    this.pinMarker?.remove();
    this.clearRoundMap();
    clearLenses(this.gm.map);
    this.root.remove();
  }

  // ------------------------------------------------------------------ state
  render(s: PublicState): void {
    const prev = this.state;
    this.state = s;
    const key = `${s.code}:${s.phase}:${s.roundIndex}`;
    if (s.phase === 'lobby') this.renderLobby(s, key !== this.renderedKey);
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      if (s.phase !== 'results') {
        this.sheet.classList.remove('results');
        delete document.body.dataset.results;
      }
      if (s.phase === 'brief') this.enterBrief(s);
      else if (s.phase === 'play') this.enterPlay(s, prev?.phase !== 'brief' || prev.roundIndex !== s.roundIndex);
      else if (s.phase === 'reveal') this.enterReveal(s);
      else if (s.phase === 'results') this.enterResults(s);
    }
    this.renderTop(s);
    if (s.phase === 'play') this.renderLockState(s);
    if (s.phase === 'reveal') this.renderRevealWait(s);
  }

  /** The party is controlled by the host; others see who they're waiting on. */
  private get isHost(): boolean {
    return this.state?.mode === 'solo' || this.state?.you === this.state?.hostSeat;
  }

  // ------------------------------------------------------------------ lobby
  private renderLobby(s: PublicState, first: boolean): void {
    this.overlay.hidden = true;
    this.top.hidden = true;
    this.rail.replaceChildren();
    this.photo.replaceChildren();
    this.sheet.hidden = false;
    this.sheet.classList.add('sheet--lobby');
    this.sheet.replaceChildren(lobbySheet(s, { tv: this.tv }));
    if (first) {
      this.clearRoundMap();
      this.gm.map.flyTo({ center: PLAZA, zoom: 16.2, pitch: 55, bearing: 0, padding: this.padding(), duration: reducedMotion() ? 0 : 1200 });
    }
    this.plaza(s);
    document.body.dataset.lobby = String(s.players.length);
  }

  private plazaSeen = new Map<number, number>();
  /** Avatars drop into a small plaza on the 3D map as people join. */
  private plaza(s: PublicState): void {
    const n = s.players.length;
    const now = performance.now();
    for (const p of s.players) if (!this.plazaSeen.has(p.seat)) this.plazaSeen.set(p.seat, now);
    const ground = this.gm.map.queryTerrainElevation(PLAZA) ?? 0;
    const at = (i: number): LngLat => {
      const a = (i / Math.max(n, 1)) * Math.PI * 2;
      return [PLAZA[0] + Math.cos(a) * 0.0006 * Math.min(1, n / 3 + 0.4), PLAZA[1] + Math.sin(a) * 0.00048 * Math.min(1, n / 3 + 0.4)];
    };
    const frame = () => {
      if (this.state?.phase !== 'lobby') return;
      const t = performance.now();
      const data = s.players.map((p, i) => {
        const age = Math.min(1, (t - this.plazaSeen.get(p.seat)!) / 700);
        const drop = reducedMotion() ? 0 : (1 - age) ** 2 * 120;
        const [x, y] = at(i);
        return { pos: [x, y, ground + 6 + drop], color: hex(p.color), name: p.name, away: !p.connected };
      });
      const onTop = { parameters: { depthCompare: 'always' as const, depthWriteEnabled: false } };
      this.gm.deck.setProps({
        layers: [
          new ScatterplotLayer({ ...onTop, id: 'plaza-avatars', data, getPosition: (d: { pos: number[] }) => d.pos as never, getRadius: 13, radiusUnits: 'pixels', getFillColor: (d: { color: number[]; away: boolean }) => [...d.color, d.away ? 90 : 255] as never, stroked: true, getLineColor: [255, 255, 255, 255], lineWidthUnits: 'pixels', getLineWidth: 3, updateTriggers: { getPosition: t } }),
          new TextLayer({ ...onTop, id: 'plaza-names', data, getPosition: (d: { pos: number[] }) => d.pos as never, getText: (d: { name: string }) => d.name, getSize: 13, getPixelOffset: [0, -24], getColor: [14, 17, 23, 255], background: true, getBackgroundColor: [245, 247, 250, 230], backgroundPadding: [6, 2], fontFamily: 'Inter Variable, Inter, sans-serif', characterSet: 'auto', updateTriggers: { getPosition: t } }),
        ],
      });
      if ([...this.plazaSeen.values()].some((v) => t - v < 800)) requestAnimationFrame(frame);
    };
    frame();
  }

  private get me() {
    const s = this.state!;
    return s.players.find((p) => p.seat === s.you) ?? null;
  }

  // ------------------------------------------------------------------ map layers
  private ensureLayers(): void {
    const map = this.gm.map;
    if (map.getSource('round-square')) return;
    map.addSource('round-square', { type: 'geojson', data: empty() });
    map.addLayer({ id: 'round-square', type: 'line', source: 'round-square', paint: { 'line-color': token('ink-900'), 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.55 } });
    map.addSource('focus-area', { type: 'geojson', data: empty() });
    map.addLayer({ id: 'focus-area', type: 'line', source: 'focus-area', paint: { 'line-color': token('safe'), 'line-width': 4 } });
    map.addLayer({ id: 'focus-area-fill', type: 'fill', source: 'focus-area', paint: { 'fill-color': token('safe'), 'fill-opacity': 0.2 } });
    map.addSource('reveal-water', { type: 'geojson', data: empty() });
    const before = map.getLayer('pack-buildings-3d') ? 'pack-buildings-3d' : undefined;
    map.addLayer({ id: 'reveal-water', type: 'fill', source: 'reveal-water', paint: { 'fill-color': token('water'), 'fill-opacity': 0.6 } }, before);
  }

  private clearRoundMap(): void {
    const map = this.gm.map;
    (map.getSource('round-square') as maplibregl.GeoJSONSource | undefined)?.setData(empty());
    (map.getSource('focus-area') as maplibregl.GeoJSONSource | undefined)?.setData(empty());
    (map.getSource('reveal-water') as maplibregl.GeoJSONSource | undefined)?.setData(empty());
    this.setFocusBuilding(null);
    this.gm.deck.setProps({ layers: [] });
  }

  private setFocusBuilding(id: string | null): void {
    const map = this.gm.map;
    if (!map.getSource('pack-buildings')) return;
    if (this.focused) map.setFeatureState({ source: 'pack-buildings', sourceLayer: 'buildings', id: this.focused }, { focus: false });
    this.focused = id;
    if (id) map.setFeatureState({ source: 'pack-buildings', sourceLayer: 'buildings', id }, { focus: true });
  }

  private async showRoundGeometry(r: PublicRound): Promise<void> {
    const [w, s, e, n] = r.square;
    (this.gm.map.getSource('round-square') as maplibregl.GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
    this.setFocusBuilding(r.focus?.building_id ?? null);
    if (r.focus?.block_group) {
      const people = await fetchJson<GeoJSON.FeatureCollection>(`/packs/${this.area}/lenses/people.geojson`).catch(() => null);
      const f = people?.features.find((x) => x.properties?.GEOID === r.focus!.block_group);
      if (f) {
        (this.gm.map.getSource('focus-area') as maplibregl.GeoJSONSource).setData(f);
        const b = new maplibregl.LngLatBounds();
        const walk = (c: unknown): void => (Array.isArray(c) && typeof c[0] === 'number' ? void b.extend(c as [number, number]) : (c as unknown[]).forEach(walk));
        walk((f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates);
        const p = this.padding();
        this.gm.map.fitBounds(b, { padding: { top: p.top + 40, bottom: p.bottom + 20, left: p.left + 40, right: p.right + 40 }, pitch: 45, duration: reducedMotion() ? 0 : 1100 });
      }
    }
  }

  /** Camera padding so targets land in the map area the UI doesn't cover. */
  private padding(): { top: number; bottom: number; left: number; right: number } {
    const phone = window.innerWidth < 900;
    return phone ? { top: 70, bottom: Math.min(window.innerHeight * 0.55, 420) + 70, left: 0, right: 0 } : { top: 70, bottom: 0, left: 0, right: 530 };
  }

  private fly(cam: PublicRound['camera']): void {
    const opts = { center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing, padding: this.padding() };
    if (reducedMotion()) this.gm.map.jumpTo(opts);
    else this.gm.map.flyTo({ ...opts, duration: 1100, essential: true });
  }

  // ------------------------------------------------------------------ top bar
  private renderTop(s: PublicState): void {
    if (s.phase === 'results' || s.phase === 'lobby') {
      this.top.hidden = true;
      return;
    }
    this.top.hidden = false;
    const me = this.me;
    const r = s.round;
    const bar = h('div', { class: 'timer', role: 'progressbar', 'aria-label': 'Time left' }, h('div', { class: 'timer__fill' }));
    this.top.replaceChildren(
      h('div', { class: 'topbar__round' }, h('span', { class: 'num' }, `Round ${s.roundIndex + 1}/${s.totalRounds}`), r ? h('span', { class: 'topbar__type' }, TYPE_LABEL[r.type]) : ''),
      bar,
      h('div', { class: 'topbar__right' }, ...s.players.map((p) => h('span', { class: `lockdot ${p.locked ? 'is-locked' : ''}`, title: `${p.name}${p.locked ? ' locked in' : ''}`, style: `--pc:${p.color}` }, p.locked ? '✓' : p.shape)), h('span', { class: 'topbar__score num', title: 'Your total' }, fmtScore(me?.score ?? 0))),
    );
    cancelAnimationFrame(this.timerFrame);
    const fill = bar.firstElementChild as HTMLElement;
    if (s.phase === 'play' && s.deadline) {
      const total = s.settings.timerS * 1000;
      const step = () => {
        const left = Math.max(0, s.deadline! - serverNow());
        fill.style.transform = `scaleX(${left / total})`;
        fill.classList.toggle('is-low', left < 10_000);
        bar.setAttribute('aria-valuenow', String(Math.ceil(left / 1000)));
        if (left > 0) this.timerFrame = requestAnimationFrame(step);
      };
      step();
    } else {
      fill.style.transform = 'scaleX(0)';
    }
  }

  // ------------------------------------------------------------------ brief
  private enterBrief(s: PublicState): void {
    const r = s.round!;
    this.revealTimers.forEach(clearTimeout);
    cancelAnimationFrame(this.rippleFrame);
    this.clearRoundMap();
    clearLenses(this.gm.map);
    this.lensOn.clear();
    this.renderLegend();
    this.pin = null;
    this.pinMarker?.remove();
    this.pinMarker = null;
    this.sliderValue = null;
    this.rail.replaceChildren();
    this.photo.replaceChildren();
    this.sheet.hidden = true;
    this.fly(r.camera);
    void this.showRoundGeometry(r);
    if (STAGE_KINDS.has(r.kind)) void this.prefetchStages(r);
    this.overlay.hidden = false;
    this.overlay.replaceChildren(
      h('div', { class: 'card brief' }, h('div', { class: 'eyebrow' }, `Round ${s.roundIndex + 1} of ${s.totalRounds} · ${TYPE_LABEL[r.type]}`), h('h2', { class: 'brief__q' }, r.question), h('div', { class: 'brief__count num', 'data-count': '' })),
    );
    const count = this.overlay.querySelector('[data-count]') as HTMLElement;
    const tick = () => {
      if (!this.state || this.state.phase !== 'brief') return;
      const left = Math.max(0, (this.state.briefUntil ?? 0) - serverNow());
      count.textContent = left > 0 ? String(Math.ceil(left / 1000)) : 'Go';
      if (left > 0) requestAnimationFrame(tick);
    };
    tick();
  }

  // ------------------------------------------------------------------ play
  private enterPlay(s: PublicState, fresh: boolean): void {
    const r = s.round!;
    this.overlay.hidden = true;
    if (fresh) {
      // Joined mid-round (or resumed): set up the scene that the brief would have.
      this.clearRoundMap();
      this.fly(r.camera);
      void this.showRoundGeometry(r);
    }
    this.sheet.hidden = false;
    this.sheet.classList.remove('sheet--lobby');
    this.renderPhoto(r);
    if (this.tv || this.me?.spectator) {
      this.rail.replaceChildren();
      this.sheet.replaceChildren(
        h('div', { class: 'eyebrow' }, `${TYPE_LABEL[r.type]} · round ${s.roundIndex + 1} of ${s.totalRounds}`),
        h('h2', { class: 'q' }, r.question),
        this.tv ? h('div', { class: 'tv-locks', 'data-locks': '' }) : h('p', { class: 'pin-hint' }, 'You joined mid-round — watch this one, you’re in from the next round.'),
      );
      this.renderLockState(s);
      return;
    }
    this.renderRail(s);
    const input =
      r.input.kind === 'slider' ? this.sliderInput(r.input) : h('p', { class: 'pin-hint' }, 'Tap the map to drop your pin. You can move it until you lock in.');
    const lock = h('button', { class: 'btn btn--lock', 'data-lock': '', onclick: () => this.lock() }, 'Lock in');
    this.sheet.replaceChildren(
      h('div', { class: 'eyebrow' }, `${TYPE_LABEL[r.type]} · round ${s.roundIndex + 1}`),
      h('h2', { class: 'q' }, r.question),
      input,
      h('div', { class: 'sheet__actions' }, h('button', { class: 'chip', onclick: () => this.fly(r.camera) }, 'Recenter'), lock),
    );
    this.renderLockState(s);
  }

  private sliderInput(inp: Extract<PublicRound['input'], { kind: 'slider' }>): HTMLElement {
    const mid = Math.round((inp.min + inp.max) / 2 / inp.step) * inp.step;
    this.sliderValue = this.state?.yourGuess?.value ?? mid;
    const out = h('div', { class: 'estimate num' }, fmtValue(this.sliderValue, inp.units));
    const range = h('input', { type: 'range', class: 'slider', min: String(inp.min), max: String(inp.max), step: String(inp.step), value: String(this.sliderValue), 'aria-label': `Your estimate in ${inp.units}` }) as HTMLInputElement;
    range.addEventListener('input', () => {
      this.sliderValue = Number(range.value);
      out.textContent = fmtValue(this.sliderValue, inp.units);
    });
    return h('div', { class: 'estimate-wrap' }, out, range, h('div', { class: 'estimate-scale' }, h('span', {}, fmtValue(inp.min, inp.units)), h('span', {}, fmtValue(inp.max, inp.units))));
  }

  private renderLockState(s: PublicState): void {
    const locks = this.sheet.querySelector('[data-locks]');
    if (locks) {
      const playing = s.players.filter((p) => !p.spectator);
      locks.replaceChildren(
        h('div', { class: 'tv-locks__count num' }, `${playing.filter((p) => p.locked).length} / ${playing.length} locked in`),
        h('div', { class: 'tv-locks__row' }, ...playing.map((p) => h('span', { class: `lockdot lockdot--big ${p.locked ? 'is-locked' : ''}`, style: `--pc:${p.color}`, title: p.name }, p.locked ? '✓' : p.shape))),
      );
    }
    const me = this.me;
    const btn = this.sheet.querySelector('[data-lock]') as HTMLButtonElement | null;
    if (!btn || !s.round) return;
    const needsPin = s.round.input.kind === 'pin' && !this.pin;
    btn.disabled = Boolean(me?.locked) || needsPin;
    btn.textContent = me?.locked ? 'Locked ✓ — waiting' : needsPin ? 'Drop a pin first' : 'Lock in';
    this.sheet.querySelector('.slider')?.toggleAttribute('disabled', Boolean(me?.locked));
  }

  private placePin(p: LngLat): void {
    const s = this.state;
    if (!s || s.phase !== 'play' || s.round?.input.kind !== 'pin' || !this.me || this.me.locked || this.me.spectator) return;
    this.pin = p;
    if (!this.pinMarker) {
      const me = this.me!;
      const el = h('div', { class: 'pin', style: `--pc:${me.color}`, 'aria-label': 'Your pin' }, h('span', {}, me.shape));
      this.pinMarker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat(p).addTo(this.gm.map);
      this.pinMarker.on('dragend', () => {
        const ll = this.pinMarker!.getLngLat();
        this.pin = [ll.lng, ll.lat];
      });
    } else this.pinMarker.setLngLat(p);
    this.renderLockState(s);
  }

  private async lock(): Promise<void> {
    const r = this.state?.round;
    if (!r) return;
    try {
      await call('round:lock', r.input.kind === 'pin' ? { point: this.pin! } : { value: this.sliderValue! });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  private renderRail(s: PublicState): void {
    const disabled = s.settings.rules !== 'normal';
    this.rail.replaceChildren(
      ...LENSES.map((id) => {
        const m = LENS_META[id];
        const on = this.lensOn.has(id) || s.players.find((p) => p.seat === s.you)?.lensesUsed.includes(id);
        const btn = h(
          'button',
          { class: `lens ${on ? 'is-on' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'aria-label': `${m.label} lens, costs 10% of this round's score`, disabled, title: disabled ? 'Lenses are off in this game' : `${m.label} lens (−10%)`, onclick: () => this.toggleLens(id, btn) },
          h('span', { class: 'lens__icon', 'aria-hidden': 'true' }, m.icon),
          h('span', { class: 'lens__label' }, m.label),
          h('span', { class: 'lens__cost' }, '−10%'),
        );
        return btn;
      }),
    );
  }

  private async toggleLens(id: LensId, btn: HTMLElement): Promise<void> {
    const s = this.state!;
    const wasUsed = this.me?.lensesUsed.includes(id);
    const on = !this.lensOn.has(id);
    try {
      if (on && !wasUsed && s.phase === 'play') await call('round:lens', { lens: id });
      await setLens(this.gm.map, this.area, id, on);
      if (on) this.lensOn.add(id);
      else this.lensOn.delete(id);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
      this.renderLegend();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  private renderLegend(): void {
    this.root.querySelector('.legend-card')?.remove();
    if (!this.lensOn.size) return;
    const items = [...this.lensOn].flatMap((l) => LENS_META[l].legend);
    this.root.append(h('div', { class: 'card legend-card' }, ...items.map(([c, t]) => h('span', { class: 'legend__item' }, h('i', { style: `background:${c}` }), t))));
  }

  private renderPhoto(r: PublicRound): void {
    this.photo.replaceChildren();
    if (!r.photo || this.state?.settings.rules === 'pro') return;
    const p = r.photo;
    const src = `/packs/${this.area}/${p.file}`;
    const card = h(
      'button',
      { class: 'card photo-card', 'aria-label': 'Street photo — tap to enlarge', onclick: () => card.classList.toggle('is-big') },
      h('img', { src, alt: `Street-level photo near this location, ${p.captured_at}`, loading: 'eager' }),
      h('span', { class: 'photo-card__credit' }, `© ${p.creator ?? 'Mapillary contributor'} · Mapillary · ${p.license} · ${p.captured_at.slice(0, 4)}`),
    );
    (card.querySelector('img') as HTMLImageElement).addEventListener('error', () => card.remove());
    this.photo.append(card);
  }

  // ------------------------------------------------------------------ reveal
  private enterReveal(s: PublicState): void {
    const r = s.round!;
    const rv = s.reveal!;
    this.overlay.hidden = true;
    this.rail.replaceChildren();
    const me = rv.results.find((x) => x.seat === s.you);
    const motion = !reducedMotion();
    const at = (ms: number, fn: () => void) => this.revealTimers.push(window.setTimeout(fn, motion ? ms : 0));
    // With a TV watching, phones are controllers: the big reveal plays on the TV.
    const controller = s.tvConnected && !this.tv;
    const party = s.mode === 'party';

    // (1) guesses drop in, (2) truth ripple + lines, (3) camera flies to truth, (4) water animation.
    const truthPts: LngLat[] = rv.truth.points ?? (r.focus?.building_id ? [r.focus.point] : []);
    const guesses = rv.results.filter((x) => x.guess?.point).map((x) => ({ p: x.guess!.point!, color: hex(s.players.find((pl) => pl.seat === x.seat)!.color) }));
    this.pinMarker?.remove();
    this.pinMarker = null;
    this.animateRevealLayers(guesses, truthPts, motion);
    document.body.dataset.revealGuesses = String(guesses.length); // test hook
    if (!controller) at(700, () => {
      const pts = [...truthPts, ...guesses.map((g) => g.p)];
      if (pts.length > 1) {
        const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
        const p = this.padding();
        const map = this.gm.map;
        // Fit guess + truth in the uncovered map area; fall back to tighter padding if needed.
        const cam =
          map.cameraForBounds(b, { padding: { top: p.top + 50, bottom: p.bottom + 30, left: p.left + 40, right: p.right + 40 }, maxZoom: 16.5, pitch: 40, bearing: map.getBearing() }) ??
          map.cameraForBounds(b, { padding: 30, maxZoom: 16.5, pitch: 40, bearing: map.getBearing() });
        if (cam) map.flyTo({ ...cam, pitch: 40, duration: motion ? 1100 : 0 });
      } else if (pts.length && r.focus?.building_id) this.gm.map.flyTo({ center: pts[0], zoom: Math.max(this.gm.map.getZoom(), 16.5), pitch: 60, padding: this.padding(), duration: motion ? 1100 : 0 });
    });
    if (STAGE_KINDS.has(r.kind) && !controller) at(1700, () => void this.animateWater(r, rv, motion));

    // Score sheet.
    const final = me?.score.final ?? 0;
    const scoreEl = h('div', { class: 'reveal__score num', 'data-final': String(me?.score.final ?? 0) }, '0');
    const truthText = rv.truth.value !== undefined && r.input.kind === 'slider' ? fmtValue(rv.truth.value, r.input.units) : rv.truth.name ?? (rv.truth.stage_ft !== undefined ? `${rv.truth.stage_ft} ft gauge stage` : rv.truth.claims !== undefined ? `${rv.truth.claims} claims` : 'Shown on map');
    const yourText = me?.guess ? (me.guess.value !== undefined && r.input.kind === 'slider' ? fmtValue(me.guess.value, r.input.units) : 'Your pin') : 'No answer';
    const err = me?.score.error;
    const errText = err === null || err === undefined ? 'No guess locked in' : me!.score.errorUnits === 'm' ? `${fmtDistance(err)} away` : me!.score.errorUnits === '%' ? `Off by ${(Math.round(err * 10) / 10).toFixed(1)} pts` : `Off by ${fmtValue(Math.round(err * 10) / 10, me!.score.errorUnits)}`;
    const chips = [
      h('span', { class: 'bchip' }, errText),
      me && me.score.lensMultiplier < 1 ? h('span', { class: 'bchip bchip--neg' }, `${me.lenses.length} lens${me.lenses.length > 1 ? 'es' : ''} ×${me.score.lensMultiplier.toFixed(2)}`) : '',
      me && me.score.timeBonus > 0 ? h('span', { class: 'bchip bchip--pos' }, `Fast lock-in +${(me.score.timeBonus * 100).toFixed(1)}%`) : '',
    ];
    const last = s.roundIndex >= s.totalRounds - 1;
    const gains = new Map(rv.results.map((x) => [x.seat, x.score.final]));
    const next = this.isHost
      ? h('button', { class: 'btn', 'data-next': '', onclick: () => call('round:next', {}).catch((e) => toast(e.message, 'error')) }, last ? 'See results' : 'Next round')
      : h('div', { class: 'reveal-wait', 'data-reveal-wait': '' });
    const scoringSource: Source = { dataset: 'Ready Raleigh scoring (PLAN §5)', date: 'this round', url: '/methods', method: r.input.kind === 'pin' ? `5000 × exp(−distance / ${r.tolerance.s} m). ${r.tolerance.basis}.` : `5000 × exp(−|guess − truth| / ${r.tolerance.s} ${r.tolerance.units}). ${r.tolerance.basis}.` };
    this.sheet.hidden = false;
    this.sheet.replaceChildren(
      h('div', { class: 'reveal__head' }, h('div', {}, h('div', { class: 'eyebrow' }, r.short), sourced('', 'Round score', scoringSource, undefined, 'reveal__score-btn')), h('div', { class: 'reveal__answers' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Answer'), sourced(truthText, r.short, r.source)), h('div', {}, h('div', { class: 'eyebrow' }, 'You'), h('div', { class: 'num reveal__you' }, yourText)))),
      h('div', { class: 'bchips' }, ...chips),
      controller ? h('p', { class: 'pin-hint' }, '📺 Watch the TV for the reveal.') : h('div', { class: 'coach card' }, h('div', { class: 'eyebrow' }, 'Why'), h('p', {}, rv.explanation)),
      party ? scoreboard(s, gains) : '',
      this.tv ? h('div', { class: 'reveal-wait', 'data-reveal-wait': '' }) : h('div', { class: 'sheet__actions' }, next),
    );
    if (this.tv) {
      // TV: no personal score — the answer, why, and everyone's points.
      this.sheet.querySelector('.reveal__score-btn')?.parentElement?.replaceChildren(h('div', { class: 'eyebrow' }, r.short), h('div', { class: 'reveal__score num' }, `Round ${s.roundIndex + 1}`));
      this.sheet.querySelector('.reveal__you')?.parentElement?.remove();
      this.sheet.querySelector('.bchips')?.remove();
    }
    this.renderRevealWait(s);
    const btn = this.sheet.querySelector('.reveal__score-btn') as HTMLElement | null;
    if (btn) {
      btn.replaceChildren(scoreEl, h('span', { class: 'reveal__of' }, ' / 5,000'));
      at(motion ? 1200 : 0, () => countUp(scoreEl, final, motion ? 1100 : 0));
    }
    document.body.dataset.revealRound = String(s.roundIndex);
  }

  private renderRevealWait(s: PublicState): void {
    const el = this.sheet.querySelector('[data-reveal-wait]');
    if (!el || !s.revealUntil) return;
    const host = s.players.find((p) => p.seat === s.hostSeat);
    const tickW = () => {
      if (this.state?.phase !== 'reveal') return;
      const left = Math.max(0, Math.ceil((s.revealUntil! - serverNow()) / 1000));
      el.textContent = `Waiting for ${host?.name ?? 'the host'} · next round in ${left}s`;
      if (left > 0) setTimeout(tickW, 500);
    };
    tickW();
  }

  private animateRevealLayers(guesses2d: { p: LngLat; color: [number, number, number] }[], truth2d: LngLat[], motion: boolean): void {
    const start = performance.now();
    const lift = (p: LngLat): LngLat => [p[0], p[1], (this.gm.map.queryTerrainElevation(p) ?? 0) + 4] as unknown as LngLat;
    const guesses = guesses2d.map((g) => ({ ...g, p: lift(g.p) }));
    const truth = truth2d.map(lift);
    const onTop = { parameters: { depthCompare: 'always' as const, depthWriteEnabled: false } };
    const water = hex(token('water-deep'));
    const frame = () => {
      const t = (performance.now() - start) / 1000;
      const drop = motion ? Math.min(1, t / 0.5) : 1;
      const showTruth = !motion || t > 0.6;
      const ripple = (t % 1.6) / 1.6;
      this.gm.deck.setProps({
        layers: [
          new LineLayer({ ...onTop, id: 'guess-lines', data: showTruth && truth.length ? guesses.map((g) => ({ from: g.p, to: nearest(g.p, truth), color: g.color })) : [], getSourcePosition: (d: { from: LngLat }) => d.from, getTargetPosition: (d: { to: LngLat }) => d.to, getColor: (d: { color: number[] }) => [...d.color, 200] as never, getWidth: 3, widthUnits: 'pixels' }),
          new ScatterplotLayer({ ...onTop, id: 'truth-ripple', data: showTruth ? truth : [], getPosition: (d: LngLat) => d, getRadius: 8 + 40 * ripple, radiusUnits: 'pixels', stroked: true, filled: false, getLineColor: [...hex(token('water')), Math.round(255 * (1 - ripple))] as never, lineWidthUnits: 'pixels', getLineWidth: 3, updateTriggers: { getRadius: ripple, getLineColor: ripple } }),
          new ScatterplotLayer({ ...onTop, id: 'truth', data: showTruth ? truth : [], getPosition: (d: LngLat) => d, getRadius: 11, radiusUnits: 'pixels', getFillColor: [255, 255, 255, 255], stroked: true, getLineColor: [...water, 255] as never, lineWidthUnits: 'pixels', getLineWidth: 5 }),
          new ScatterplotLayer({ ...onTop, id: 'guesses', data: guesses, getPosition: (d: { p: LngLat }) => d.p, getRadius: 12 * drop, radiusUnits: 'pixels', getFillColor: (d: { color: number[] }) => [...d.color, 255] as never, stroked: true, getLineColor: [255, 255, 255, 255], lineWidthUnits: 'pixels', getLineWidth: 3, updateTriggers: { getRadius: drop } }),
        ],
      });
      if (motion && this.state?.phase === 'reveal') this.rippleFrame = requestAnimationFrame(frame);
    };
    cancelAnimationFrame(this.rippleFrame);
    frame();
  }

  private stageMeta(): Promise<StagesMeta> {
    this.stagesMeta ??= fetchJson<StagesMeta>(`/packs/${this.area}/stages.json`);
    return this.stagesMeta;
  }

  private frames(meta: StagesMeta, targetFt: number): number[] {
    const idx = meta.stages.filter((s) => s.stage_ft <= targetFt + 1e-6).map((s) => s.i);
    const n = 10;
    if (idx.length <= n) return idx;
    return Array.from({ length: n }, (_, k) => idx[Math.round((k * (idx.length - 1)) / (n - 1))]!);
  }

  private async prefetchStages(r: PublicRound): Promise<void> {
    const meta = await this.stageMeta();
    const target = r.kind === 'depth_1pct' ? meta.scenarios['1pct']!.stage_ft : 23.1;
    for (const i of this.frames(meta, target)) this.geo(i);
  }

  private geo(i: number) {
    if (!this.stageGeo.has(i)) this.stageGeo.set(i, fetchJson<GeoJSON.FeatureCollection>(`/packs/${this.area}/stages/${i}.geojson`));
    return this.stageGeo.get(i)!;
  }

  /** Water rises from the creek up to the round's stage over ~3 s. */
  private async animateWater(r: PublicRound, rv: Reveal, motion: boolean): Promise<void> {
    const meta = await this.stageMeta();
    const target = r.kind === 'depth_1pct' ? meta.scenarios['1pct']!.stage_ft : rv.truth.stage_ft ?? meta.scenarios['1pct']!.stage_ft;
    const frames = this.frames(meta, target);
    const src = this.gm.map.getSource('reveal-water') as maplibregl.GeoJSONSource;
    const list = motion ? frames : frames.slice(-1);
    for (const [k, i] of list.entries()) {
      const g = await this.geo(i);
      if (this.state?.phase !== 'reveal' || this.state.round?.id !== r.id) return;
      src.setData(g);
      if (k < list.length - 1) await new Promise((res) => setTimeout(res, 3000 / list.length));
    }
  }

  // ------------------------------------------------------------------ results
  private enterResults(s: PublicState): void {
    cancelAnimationFrame(this.rippleFrame);
    this.clearRoundMap();
    clearLenses(this.gm.map);
    this.lensOn.clear();
    this.renderLegend();
    this.rail.replaceChildren();
    this.photo.replaceChildren();
    this.overlay.hidden = true;
    const me = this.me;
    const total = h('div', { class: 'results__total num', 'data-final': String(me?.score ?? 0) }, '0');
    const best = s.history.length * 5000;
    this.sheet.hidden = false;
    this.sheet.classList.add('results');
    if (s.mode === 'party') {
      const podium = s.ranking.slice(0, 3).map((seat, i) => {
        const p = s.players.find((x) => x.seat === seat)!;
        return h('div', { class: `podium__step podium__step--${i + 1}`, style: `--pc:${p.color}` }, h('span', { class: 'podium__hat' }, p.shape), h('span', { class: 'podium__name' }, p.name), h('span', { class: 'podium__score num' }, fmtScore(p.score)), h('span', { class: 'podium__place num' }, String(i + 1)));
      });
      const order = podium.length === 3 ? [podium[1]!, podium[0]!, podium[2]!] : podium;
      this.sheet.replaceChildren(
        h('div', { class: 'eyebrow' }, `Crabtree Creek · ${s.history.length} rounds`),
        h('div', { class: 'podium' }, ...order),
        scoreboard(s),
        this.tv
          ? h('p', { class: 'results__note' }, 'Every answer came from public data. Thanks for playing!')
          : h('div', { class: 'sheet__actions' }, h('button', { class: 'chip', onclick: () => this.onExit() }, 'Leave'), this.isHost ? h('button', { class: 'btn', 'data-again': '', onclick: () => call('game:again', {}).catch((e) => toast(e.message, 'error')) }, 'New game, same crew') : h('span', { class: 'pin-hint' }, 'Waiting for the host…')),
      );
      document.body.dataset.results = 'true';
      return;
    }
    this.sheet.replaceChildren(
      h('div', { class: 'eyebrow' }, `Crabtree Creek · ${s.history.length} rounds`),
      h('div', { class: 'results__head' }, total, h('span', { class: 'reveal__of' }, ` / ${fmtScore(best)}`)),
      h(
        'ol',
        { class: 'results__list' },
        ...s.history.map((rv, i) => {
          const res = rv.results.find((x) => x.seat === s.you);
          return h('li', {}, h('span', { class: 'results__n num' }, String(i + 1)), h('span', { class: 'results__q' }, rv.short), h('span', { class: 'results__s num' }, fmtScore(res?.score.final ?? 0)));
        }),
      ),
      h('p', { class: 'results__note' }, 'Every answer came from public data — tap any number during a round to see its source.'),
      h('div', { class: 'sheet__actions' }, h('button', { class: 'chip', onclick: () => this.onExit() }, 'Home'), h('button', { class: 'btn', 'data-again': '', onclick: () => call('game:again', {}).then((r) => saveAgain(r)).catch((e) => toast(e.message, 'error')) }, 'Play again')),
    );
    countUp(total, me?.score ?? 0, reducedMotion() ? 0 : 1200);
    document.body.dataset.results = 'true';
  }
}

function saveAgain(r: Record<string, unknown>) {
  import('../net/socket.ts').then((m) => m.saveSession({ code: String(r.code), playerId: String(r.playerId) }));
  document.querySelector('.game-sheet')?.classList.remove('results');
  delete document.body.dataset.results;
}

function empty(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as T;
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.trim().replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function nearest(p: LngLat, pts: LngLat[]): LngLat {
  return pts.reduce((b, q) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(b[0] - p[0], b[1] - p[1]) ? q : b), pts[0]!);
}

/** Score count-up with an ease-out spring feel. */
function countUp(el: HTMLElement, to: number, ms: number): void {
  if (ms <= 0) {
    el.textContent = fmtScore(to);
    return;
  }
  const t0 = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / ms);
    const e = 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.04;
    el.textContent = fmtScore(to * Math.min(e, 1.02));
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = fmtScore(to);
  };
  step();
}
