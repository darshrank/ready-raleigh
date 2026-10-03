"use client";

// Storm sounds, synthesized with Web Audio (ported from the sakhi/visual-overhaul branch): no files
// to load, nothing to fail. On by default on desktop, off on phones; the choice is remembered.
// Every call is a no-op when sound is off or the browser has no Web Audio.
import { create } from "zustand";

const KEY = "faultline-sound";

function initialOn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "on" || saved === "off") return saved === "on";
  } catch {
    // storage blocked: fall through to the default
  }
  return !window.matchMedia("(pointer: coarse)").matches;
}

export const useSound = create<{ on: boolean; toggle: () => void }>((set, get) => ({
  on: initialOn(),
  toggle: () => {
    const on = !get().on;
    set({ on });
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      // not remembered; still applies now
    }
    if (on) unlockAudio();
    else stopRain(0);
  },
}));

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

function audio(): { c: AudioContext; out: GainNode } | null {
  if (!useSound.getState().on || typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return { c: ctx, out: master! };
}

/** Call from a click or tap: browsers only start audio after a user gesture. */
export function unlockAudio() {
  audio();
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise) return noise;
  noise = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

/** A piece stamping onto the board: a low thump with a short click. */
export function playStamp() {
  const a = audio();
  if (!a) return;
  const { c, out } = a;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(170, t);
  osc.frequency.exponentialRampToValueAtTime(55, t + 0.13);
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.22);
  const click = c.createBufferSource();
  click.buffer = noiseBuffer(c);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2500;
  const cg = c.createGain();
  cg.gain.setValueAtTime(0.18, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
  click.connect(hp).connect(cg).connect(out);
  click.start(t, Math.random() * 2, 0.05);
}

/** The storm begins: a two-note alert chime (gentler than a real alert tone). */
export function playAlert() {
  const a = audio();
  if (!a) return;
  const { c, out } = a;
  (
    [
      [659, 0, 0.2],
      [880, 0.22, 0.34],
    ] as const
  ).forEach(([f, start, len]) => {
    const t = c.currentTime + start;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "triangle";
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + len + 0.05);
  });
}

/** Thunder after a lightning flash, `delay` seconds later. */
export function playThunder(delay: number) {
  const a = audio();
  if (!a) return;
  const { c, out } = a;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(420, t);
  lp.frequency.exponentialRampToValueAtTime(80, t + 2.6);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.7, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
  src.connect(lp).connect(g).connect(out);
  src.start(t, 0, 2.9);
}

let rain: { src: AudioBufferSourceNode; g: GainNode } | null = null;

/** Rain on the roof, looped, fading in. */
export function startRain() {
  const a = audio();
  if (!a || rain) return;
  const { c, out } = a;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1500;
  bp.Q.value = 0.6;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.06, c.currentTime + 1.2);
  src.connect(bp).connect(g).connect(out);
  src.start();
  rain = { src, g };
}

export function stopRain(fadeMs = 1200) {
  if (!rain || !ctx) return;
  const { src, g } = rain;
  rain = null;
  const t = ctx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.01, fadeMs / 1000));
  src.stop(t + fadeMs / 1000 + 0.05);
}
