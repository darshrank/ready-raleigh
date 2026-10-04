// The storm's news desk: an anchor reads the headlines as the storm unfolds, on the channel the
// player picks (news.ts): America News in English or Bharat News in Hindi, each in its own
// ElevenLabs voice. Each report starts as its step begins (the helicopter then flies to the place it
// names). Earlier lines are spoken only if they end before the last report is due, so the last one
// always gets its slot; it may run through the clear-up and finish over the results card. A line
// that cannot finish in its window stays on the feed as a caption (long Hindi lines do not all fit).
// The reports are written by Gemini from the storm's facts and the mayors' plans (POST /api/news,
// storm/newsFacts.ts) when the server has a key; each one falls back to its template in news.ts,
// and a script that arrives mid-storm takes over from the next line.
// The anchor is a portrait from app/public/anchors/ when there is one (a second, mouth-open frame
// makes it talk), else a cartoon in the inks. Either way it moves with the loudness of the voice.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NewsFacts, NewsScript } from '@shared/news';
import { fetchNews } from '../api';
import { useReducedMotion } from 'motion/react';
import { FINAL_FLOOD_STEP } from '@shared/config';
import { CHANNELS, channelById, newsBook, useChannel, type ChannelId, type Lang } from '../news';
import { currentStory, type Story } from '../story';
import { PLATE } from '../ui/Hud';
import { buzz, playSiren, playWaterRush } from '../ui/sound';
import { hush, prefetchSpeech, say, useVoice } from '../ui/voice';
import { clockLabel, stormHour } from './clock';
import { GROW_MS, RESULTS_AFTER_MS, STORM_MS, stepStart, type Storm } from './sim';

/** The alert follows the siren in. */
const ALERT_AT = 1200;
/** A report starts this long after its step begins. */
const REPORT_AFTER_STEP_MS = 300;
/** A report that cannot start within this long of its moment stays on the feed, unspoken. */
const MAX_LATE_MS = 4500;
/** The last word is said at least this long before the results card arrives. */
const END_MARGIN_MS = 150;
/** The last report may finish over the first moments of the results card (its caption gives way). */
const OVER_RESULTS_MS = 3000;
/** Speech may go on through the clear-up and a little into the results card. */
export const SPEECH_END_MS = STORM_MS + RESULTS_AFTER_MS + OVER_RESULTS_MS - END_MARGIN_MS;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Headline {
  /** Storm time (ms) the line is due. */
  at: number;
  text: string;
}

/** The template report for helicopter stop `k`, in `lang`. */
export function templateReport(storm: Storm, story: Story, lang: Lang, k: number): string {
  const book = newsBook(lang, story.hazard);
  const e = storm.events[k]!;
  const step = storm.timeline.find((s) => s.step === e.step);
  const stranded = step ? Math.round(step.strandedPeople) : 0;
  const what =
    e.about.kind === 'road' ? book.road(e.about.name) : e.about.kind === 'cut' ? book.cut(e.about.name) : book.area(e.about.name, e.step);
  return `${what} ${stranded > 0 ? book.stranded(stranded) : book.safe}`;
}

/**
 * What the anchor says, in `lang`: the alert, then one report per place the helicopter goes,
 * Gemini's where the script has one, else the template.
 */
export function headlines(storm: Storm, story: Story, lang: Lang, script: NewsScript | null = null): Headline[] {
  const out: Headline[] = [{ at: ALERT_AT, text: story.alert[lang] }];
  storm.events.forEach((e, k) => {
    out.push({ at: stepStart(e.step) + REPORT_AFTER_STEP_MS, text: script?.lines[k]?.[lang] || templateReport(storm, story, lang, k) });
  });
  return out;
}

/** Gemini's script for this storm, once it arrives (null until then, and when the AI is off). */
function useNewsScript(facts: NewsFacts | null): NewsScript | null {
  const [script, setScript] = useState<{ for: NewsFacts; script: NewsScript } | null>(null);
  useEffect(() => {
    if (!facts) return;
    let live = true;
    void fetchNews(facts).then((s) => live && s && setScript({ for: facts, script: s }));
    return () => {
      live = false;
    };
  }, [facts]);
  return script && script.for === facts ? script.script : null;
}

