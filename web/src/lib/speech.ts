"use client";

import { api, useBackend } from "@/lib/api";
import { sfx } from "@/lib/audio/sfx";

interface SpeakOpts {
  rate?: number;
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
}

const clips = new Map<string, Promise<ArrayBuffer>>();
let token = 0;
let stopClip: (() => void) | null = null;
let speaking = false;

export const isSpeaking = () => speaking;

const elevenlabsReady = () => {
  const b = useBackend.getState();
  return b.status === "online" && b.services.elevenlabs;
};

/** Start fetching a voice clip early so it plays without a gap. */
export function prefetchSpeech(text: string) {
  if (elevenlabsReady() && !clips.has(text)) {
    const p = api.tts(text);
    p.catch(() => clips.delete(text));
    clips.set(text, p);
  }
}

/** ElevenLabs voice through the backend when it is up, the browser's speech engine otherwise. */
export function speak(text: string, opts: SpeakOpts = {}) {
  stopSpeaking();
  const my = ++token;
  if (!sfx.on) {
    opts.onEnd?.();
    return () => {};
  }
  speaking = true;
  const finish = () => {
    if (my !== token) return;
    speaking = false;
    opts.onBoundary?.(text.length);
    opts.onEnd?.();
  };
  if (!elevenlabsReady()) {
    browserSpeak(text, opts, finish);
    return () => my === token && stopSpeaking();
  }
  prefetchSpeech(text);
  clips
    .get(text)!
    .then(async (buf) => {
      if (my !== token) return;
      const clip = await sfx.playClip(buf, finish);
      if (!clip || my !== token) return clip?.stop();
      let raf = 0;
      stopClip = () => {
        cancelAnimationFrame(raf);
        clip.stop();
      };
      if (opts.onBoundary) {
        const tick = () => {
          const f = Math.min(1, (sfx.now - clip.startedAt) / clip.duration);
          opts.onBoundary?.(Math.floor(f * text.length));
          if (f < 1 && my === token) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }
    })
    .catch(() => {
      clips.delete(text);
      if (my === token) browserSpeak(text, opts, finish);
    });
  return () => my === token && stopSpeaking();
}

/** Radio-style line: skipped while something else is being said. */
export function narrate(text: string) {
  if (speaking) return;
  speak(text, { rate: 1.08 });
}

export function stopSpeaking() {
  token++;
  speaking = false;
  stopClip?.();
  stopClip = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

function browserSpeak(text: string, opts: SpeakOpts, finish: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    finish();
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate ?? 1.02;
  u.pitch = 0.92;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((v) => /en-US/i.test(v.lang) && /(Daniel|Alex|Google US English|Samantha)/i.test(v.name)) ?? voices.find((v) => /en/i.test(v.lang));
  if (preferred) u.voice = preferred;
  if (opts.onBoundary) u.onboundary = (e) => opts.onBoundary?.(e.charIndex);
  u.onend = finish;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
