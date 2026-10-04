// The landing: a printed globe you can spin and zoom, the four city packs on it, and city select.
// Hovering a card flies the globe to that city; Play flies all the way down to where the city's
// title orbit starts, then opens the game, so the hand-off reads as one camera move.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { motion, useReducedMotion } from 'motion/react';
import { BUDGET } from '@shared/config';
import { CITIES, type City, type CityId } from '../cities';
import { globeStyle } from '../map/globe';
import { Link, navigate } from '../router';
import { storyOf } from '../story';
import { tokens } from '../tokens';
import { money } from '../ui/format';
import { MapButton, PLATE, SoundButton } from '../ui/Hud';
import { Skyline } from '../ui/Skyline';
import { playStamp, unlockAudio } from '../ui/sound';
import { orbitCamera } from '../ui/Title';

// No I or O, so codes read cleanly off a projector.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newRoomCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

const PHONE = '(max-width: 639px)';
/** The globe at rest: North America in view, above the cards. */
const HOME = { center: [-90, 33] as [number, number], zoom: 2.1, pitch: 0, bearing: 0 };
/** Degrees of longitude per second while nobody touches the globe. */
const SPIN = 3;
/** Seconds the spin waits after the last drag, scroll or pinch. */
const SPIN_WAIT_S = 4;
/** Raleigh sits just below New York at globe scale: its label goes to the left of its pin. */
const LABEL_LEFT = new Set<CityId>(['raleigh']);

const button = 'border-(length:--rule) border-ink px-3 py-2 text-15 font-semibold';

