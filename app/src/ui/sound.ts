// Game sounds, synthesized with Web Audio (DESIGN.md "Sound"): no files to load, nothing to fail.
// On by default on desktop, off on phones; the choice is remembered. Every call is a no-op when
// sound is off or the browser has no Web Audio.
import { create } from 'zustand';

const KEY = 'ready-raleigh-sound';

function initialOn(): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'on' || saved === 'off') return saved === 'on';
  } catch {
    // Storage can be blocked; fall through to the default.
  }
  return !window.matchMedia('(pointer: coarse)').matches;
}

export const useSound = create<{ on: boolean; toggle: () => void }>((set, get) => ({
  on: initialOn(),
  toggle: () => {
    const on = !get().on;
    set({ on });
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      // Not remembered; still applies now.
    }
    if (on) unlockAudio();
    else stopRain(0);
  },
}));

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

function audio(): { c: AudioContext; out: GainNode } | null {
  if (!useSound.getState().on) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return { c: ctx, out: master! };
}

/** Call from a click or tap: browsers only start audio after a user gesture. */
export function unlockAudio() {
  audio();
}

/** True once a gesture has started audio, so speech can play without another tap. */
export const audioRunning = () => !!ctx && ctx.state === 'running' && useSound.getState().on;

export interface Clip {
  stop: () => void;
  /** Seconds. */
  duration: number;
  /** Speech loudness, for the news anchor's mouth. */
  analyser: AnalyserNode;
  ended: Promise<void>;
}

/** Play encoded speech (mp3) through the game's audio, so the mute toggle applies to it too. */
export async function playClip(data: ArrayBuffer): Promise<Clip | null> {
  const a = audio();
  if (!a) return null;
  const { c, out } = a;
  const buffer = await c.decodeAudioData(data.slice(0));
  const src = c.createBufferSource();
  src.buffer = buffer;
  const analyser = c.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser).connect(out);
  const ended = new Promise<void>((resolve) => (src.onended = () => resolve()));
  src.start();
  return {
    stop: () => {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    },
    duration: buffer.duration,
    analyser,
    ended,
  };
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
  osc.type = 'sine';
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
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const cg = c.createGain();
  cg.gain.setValueAtTime(0.18, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
  click.connect(hp).connect(cg).connect(out);
  click.start(t, Math.random() * 2, 0.05);
}

/** The weak-spot scan: a soft rising sweep with ticks, like a radar finding something. */
export function playScan() {
  const a = audio();
  if (!a) return;
  const { c, out } = a;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(280, t);
  osc.frequency.exponentialRampToValueAtTime(1100, t + 1.6);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.2);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 1.9);
  for (let k = 0; k < 6; k++) {
    const tick = c.createOscillator();
    const tg = c.createGain();
    tick.type = 'square';
    tick.frequency.value = 1400;
    const s = t + 0.15 + k * 0.27;
    tg.gain.setValueAtTime(0.0001, s);
    tg.gain.exponentialRampToValueAtTime(0.03, s + 0.005);
    tg.gain.exponentialRampToValueAtTime(0.0001, s + 0.05);
    tick.connect(tg).connect(out);
    tick.start(s);
    tick.stop(s + 0.06);
  }
}

/** The storm begins: a two-note alert chime (gentler than a real alert tone). */
export function playAlert() {
  const a = audio();
  if (!a) return;
  const { c, out } = a;
  [
    [659, 0, 0.2],
    [880, 0.22, 0.34],
  ].forEach(([f, start, len]) => {
    const t = c.currentTime + start!;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f!;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len!);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + len! + 0.05);
  });
}

/** Phones only (coarse pointer), like the stamp's 15 ms buzz. */
export function buzz(pattern: number | number[]) {
  if (!window.matchMedia('(pointer: coarse)').matches || !('vibrate' in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // some browsers refuse vibration outside a gesture
  }
}

/** A civil-defense siren: a slow wail up and down, `cycles` times. */
export function playSiren(cycles = 2) {
  const a = audio();
  if (!a) return;
  const { c, out } = a;
  const t = c.currentTime;
  const len = 2.2 * cycles;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1600;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.5);
  g.gain.setValueAtTime(0.09, t + len - 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  lp.connect(g).connect(out);
  for (const detune of [0, 7]) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(260, t);
    for (let k = 0; k < cycles; k++) {
      osc.frequency.linearRampToValueAtTime(720, t + k * 2.2 + 1.1);
      osc.frequency.linearRampToValueAtTime(300, t + k * 2.2 + 2.2);
    }
    osc.connect(lp);
    osc.start(t);
    osc.stop(t + len + 0.05);
  }
}

/** An earthquake: a sub-bass roar with a shaking wobble and cracking, `seconds` long. */
export function playRumble(seconds = 4, strength = 1) {
  const a = audio();
  if (!a) return;
  const { c, out } = a;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 140;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(1.1 * strength, t + 0.3);
  g.gain.setValueAtTime(1.1 * strength, t + seconds * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  src.connect(lp).connect(g).connect(out);
  src.start(t);
  src.stop(t + seconds + 0.1);
  const sub = c.createOscillator();
  sub.frequency.value = 36;
  const sg = c.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.exponentialRampToValueAtTime(0.5 * strength, t + 0.25);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  sub.connect(sg).connect(out);
  sub.start(t);
  sub.stop(t + seconds + 0.1);
  for (let k = 0; k < 10 * strength; k++) {
    const s = t + 0.2 + Math.random() * seconds * 0.8;
    const crack = c.createBufferSource();
    crack.buffer = noiseBuffer(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 400 + Math.random() * 1400;
    bp.Q.value = 2;
    const cg = c.createGain();
    cg.gain.setValueAtTime(0.0001, s);
    cg.gain.exponentialRampToValueAtTime(0.18 * strength, s + 0.01);
    cg.gain.exponentialRampToValueAtTime(0.0001, s + 0.12);
    crack.connect(bp).connect(cg).connect(out);
    crack.start(s, Math.random() * 2, 0.14);
  }
}

/** The grid fails: a falling hum and a click. */
export function playPowerDown() {
  const a = audio();
  if (!a) return;
  const { c, out } = a;
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(28, t + 1.3);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  osc.connect(lp).connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 1.5);
}

/** Water rushing over a street as a step's flooding prints. */
export function playWaterRush() {
  const a = audio();
  if (!a) return;
  const { c, out } = a;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(500, t);
  lp.frequency.exponentialRampToValueAtTime(1300, t + 0.7);
  lp.frequency.exponentialRampToValueAtTime(400, t + 2);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
  src.connect(lp).connect(g).connect(out);
  src.start(t, Math.random() * 1.5, 2.2);
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
  lp.type = 'lowpass';
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
  bp.type = 'bandpass';
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
