// The storm's news desk: a cartoon anchor in the printed inks reads the headlines as the storm
// unfolds, in the ElevenLabs broadcast voice, with a running feed under her. Her mouth follows the
// loudness of the voice; with no voice, it moves while the caption is up.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { currentStory, type Story } from '../story';
import { PLATE } from '../ui/Hud';
import { buzz, playSiren, playWaterRush } from '../ui/sound';
import { hush, prefetchSpeech, say, useVoice } from '../ui/voice';
import { clockLabel, stormHour } from './clock';
import { GROW_MS, STORM_MS, stepStart, type Storm } from './sim';
import { FINAL_FLOOD_STEP } from '@shared/config';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Headline {
  /** Storm time (ms) the line is due. */
  at: number;
  text: string;
}

/** What the anchor says: the alert, then one line per place the helicopter goes. */
export function headlines(storm: Storm, story: Story): Headline[] {
  const out: Headline[] = [{ at: 1800, text: story.alert }];
  for (const e of storm.events) {
    const step = storm.timeline.find((s) => s.step === e.step);
    const stranded = step ? Math.round(step.strandedPeople) : 0;
    const tail = stranded > 0 ? `${fmt(stranded)} residents are stranded so far.` : 'So far, everyone in harm’s way has reached safety.';
    out.push({ at: e.hold, text: `${e.news}. ${tail}` });
  }
  return out;
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

export function NewsDesk({ storm, stormAt }: { storm: Storm; stormAt: number }) {
  const story = useMemo(() => currentStory(), []);
  const lines = useMemo(() => headlines(storm, story), [storm, story]);
  const [feed, setFeed] = useState<{ clock: string; text: string }[]>([]);
  const line = useVoice((s) => s.line);

  useEffect(() => {
    void prefetchSpeech(
      lines.map((l) => l.text),
      'broadcast',
    );
    let cancelled = false;
    setFeed([]);
    void (async () => {
      for (const h of lines) {
        const wait = stormAt + h.at - performance.now();
        if (wait > 0) await sleep(wait);
        if (cancelled || performance.now() - stormAt > STORM_MS) return;
        setFeed((f) => [{ clock: clockLabel(stormHour(performance.now() - stormAt)), text: h.text }, ...f].slice(0, 3));
        await say(h.text, 'broadcast');
      }
    })();
    return () => {
      cancelled = true;
      hush();
    };
  }, [lines, stormAt]);

  const current = line ?? feed[0]?.text ?? null;
  return (
    <section aria-label={story.station} className={PLATE + ' pointer-events-auto flex w-full items-stretch overflow-hidden lg:w-72 lg:flex-col'}>
      <div className="relative w-28 shrink-0 border-r-(length:--rule) border-ink lg:w-full lg:border-r-0 lg:border-b-(length:--rule)">
        <Anchor station={story.station.toUpperCase()} />
        <span className="absolute top-1.5 left-1.5 bg-alarm px-1.5 font-display text-13 leading-5 font-extrabold text-ink">LIVE</span>
      </div>
      <div className="min-w-0 flex-1 p-2 lg:p-3">
        <p className="text-13 font-semibold">{story.station}</p>
        <p className="mt-0.5 line-clamp-3 font-display text-18 leading-tight font-bold lg:text-24" aria-live="polite">
          {current ?? 'Standing by'}
        </p>
        {feed.length > 1 && (
          <ul className="mt-2 hidden gap-1 border-t-(length:--rule) border-ink pt-2 text-13 lg:grid">
            {feed.slice(1).map((f) => (
              <li key={f.clock + f.text}>
                <span className="tabular font-semibold">{f.clock}</span> {f.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** A cartoon news anchor in flat inks. Mouth, blinks and a small nod run from one rAF loop. */
function Anchor({ station }: { station: string }) {
  const reduce = useReducedMotion();
  const mouth = useRef<SVGEllipseElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const head = useRef<SVGGElement>(null);

  useEffect(() => {
    let raf = 0;
    let open = 0;
    let blinkAt = performance.now() + 1500;
    let samples: Uint8Array<ArrayBuffer> | null = null;
    const tick = (now: number) => {
      const { clip, line } = useVoice.getState();
      let level = 0;
      if (clip) {
        if (!samples || samples.length !== clip.analyser.fftSize) samples = new Uint8Array(clip.analyser.fftSize);
        clip.analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += ((v - 128) / 128) ** 2;
        level = Math.min(1, Math.max(0, (Math.sqrt(sum / samples.length) - 0.015) * 7));
      } else if (line) {
        // No audio: a talking rhythm while the caption is up.
        level = Math.max(0, Math.sin(now / 85)) * (Math.sin(now / 410) > -0.4 ? 0.9 : 0.15);
      }
      open += (level - open) * 0.4;
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
  }, [reduce]);

  return (
    <svg viewBox="0 0 160 120" className="block h-full w-full" aria-hidden>
      {/* the studio: a flood-blue wall with the skyline */}
      <rect width="160" height="120" className="fill-flood" />
      <path d="M0 84V70h8v-8h7v10h6V58h8v14h5V64h9v20h56V60h7v-8h6v14h7V56h9v16h6v-6h8v18z" className="fill-flood-deep" />
      <g ref={head}>
        {/* shoulders, shirt and tie */}
        <path d="M34 120c0-22 18-32 46-32s46 10 46 32z" className="fill-ink" />
        <path d="M70 88l10 16 10-16z" className="fill-bond" />
        <path d="M77.5 92h5l-1.2 16h-2.6z" className="fill-signal" />
        {/* neck and head */}
        <rect x="72" y="70" width="16" height="20" className="fill-bond stroke-ink" strokeWidth="2.5" />
        <circle cx="80" cy="52" r="24" className="fill-bond stroke-ink" strokeWidth="3" />
        {/* a bob haircut */}
        <path d="M55 56c-2-18 8-30 25-30s27 12 25 30l-1 10c-3-4-4-12-5-19-10-5-28-5-38 0-1 7-2 15-5 19z" className="fill-ink" />
        {/* cheeks, brows, eyes, mouth */}
        <circle cx="66" cy="61" r="3.6" className="fill-alarm" opacity="0.45" />
        <circle cx="94" cy="61" r="3.6" className="fill-alarm" opacity="0.45" />
        <path d="M67 46q5-3 9 0M84 46q5-3 9 0" className="fill-none stroke-ink" strokeWidth="2.2" strokeLinecap="round" />
        <g ref={eyes}>
          <ellipse cx="72" cy="54" rx="3" ry="3.6" className="fill-ink" />
          <ellipse cx="88" cy="54" rx="3" ry="3.6" className="fill-ink" />
        </g>
        <ellipse ref={mouth} cx="80" cy="65" rx="5.5" ry="1.2" className="fill-ink" />
      </g>
      {/* the desk and its mic */}
      <path d="M118 104l-6-14" className="stroke-ink" strokeWidth="3" strokeLinecap="round" />
      <circle cx="111" cy="88" r="4" className="fill-ink" />
      <rect y="102" width="160" height="18" className="fill-ink" />
      <text x="80" y="116" textAnchor="middle" className="fill-signal font-display" fontSize={station.length > 18 ? 10 : 13} fontWeight="800">
        {station}
      </text>
    </svg>
  );
}
