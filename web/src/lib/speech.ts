/**
 * Browser speech fallback for briefings and radio alerts. ElevenLabs voices
 * replace this once the backend proxies the API key.
 */
export function speak(text: string, opts: { rate?: number; onBoundary?: (charIndex: number) => void; onEnd?: () => void } = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    opts.onEnd?.();
    return () => {};
  }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate ?? 1.02;
  u.pitch = 0.92;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((v) => /en-US/i.test(v.lang) && /(Daniel|Alex|Google US English|Samantha)/i.test(v.name)) ?? voices.find((v) => /en/i.test(v.lang));
  if (preferred) u.voice = preferred;
  if (opts.onBoundary) u.onboundary = (e) => opts.onBoundary?.(e.charIndex);
  if (opts.onEnd) u.onend = () => opts.onEnd?.();
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  return () => window.speechSynthesis.cancel();
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
