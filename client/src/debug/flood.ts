// /debug/flood?area=crabtree — stage slider rising water over 3D buildings (BUILD.md M2).
import type maplibregl from 'maplibre-gl';
import { createMap, type GameMap } from '../map/createMap.ts';
import { addPackBuildings } from '../map/buildings.ts';
import { token } from '../tokens.ts';
import { h, svg } from '../ui/dom.ts';
import { icons } from '../ui/icons.ts';
import { cameraControls, errorOverlay, loadingOverlay } from '../ui/shell.ts';

interface StageRow {
  i: number;
  stage_ft: number;
  category: string;
  wet_area_km2: number;
  buildings_reached: number;
  closed_edges_total?: number;
}
interface StagesJson {
  gauge: { lid: string; datum_navd88_ft: number; categories_ft: Record<string, number>; record_stage_ft: number };
  scenarios: Record<string, { stage_ft: number; label: string }>;
  stages: StageRow[];
  sources: { dataset: string; date: string }[];
}
interface DamageBuilding {
  id: string;
  first_wet_stage: number;
  depth_ft: number[];
}
interface DamageJson {
  total_damage_usd_by_stage: number[];
  buildings: DamageBuilding[];
}

const GAUGES: Record<string, [number, number]> = { crabtree: [-78.6341667, 35.821111] };
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const num = new Intl.NumberFormat('en-US');

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return (await r.json()) as T;
}

