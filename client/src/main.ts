import 'maplibre-gl/dist/maplibre-gl.css'; // before our styles so ours win
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './styles/base.css';
import './styles/components.css';
import './styles/game.css';
import { DEFAULT_SETTINGS, type GameSettings } from '@rr/shared';
import { GameView } from './game/game.ts';
import { joinCard } from './game/join.ts';
import { Landing } from './game/landing.ts';
import { addPackBuildings } from './map/buildings.ts';
import { createMap, type GameMap } from './map/createMap.ts';
import { call, getSocket, loadSession, onConnection, onState, saveSession, watchAsTv } from './net/socket.ts';
import { h } from './ui/dom.ts';
import { cameraControls, errorOverlay, loadingOverlay } from './ui/shell.ts';
import { toast } from './ui/toast.ts';

const mapEl = document.getElementById('map')!;
const ui = document.getElementById('ui')!;
const AREA = DEFAULT_SETTINGS.area;

function webglSupported(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

let gm: GameMap;
let view: { destroy(): void } | null = null;
let offState: (() => void) | null = null;

function show(next: { destroy(): void }) {
  view?.destroy();
  offState?.();
  offState = null;
  view = next;
}

function goHome(push = true) {
  saveSession(null);
  if (push) history.pushState({}, '', '/');
  show(new Landing(gm, ui, startSolo, { create: () => showJoin('create'), join: () => showJoin('code') }));
}

function simple(el: HTMLElement) {
  ui.append(el);
  return { destroy: () => el.remove() };
}

/** Name (and code) entry for creating or joining a party. */
function showJoin(kind: 'create' | 'code' | 'link', code?: string) {
  const enter = async (r: Record<string, unknown>) => {
    saveSession({ code: String(r.code), playerId: String(r.playerId) });
    history.pushState({}, '', '/play');
    openGame();
  };
  show(
    simple(
      joinCard({
        title: kind === 'create' ? 'Start a party' : 'Join a game',
        code,
        askCode: kind === 'code',
        cta: kind === 'create' ? 'Create room' : 'Join',
        onCancel: () => goHome(),
        onSubmit: async (name, c) => enter(kind === 'create' ? await call('room:create', { name }) : await call('room:join', { code: c, name })),
      }),
    ),
  );
}

async function openTv(code: string) {
  const game = new GameView(gm, ui, AREA, () => goHome(), true);
  show(game);
  offState = onState((s) => game.render(s));
  try {
    await watchAsTv(code);
    document.body.dataset.tv = code;
  } catch (e) {
    show(simple(errorOverlay((e as Error).message, () => location.reload())));
  }
}

async function startSolo(settings: GameSettings) {
  try {
    const r = await call('solo:start', { settings });
    saveSession({ code: String(r.code), playerId: String(r.playerId) });
    history.pushState({}, '', '/play');
    openGame();
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

function openGame() {
  const game = new GameView(gm, ui, AREA, () => goHome());
  show(game);
  offState = onState((s) => game.render(s));
}

async function boot() {
  ui.replaceChildren();
  mapEl.replaceChildren();
  const loading = loadingOverlay();
  ui.append(loading);
  if (!webglSupported()) {
    ui.replaceChildren(errorOverlay('This device can’t draw 3D maps (WebGL is off or unsupported).', boot));
    return;
  }
  try {
    gm = await createMap(mapEl, { center: [-78.6342, 35.8215], zoom: 14.6 });
    addPackBuildings(gm.map, AREA);
  } catch (err) {
    console.error(err);
    const msg = navigator.onLine ? 'The basemap service didn’t respond. Check your connection and try again.' : 'You’re offline. Reconnect and try again.';
    ui.replaceChildren(errorOverlay(msg, boot));
    return;
  }
  ui.append(cameraControls(gm));
  const banner = h('div', { class: 'conn-banner', role: 'status', hidden: true }, 'Reconnecting…');
  ui.append(banner);
  getSocket();
  onConnection((ok) => (banner.hidden = ok));
  loading.classList.add('overlay--fade');
  setTimeout(() => loading.remove(), 450);
  route();
  addEventListener('popstate', route);
  document.body.dataset.ready = 'true';
  (window as unknown as { __rr: unknown }).__rr = gm; // test hook
}

function route() {
  const m = /^\/(r|tv)\/([A-Za-z0-9]{4})\/?$/.exec(location.pathname);
  if (m?.[1] === 'tv') return void openTv(m[2]!.toUpperCase());
  if (m?.[1] === 'r') {
    const sess = loadSession();
    if (sess?.code === m[2]!.toUpperCase()) return openGame(); // reopened tab: resume
    return showJoin('link', m[2]!.toUpperCase());
  }
  if (location.pathname.startsWith('/play') && loadSession()) openGame();
  else goHome(location.pathname !== '/');
}

if (location.pathname.startsWith('/debug/flood')) {
  void import('./debug/flood.ts').then((m) => m.floodDebug(mapEl, ui));
} else {
  void boot();
}