/** The sounds and buzzes the storm clock drives: the siren at the start, rushing water per step. */
export function useStormFx(storm: Storm | null, stormAt: number | null) {
  useEffect(() => {
    if (!storm || stormAt === null) return;
    const timers: number[] = [];
    // Past moments (a skip moved the clock) do not replay.
    const at = (ms: number, fn: () => void) => {
      const wait = stormAt + ms - performance.now();
      if (wait > -250) timers.push(window.setTimeout(fn, Math.max(0, wait)));
    };
    at(400, () => {
      playSiren(2);
      buzz([300, 120, 300, 120, 500]);
    });
    // Floods only: the quake and the heat bring their own (storm/Weather.tsx).
    if (currentStory().hazard === 'flood')
      for (let k = 1; k <= FINAL_FLOOD_STEP; k++)
        at(stepStart(k) + GROW_MS * 0.4, () => {
          playWaterRush();
          buzz(140);
        });
    return () => timers.forEach(clearTimeout);
  }, [storm, stormAt]);
}

interface FeedItem {
  k: number;
  clock: string;
  text: string;
  lang: Lang;
}

export function NewsDesk({ storm, stormAt, facts = null }: { storm: Storm; stormAt: number; facts?: NewsFacts | null }) {
  const story = useMemo(() => currentStory(), []);
  const channelId = useChannel((s) => s.id);
  const channel = channelById(channelId);
  const script = useNewsScript(facts);
  const lines = useMemo(() => headlines(storm, story, channel.lang, script), [storm, story, channel.lang, script]);
  /** The reading loop reads the newest lines, so a script that arrives does not restart it. */
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const line = useVoice((s) => s.line);
  /** The first line not yet read to the end: a channel switch reads it again, in the new language. */
  const next = useRef(0);

  useEffect(() => {
    next.current = 0;
    setFeed([]);
  }, [storm, stormAt]);

  useEffect(() => {
    void prefetchSpeech(
      lines.slice(next.current).map((l) => l.text),
      channel.voice,
    );
  }, [lines, channel.voice]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (let k = next.current; k < linesRef.current.length; k++) {
        const h = linesRef.current[k]!;
        const wait = stormAt + h.at - performance.now();
        if (wait > 0) await sleep(wait);
        if (cancelled) return;
        const t = performance.now() - stormAt;
        // The storm is ending: nothing new starts.
        if (t > STORM_MS - 600) return;
        const item: FeedItem = { k, clock: clockLabel(stormHour(h.at)), text: h.text, lang: channel.lang };
        setFeed((f) => [item, ...f.filter((x) => x.k !== k)].slice(0, 3));
        const all = linesRef.current;
        const last = k === all.length - 1;
        const until = stormAt + (last ? SPEECH_END_MS : all[all.length - 1]!.at);
        if (t - h.at <= MAX_LATE_MS) await say(h.text, channel.voice, { until });
        if (cancelled) return;
        next.current = k + 1;
      }
    })();
    return () => {
      cancelled = true;
      // Mid-storm (a channel switch, Skip, leaving): stop talking. Once the storm is over, the last
      // report is allowed to finish while the results card comes up.
      if (performance.now() - stormAt < STORM_MS) hush();
    };
  }, [storm, stormAt, channel.voice, channel.lang]);

  const current = line ?? feed[0]?.text ?? null;
  return (
    <section aria-label={channel.name} className={PLATE + ' pointer-events-auto flex max-h-full w-full items-stretch overflow-hidden lg:w-[38rem]'}>
      <div className="relative w-32 shrink-0 border-r-(length:--rule) border-ink bg-ink sm:w-44 lg:w-64">
        <Anchor channel={channel.id} station={channel.name.toUpperCase()} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-2 lg:p-3">
        <ChannelTabs current={channel.id} />
        <p lang={channel.lang} className="mt-1.5 line-clamp-3 font-display text-18 leading-tight font-bold lg:text-24" aria-live="polite">
          {current ?? (channel.lang === 'hi' ? 'सीधा प्रसारण' : 'Standing by')}
        </p>
        {feed.length > 1 && (
          <ul className="mt-2 hidden gap-1 border-t-(length:--rule) border-ink pt-2 text-13 lg:grid">
            {feed.slice(1, 3).map((f) => (
              <li key={`${f.k}-${f.lang}`} lang={f.lang} className="line-clamp-2">
                <span className="tabular font-semibold">{f.clock}</span> {f.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** America News or Bharat News: switching mid-storm picks up at the line being read. */
function ChannelTabs({ current }: { current: ChannelId }) {
  const set = useChannel((s) => s.set);
  return (
    <div role="group" aria-label="News channel" className="flex self-start border-(length:--rule) border-ink">
      {CHANNELS.map((c, k) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={c.id === current}
          onClick={() => set(c.id)}
          className={
            'px-2 py-0.5 text-13 font-semibold ' +
            (k > 0 ? 'border-l-(length:--rule) border-ink ' : '') +
            (c.id === current ? 'bg-ink text-bond' : 'bg-bond text-ink hover:bg-chalk')
          }
        >
          <span className="sm:hidden">{c.short}</span>
          <span className="hidden sm:inline">{c.name}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The anchor

/**
 * A portrait in app/public/anchors/: `<channel>.jpg` (or .png, .webp), 4:3 with the face in the
 * upper half, and optionally `<channel>-talk.jpg` with the mouth open.
 */
const EXTENSIONS = ['jpg', 'png', 'webp'];
const probes = new Map<string, Promise<boolean>>();

/** Whether an image loads (once per page): no portrait yet means the cartoon. */
function imageLoads(url: string): Promise<boolean> {
  let p = probes.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    probes.set(url, p);
  }
  return p;
}

/** The first of `/anchors/<name>.<ext>` that loads, or null. */
async function findImage(name: string): Promise<string | null> {
  for (const ext of EXTENSIONS) {
    const url = `/anchors/${name}.${ext}`;
    if (await imageLoads(url)) return url;
  }
  return null;
}

type Portrait = { idle: string; talk: string | null };
/** Portraits looked up so far, per channel (null: none, so the cartoon). */
const portraits = new Map<ChannelId, Portrait | null>();

async function lookUpPortrait(id: ChannelId): Promise<void> {
  const [idle, talk] = await Promise.all([findImage(id), findImage(`${id}-talk`)]);
  portraits.set(id, idle ? { idle, talk } : null);
}

/** Look the anchors' portraits up ahead of the storm, so the desk opens on them (Solo, on mount). */
export function preloadAnchors() {
  for (const c of CHANNELS) if (!portraits.has(c.id)) void lookUpPortrait(c.id);
}

/** The channel's portrait, from the cache as soon as it is known; null until then (the cartoon). */
function usePortrait(id: ChannelId): Portrait | null {
  const [, found] = useState(0);
  useEffect(() => {
    if (portraits.has(id)) return;
    let live = true;
    void lookUpPortrait(id).then(() => live && found((n) => n + 1));
    return () => {
      live = false;
    };
  }, [id]);
  return portraits.get(id) ?? null;
}

let samples: Uint8Array<ArrayBuffer> | null = null;

/** How loud the anchor is now, 0..1: the voice's loudness, or a talking rhythm under a caption alone. */
function voiceLevel(now: number): number {
  const { clip, line } = useVoice.getState();
  if (clip) {
    if (!samples || samples.length !== clip.analyser.fftSize) samples = new Uint8Array(clip.analyser.fftSize);
    clip.analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const v of samples) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.max(0, (Math.sqrt(sum / samples.length) - 0.015) * 7));
  }
  if (line) return Math.max(0, Math.sin(now / 85)) * (Math.sin(now / 410) > -0.4 ? 0.9 : 0.15);
  return 0;
}

/** Each channel's studio and anchor, until a portrait is in app/public/anchors/. */
const LOOKS: Record<ChannelId, { wall: string; city: string; tie: string; hair: 'bob' | 'short'; glasses: boolean }> = {
  america: { wall: 'fill-flood', city: 'fill-flood-deep', tie: 'fill-signal', hair: 'bob', glasses: false },
  bharat: { wall: 'fill-signal', city: 'fill-ink/20', tie: 'fill-alarm', hair: 'short', glasses: true },
};

/** The anchor in the studio. Mouth (or the talking frame), blinks and a small nod run from one rAF loop. */
function Anchor({ channel, station }: { channel: ChannelId; station: string }) {
  const reduce = useReducedMotion();
  const art = usePortrait(channel);
  const mouth = useRef<SVGEllipseElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const head = useRef<SVGGElement>(null);
  const photo = useRef<HTMLDivElement>(null);
  const talk = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let raf = 0;
    let open = 0;
    let blinkAt = performance.now() + 1500;
    const tick = (now: number) => {
      open += (voiceLevel(now) - open) * 0.4;
      // A portrait: the mouth-open frame flaps with the voice, and the anchor leans in as they talk.
      if (talk.current) talk.current.style.opacity = open > 0.28 ? '1' : '0';
      if (photo.current && !reduce)
        photo.current.style.transform = `translateY(${(-open * 3).toFixed(2)}px) scale(${(1.02 + open * 0.035).toFixed(4)}) rotate(${(Math.sin(now / 260) * open * 0.6).toFixed(2)}deg)`;
      // The cartoon: mouth, blinks and a nod.
      mouth.current?.setAttribute('ry', (1.2 + open * 5.5).toFixed(2));
      let lid = 1;
      if (now > blinkAt) {
        if (now - blinkAt < 130) lid = 0.12;
        else blinkAt = now + 2200 + Math.random() * 2600;
      }
      eyes.current?.setAttribute('transform', `translate(0 54) scale(1 ${lid}) translate(0 -54)`);
      if (!reduce) head.current?.setAttribute('transform', `rotate(${(Math.sin(now / 380) * open * 3).toFixed(2)} 80 78)`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce, art]);

  const look = LOOKS[channel];
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden bg-flood">
      {art ? (
        <div ref={photo} className="absolute inset-0 origin-bottom">
          <img src={art.idle} alt="" className="absolute inset-0 h-full w-full object-cover object-top" />
          {art.talk && <img ref={talk} src={art.talk} alt="" className="absolute inset-0 h-full w-full object-cover object-top opacity-0" />}
        </div>
      ) : (
        <svg viewBox="0 0 160 120" className="block h-full w-full" aria-hidden>
          {/* the studio: a flat wall with a skyline */}
          <rect width="160" height="120" className={look.wall} />
          <path d="M0 84V70h8v-8h7v10h6V58h8v14h5V64h9v20h56V60h7v-8h6v14h7V56h9v16h6v-6h8v18z" className={look.city} />
          <g ref={head}>
            {/* shoulders, shirt and tie */}
            <path d="M34 120c0-22 18-32 46-32s46 10 46 32z" className="fill-ink" />
            <path d="M70 88l10 16 10-16z" className="fill-bond" />
            <path d="M77.5 92h5l-1.2 16h-2.6z" className={look.tie} />
            {/* neck and head */}
            <rect x="72" y="70" width="16" height="20" className="fill-bond stroke-ink" strokeWidth="2.5" />
            <circle cx="80" cy="52" r="24" className="fill-bond stroke-ink" strokeWidth="3" />
            {look.hair === 'bob' ? (
              <path d="M55 56c-2-18 8-30 25-30s27 12 25 30l-1 10c-3-4-4-12-5-19-10-5-28-5-38 0-1 7-2 15-5 19z" className="fill-ink" />
            ) : (
              <path d="M56.5 50C55 36 64 26.5 80 26.5S105 36 103.5 50c-2.5-7-6.5-10.5-12.5-12-7 3.5-19 4-28 1.5-3 2.5-5 6-6.5 10z" className="fill-ink" />
            )}
            {/* cheeks, brows, eyes, glasses, mouth */}
            <circle cx="66" cy="61" r="3.6" className="fill-alarm" opacity="0.45" />
            <circle cx="94" cy="61" r="3.6" className="fill-alarm" opacity="0.45" />
            <path d="M67 46q5-3 9 0M84 46q5-3 9 0" className="fill-none stroke-ink" strokeWidth="2.2" strokeLinecap="round" />
            <g ref={eyes}>
              <ellipse cx="72" cy="54" rx="3" ry="3.6" className="fill-ink" />
              <ellipse cx="88" cy="54" rx="3" ry="3.6" className="fill-ink" />
            </g>
            {look.glasses && (
              <g className="fill-none stroke-ink" strokeWidth="2">
                <rect x="65.5" y="49" width="13" height="10" rx="2.5" />
                <rect x="81.5" y="49" width="13" height="10" rx="2.5" />
                <path d="M78.5 53h3" />
              </g>
            )}
            <ellipse ref={mouth} cx="80" cy="65" rx="5.5" ry="1.2" className="fill-ink" />
          </g>
          {/* the desk and its mic */}
          <path d="M118 104l-6-14" className="stroke-ink" strokeWidth="3" strokeLinecap="round" />
          <circle cx="111" cy="88" r="4" className="fill-ink" />
          <rect y="102" width="160" height="18" className="fill-ink" />
        </svg>
      )}
      {/* The portraits carry their own LIVE badge; the cartoon gets ours. */}
      {!art && <span className="absolute top-1.5 left-1.5 bg-alarm px-1.5 font-display text-13 leading-5 font-extrabold text-ink">LIVE</span>}
      <p className="absolute inset-x-0 bottom-0 flex h-[15%] items-center justify-center bg-ink font-display text-[10px] leading-none font-extrabold tracking-wide text-signal sm:text-13 lg:text-15">
        {station}
      </p>
    </div>
  );
}