export async function floodDebug(mapEl: HTMLElement, ui: HTMLElement): Promise<void> {
  const area = new URLSearchParams(location.search).get('area') ?? 'crabtree';
  const loading = loadingOverlay();
  ui.replaceChildren(loading);
  const base = `/packs/${area}`;
  let gm: GameMap;
  let st: StagesJson, dmg: DamageJson, roads: GeoJSON.FeatureCollection;
  try {
    const [s, d, r] = await Promise.all([
      getJson<StagesJson>(`${base}/stages.json`),
      getJson<DamageJson>(`${base}/damage.json`),
      getJson<{ edges: { id: string; closure_stage: number | null; coords: [number, number][] }[] }>(`${base}/roads.json`),
    ]);
    st = s;
    dmg = d;
    roads = {
      type: 'FeatureCollection',
      features: r.edges
        .filter((e) => e.closure_stage !== null)
        .map((e) => ({ type: 'Feature', properties: { c: e.closure_stage }, geometry: { type: 'LineString', coordinates: e.coords } })),
    };
    gm = await createMap(mapEl, { center: GAUGES[area] ?? [-78.65, 35.825], zoom: 15.4 });
  } catch (err) {
    console.error(err);
    ui.replaceChildren(errorOverlay(`Couldn’t load the “${area}” pack. Build it with: python -m pipeline build ${area}`, () => location.reload()));
    return;
  }
  const map = gm.map;
  addPackBuildings(map, area);
  map.addSource('water', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'water-fill', type: 'fill', source: 'water', paint: { 'fill-color': token('water'), 'fill-opacity': 0.58 } }, 'pack-buildings-3d');
  map.addLayer({ id: 'water-edge', type: 'line', source: 'water', paint: { 'line-color': token('water-deep'), 'line-width': 1.2, 'line-opacity': 0.8 } }, 'pack-buildings-3d');
  map.addSource('closed', { type: 'geojson', data: roads });
  map.addLayer({ id: 'closed-roads', type: 'line', source: 'closed', filter: ['<=', ['get', 'c'], -1], paint: { 'line-color': token('danger'), 'line-width': 4, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round' } });
  const g = GAUGES[area];
  if (g) {
    map.addSource('gauge', { type: 'geojson', data: { type: 'Point', coordinates: g } });
    map.addLayer({ id: 'gauge', type: 'circle', source: 'gauge', paint: { 'circle-radius': 7, 'circle-color': token('ink-900'), 'circle-stroke-color': token('text'), 'circle-stroke-width': 2.5 } });
  }

  const cache = new Map<number, Promise<GeoJSON.FeatureCollection>>();
  const stageGeo = (i: number) => {
    if (!cache.has(i)) cache.set(i, getJson<GeoJSON.FeatureCollection>(`${base}/stages/${i}.geojson`));
    return cache.get(i)!;
  };
  const flooded = new Set<string>();

  // ---- UI
  const stageNum = h('div', { class: 'stage__num num' });
  const catPill = h('span', { class: 'pill' });
  const slider = h('input', { type: 'range', min: '0', max: String(st.stages.length - 1), step: '1', class: 'slider', 'aria-label': 'Gauge stage' }) as HTMLInputElement;
  const stats = h('div', { class: 'stats' });
  const play = h('button', { class: 'btn btn--ghost', 'aria-label': 'Play rising water' }, 'Play');
  const label: Record<string, string> = { '1pct': '1% flood', matthew_2016: 'Matthew 2016', record: 'Record 1996' };
  const scen = h('div', { class: 'chips' }, ...Object.entries(st.scenarios).map(([k, s]) => h('button', { class: 'chip', 'data-k': k, title: s.label, onclick: () => setStage(nearest(s.stage_ft)) }, `${label[k] ?? s.label} · ${s.stage_ft} ft`)));
  // Track colored by NWS flood category; thresholds listed once below it.
  const maxFt = st.stages[st.stages.length - 1]!.stage_ft;
  const cats = Object.entries(st.gauge.categories_ft).sort((a, b) => a[1] - b[1]);
  const catColor: Record<string, string> = { action: 'var(--alert)', minor: 'var(--heat-2)', moderate: 'var(--danger)', major: 'var(--heat-4)' };
  const stops = ['var(--water) 0%', ...cats.flatMap(([k, v], j) => {
    const at = (v / maxFt) * 100;
    const prev = j === 0 ? 'var(--water)' : catColor[cats[j - 1]![0]];
    return [`${prev} ${at}%`, `${catColor[k]} ${at}%`];
  }), `${catColor[cats[cats.length - 1]![0]]} 100%`];
  slider.style.setProperty('--track', `linear-gradient(90deg, ${stops.join(', ')})`);
  const ticks = h('div', { class: 'legend' }, ...cats.map(([k, v]) => h('span', { class: 'legend__item' }, h('i', { style: `background:${catColor[k]}` }), `${k[0]!.toUpperCase()}${k.slice(1)} ${v} ft`)));
  const sources = h('details', { class: 'sources' }, h('summary', {}, 'Sources & method'), h('ul', {}, ...st.sources.map((s) => h('li', {}, `${s.dataset} — ${s.date}`))), h('p', {}, 'Modeled with HAND (height above nearest drainage) from the gauge stage. Debug view — not official flood guidance.'));
  const sheet = h(
    'section',
    { class: 'card sheet', 'aria-label': 'Flood stage' },
    h('div', { class: 'sheet__head' }, h('div', {}, h('div', { class: 'eyebrow' }, `Gauge ${st.gauge.lid} · Crabtree Creek at Anderson Dr`), h('div', { class: 'stage' }, stageNum, catPill)), play),
    h('div', { class: 'slider-wrap' }, slider, ticks),
    scen,
    stats,
    sources,
  );
  loading.classList.add('overlay--fade');
  setTimeout(() => loading.remove(), 450);
  // Keep the gauge centered in the part of the map the sheet doesn't cover.
  const pad = () => {
    const phone = window.innerWidth < 900;
    map.setPadding(phone ? { top: 0, bottom: sheet.offsetHeight + 16, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 420 + 88 });
  };
  ui.append(h('header', { class: 'card brand' }, h('div', { class: 'brand__mark' }, svg(icons.mark)), h('div', {}, h('div', { class: 'brand__name' }, 'Flood stages'), h('div', { class: 'brand__sub' }, `${area} · debug`))), cameraControls(gm), sheet);

  const nearest = (ft: number) => st.stages.reduce((b, s) => (Math.abs(s.stage_ft - ft) < Math.abs(st.stages[b]!.stage_ft - ft) ? s.i : b), 0);
  let current = -1;
  let token_ = 0;

  async function setStage(i: number) {
    current = i;
    slider.value = String(i);
    const row = st.stages[i]!;
    stageNum.textContent = `${row.stage_ft.toFixed(1)} ft`;
    catPill.textContent = row.category === 'none' ? 'below action' : row.category;
    catPill.className = `pill pill--${row.category}`;
    const floorWet = dmg.buildings.filter((b) => i >= b.first_wet_stage && b.depth_ft[i - b.first_wet_stage]! > 0);
    stats.replaceChildren(
      stat('Wet area', `${row.wet_area_km2.toFixed(2)} km²`),
      stat('Buildings reached', num.format(row.buildings_reached)),
      stat('Water above floor', num.format(floorWet.length)),
      stat('Road edges closed', num.format(row.closed_edges_total ?? 0)),
      stat('Structure damage', usd.format(dmg.total_damage_usd_by_stage[i] ?? 0)),
    );
    map.setFilter('closed-roads', ['all', ['!=', ['get', 'c'], null], ['<=', ['get', 'c'], i]]);
    // Feature-state: 1 = water at the building, 2 = water above the first floor.
    for (const id of flooded) map.setFeatureState({ source: 'pack-buildings', sourceLayer: 'buildings', id }, { flood: 0 });
    flooded.clear();
    for (const b of dmg.buildings) {
      if (i < b.first_wet_stage) continue;
      const above = b.depth_ft[i - b.first_wet_stage]! > 0;
      map.setFeatureState({ source: 'pack-buildings', sourceLayer: 'buildings', id: b.id }, { flood: above ? 2 : 1 });
      flooded.add(b.id);
    }
    const my = ++token_;
    const geo = await stageGeo(i);
    if (my !== token_) return;
    (map.getSource('water') as maplibregl.GeoJSONSource).setData(geo);
    for (const n of [i - 1, i + 1]) if (n >= 0 && n < st.stages.length) void stageGeo(n);
    document.body.dataset.stage = String(i);
  }
  slider.addEventListener('input', () => setStage(Number(slider.value)));

  let timer: number | undefined;
  play.addEventListener('click', () => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
      play.textContent = 'Play';
      return;
    }
    play.textContent = 'Pause';
    let i = current >= st.stages.length - 1 ? 0 : current;
    timer = window.setInterval(() => {
      i += 1;
      if (i >= st.stages.length) {
        clearInterval(timer);
        timer = undefined;
        play.textContent = 'Play';
        return;
      }
      void setStage(i);
    }, 250);
  });

  pad();
  window.addEventListener('resize', pad);
  if (g) map.jumpTo({ center: g });
  await setStage(nearest(st.scenarios['1pct']?.stage_ft ?? 20));
  document.body.dataset.ready = 'true';
  (window as unknown as { __rr: unknown }).__rr = gm;
}

function stat(label: string, value: string): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'stat__v num' }, value), h('div', { class: 'stat__l' }, label));
}