export function Landing() {
  const reduce = !!useReducedMotion();
  const [phone] = useState(() => window.matchMedia(PHONE).matches);
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [focus, setFocus] = useState<CityId | null>(null);
  const [leaving, setLeaving] = useState<CityId | null>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const markers = useRef(new Map<CityId, HTMLButtonElement>());

  // The globe and its markers, made once.
  useEffect(() => {
    if (!container.current) return;
    const m = new MapLibreMap({
      container: container.current,
      style: globeStyle(tokens()),
      center: HOME.center,
      zoom: phone ? 1.1 : HOME.zoom,
      minZoom: 0.6,
      maxZoom: 15,
      attributionControl: { compact: true },
    });
    m.once('idle', () => m.getContainer().querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show'));
    m.setPadding(padFor(m.getContainer(), phone));
    for (const c of CITIES) {
      const left = LABEL_LEFT.has(c.id);
      const el = document.createElement('button');
      el.type = 'button';
      el.setAttribute('aria-label', `${c.name}: ${c.hazard}`);
      el.className = `group flex ${left ? 'flex-row-reverse' : 'flex-col'} items-center gap-1 outline-none`;
      el.innerHTML =
        `<span class="block border-(length:--rule) border-ink bg-bond px-2 py-0.5 font-display text-18 font-extrabold leading-none text-ink shadow-piece group-data-[on=true]:bg-signal">${c.name}</span>` +
        `<span class="block size-3.5 shrink-0 rounded-full border-(length:--rule) border-bond bg-ink"></span>`;
      el.addEventListener('mouseenter', () => setFocus(c.id));
      el.addEventListener('click', () => {
        unlockAudio();
        setFocus(c.id);
      });
      markers.current.set(c.id, el);
      new Marker({ element: el, anchor: left ? 'right' : 'bottom', opacityWhenCovered: '0' }).setLngLat(c.center).addTo(m);
    }
    if (import.meta.env.DEV) (window as unknown as { __map?: MapLibreMap }).__map = m;
    setMap(m);
    return () => {
      markers.current.clear();
      m.remove();
    };
  }, [phone]);

  // Spin while idle; any drag, scroll or pinch pauses it for a few seconds.
  useEffect(() => {
    if (!map || reduce) return;
    let holdUntil = 0;
    const hold = () => (holdUntil = performance.now() + SPIN_WAIT_S * 1000);
    const events = ['mousedown', 'touchstart', 'wheel', 'dragstart'] as const;
    for (const e of events) map.on(e, hold);
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      if (now > holdUntil && !focusRef.current && !map.isMoving() && map.getZoom() < 3.5) {
        const c = map.getCenter();
        map.jumpTo({ center: [c.lng + SPIN * dt, c.lat] });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const e of events) map.off(e, hold);
    };
  }, [map, reduce]);

  // A focused city: its marker lights up and the globe flies to it; none: back to the globe.
  useEffect(() => {
    for (const [id, el] of markers.current) el.dataset.on = String(id === focus);
    if (!map || leaving) return;
    const city = CITIES.find((c) => c.id === focus);
    const duration = reduce ? 0 : 2400;
    if (city) map.flyTo({ center: city.center, zoom: phone ? 8.6 : 9.4, pitch: 40, bearing: 0, duration, curve: 1.5, essential: true });
    else map.flyTo({ ...HOME, zoom: phone ? 1.1 : HOME.zoom, duration, essential: true });
  }, [focus, map, leaving, phone, reduce]);

  const play = (city: City) => {
    if (!city.ready || !map) return;
    unlockAudio();
    playStamp();
    setLeaving(city.id);
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    let gone = false;
    const go = () => {
      if (gone) return;
      gone = true;
      navigate(city.id === 'raleigh' ? '/solo' : `/solo?city=${city.id}`);
    };
    if (reduce) return go();
    map.flyTo({ ...orbitCamera(w, h, phone, storyOf(city.id)), duration: 3200, curve: 1.6, essential: true });
    map.once('moveend', go);
    // A paused tab never ends the flight; open the game anyway.
    window.setTimeout(go, 4200);
  };

  const appear = (delay: number) => (reduce ? {} : { initial: { y: 40, opacity: 0 }, animate: { y: 0, opacity: 1 }, transition: { duration: 0.5, delay } });

  return (
    <div className="relative h-full overflow-hidden bg-storm-land">
      {/* maplibre-gl.css forces position: relative on the container, so a wrapper does the positioning. */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" role="region" aria-label="Globe. Drag to spin it, scroll or pinch to zoom." />
      </div>

      <motion.div
        className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-3 p-3 lg:p-6"
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={{ duration: reduce ? 0 : 0.5, delay: leaving ? 0.4 : 0 }}
      >
        <div className="flex items-start justify-between gap-3">
          <motion.div {...appear(0.1)} className={PLATE + ' pointer-events-auto max-w-md px-4 py-3 lg:px-6 lg:py-5'}>
            <h1 className="font-display text-48 leading-[0.85] font-extrabold lg:text-72">Ready Raleigh</h1>
            <p className="mt-2 hidden text-15 sm:block lg:text-18">
              Plan a city's response to a disaster on real data. {money(BUDGET)}, a few minutes, then the disaster tests your plan.
            </p>
          </motion.div>
          <motion.div {...appear(0.2)} className="pointer-events-auto flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <SoundButton />
              {map && (
                <>
                  <MapButton on={false} label="Zoom in" onClick={() => map.zoomIn()}>
                    +
                  </MapButton>
                  <MapButton on={false} label="Zoom out" onClick={() => map.zoomOut()}>
                    −
                  </MapButton>
                </>
              )}
            </div>
            <Rooms compact={phone} />
          </motion.div>
        </div>

        <section aria-labelledby="choose" onMouseLeave={() => !phone && setFocus(null)}>
          <motion.div {...appear(0.3)} className="mb-2 flex items-end justify-between gap-3">
            <h2 id="choose" className={PLATE + ' pointer-events-auto px-3 py-1 font-display text-32 font-extrabold lg:text-48'}>
              Choose your city
            </h2>
            <p className="hidden bg-bond px-2 py-1 text-13 lg:block">Drag to spin the globe. Scroll or pinch to zoom.</p>
          </motion.div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-4">
            {CITIES.map((c, i) => (
              <CityCard key={c.id} city={c} index={i} active={focus === c.id} compact={phone} reduce={reduce} onFocus={() => setFocus(c.id)} onPlay={() => play(c)} />
            ))}
          </div>
        </section>
      </motion.div>
    </div>
  );
}

/** Room for the plates, so a focused city lands in the open part of the globe. */
function padFor(el: HTMLElement, phone: boolean) {
  const h = el.clientHeight;
  return phone ? { top: 120, right: 0, bottom: Math.round(h * 0.42), left: 0 } : { top: 140, right: 0, bottom: Math.round(Math.min(360, h * 0.4)), left: 0 };
}

function CityCard({
  city,
  index,
  active,
  compact,
  reduce,
  onFocus,
  onPlay,
}: {
  city: City;
  index: number;
  active: boolean;
  compact: boolean;
  reduce: boolean;
  onFocus: () => void;
  onPlay: () => void;
}) {
  return (
    <motion.article
      initial={reduce ? false : { y: 60, opacity: 0 }}
      animate={{ y: active && !reduce ? -6 : 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26, delay: reduce ? 0 : active ? 0 : 0.35 + index * 0.08 }}
      onMouseEnter={onFocus}
      onFocus={onFocus}
      onClick={onFocus}
      className={
        'pointer-events-auto flex min-w-0 flex-col border-(length:--rule) border-ink p-2.5 lg:p-4 ' +
        (active ? 'bg-signal shadow-[8px_8px_0_var(--ink)]' : 'bg-bond shadow-plate')
      }
    >
      <p className="flex items-center gap-1.5 text-13 font-semibold">
        <HazardIcon id={city.id} />
        <span className="truncate">{city.hazard}</span>
      </p>
      <h3 className={'mt-1 font-display leading-none font-extrabold ' + (compact ? 'truncate text-24' : 'text-32 lg:text-48')}>{city.name}</h3>
      <p className={'font-display leading-tight font-bold ' + (compact ? 'text-15' : 'text-18 lg:text-24')}>{city.title}</p>
      <Skyline shapes={city.skyline} className={compact ? 'mt-1 h-5 w-full' : 'mt-2 h-8 w-full lg:h-12'} />
      {!compact && <p className="mt-2 text-13">{city.question}</p>}
      <button
        type="button"
        disabled={!city.ready}
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
        className={
          'w-full border-(length:--rule) border-ink px-3 text-left font-display leading-none font-extrabold ' +
          (compact ? 'mt-2 py-1.5 text-18 ' : 'mt-3 py-2 text-24 ') +
          (city.ready ? 'bg-ink text-signal hover:bg-bond hover:text-ink' : 'bg-bond text-ink/50')
        }
      >
        {city.ready ? 'Play' : 'Coming next'}
      </button>
    </motion.article>
  );
}

/** Host, join or watch: everything the old landing offered, in one corner plate. */
function Rooms({ compact }: { compact: boolean }) {
  const [code, setCode] = useState('');
  const [open, setOpen] = useState(!compact);
  const join = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === 4) navigate(`/play/${code}`);
  };
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={button + ' bg-bond shadow-piece'}>
        Play with friends
      </button>
    );
  return (
    <div className={PLATE + ' w-72 max-w-[calc(100vw-1.5rem)] p-3'}>
      <p className="text-15 font-semibold">Play with friends</p>
      <form onSubmit={join} className="mt-2 flex">
        <label htmlFor="room" className="sr-only">
          Room code
        </label>
        <input
          id="room"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
          placeholder="Code"
          autoComplete="off"
          className="tabular w-28 border-(length:--rule) border-ink bg-bond px-3 py-1.5 font-display text-24 font-bold tracking-widest placeholder:text-ink/40"
        />
        <button type="submit" disabled={code.length !== 4} className={button + ' -ml-(--rule) bg-ink text-bond disabled:bg-bond disabled:text-ink/50'}>
          Join
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => navigate(`/play/${newRoomCode()}?host`)} className={button + ' bg-ink text-bond'}>
          Host a game
        </button>
        <Link to="/planner" className={button + ' bg-bond'}>
          Planner view
        </Link>
      </div>
    </div>
  );
}

/** Small ink pictograms: water, surge, sun, a fault crack. */
function HazardIcon({ id }: { id: CityId }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true, className: 'shrink-0 fill-none stroke-ink', strokeWidth: 2, strokeLinecap: 'round' as const };
  if (id === 'raleigh')
    return (
      <svg {...common}>
        <path d="M1 7c2-2 4 2 7 0s5 2 7 0M1 12c2-2 4 2 7 0s5 2 7 0" />
      </svg>
    );
  if (id === 'miami')
    return (
      <svg {...common}>
        <path d="M1 12c2-2 4 2 7 0s5 2 7 0M4 8l4-5 4 5M8 3v6" />
      </svg>
    );
  if (id === 'new-york')
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M1 9h3l2-5 3 9 2-6 1 2h3" />
    </svg>
  );
}
