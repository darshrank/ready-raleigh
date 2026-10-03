"use client";

/** Game audio synthesized with the Web Audio API, so there is nothing to download. */

type LoopName = "rain" | "wind" | "fire" | "heat";
type NoiseKind = "white" | "pink" | "brown";

interface LoopHandle {
  gain: GainNode;
  nodes: AudioScheduledSourceNode[];
  timer?: ReturnType<typeof setInterval>;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private send: GainNode | null = null;
  private buffers: Partial<Record<NoiseKind, AudioBuffer>> = {};
  private loops = new Map<LoopName, LoopHandle>();
  private last = new Map<string, number>();
  private muted = false;

  /** Browsers only allow audio after a user gesture, so call this from one. */
  unlock() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 5;
      comp.connect(ctx.destination);
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.8;
      master.connect(comp);
      const reverb = ctx.createConvolver();
      reverb.buffer = this.impulse(ctx, 2.6);
      const send = ctx.createGain();
      send.gain.value = 0.4;
      send.connect(reverb).connect(master);
      this.ctx = ctx;
      this.master = master;
      this.send = send;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.08);
    if (muted) this.stopLoops(0.2);
  }

  get on() {
    return !!this.ctx && !this.muted;
  }

  /** True at most once per `ms` for a key, to keep busy moments from turning into noise. */
  throttle(key: string, ms: number) {
    const now = performance.now();
    if (now - (this.last.get(key) ?? -1e9) < ms) return false;
    this.last.set(key, now);
    return true;
  }

  buzz(pattern: number | number[]) {
    if (this.muted || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* not allowed outside a gesture on some browsers */
    }
  }

  // ---------------------------------------------------------------- UI

  click() {
    this.tone("sine", 880, 0.07, 0.12, { to: 560 });
  }

  place() {
    this.tone("triangle", 523, 0.12, 0.18);
    this.tone("triangle", 784, 0.16, 0.16, { delay: 0.06 });
    this.noise("brown", 0.12, 0.25, { type: "lowpass", freq: 500 });
  }

  deny() {
    this.tone("square", 150, 0.16, 0.08);
    this.tone("square", 112, 0.2, 0.08, { delay: 0.12 });
  }

  tick() {
    this.tone("sine", 990, 0.1, 0.18);
  }

  lock() {
    this.tone("sine", 90, 0.7, 0.9, { to: 34 });
    this.noise("white", 0.4, 0.35, { type: "lowpass", freq: 1600, to: 200 });
    [261.6, 329.6, 392].forEach((f) => this.tone("triangle", f, 0.9, 0.09, { delay: 0.05, send: 0.5 }));
  }

  whoosh() {
    this.noise("white", 0.4, 0.12, { type: "bandpass", freq: 400, to: 2600, q: 1.2 });
  }

  alert(level: "critical" | "warning" | "success" | "info") {
    if (level === "critical") {
      [0, 0.16, 0.32].forEach((d, i) => this.tone("square", i % 2 ? 554 : 740, 0.13, 0.07, { delay: d }));
    } else if (level === "warning") {
      [0, 0.2].forEach((d) => this.tone("triangle", 660, 0.16, 0.1, { delay: d }));
    } else if (level === "success") {
      [660, 880, 1320].forEach((f, i) => this.tone("sine", f, 0.3, 0.1, { delay: i * 0.08, send: 0.4 }));
    } else {
      this.tone("sine", 720, 0.12, 0.06);
    }
  }

  scoreTick() {
    this.tone("sine", 1500, 0.03, 0.04);
  }

  fanfare() {
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone("triangle", f, i === 3 ? 1.1 : 0.22, 0.14, { delay: i * 0.12, send: 0.5 }));
    this.noise("white", 1.2, 0.04, { type: "highpass", freq: 6000 }, { delay: 0.36 });
  }

  // ---------------------------------------------------------------- disasters

  /** Earthquake: sub-bass roar with a shaking wobble and cracking structure. */
  rumble(seconds = 4, strength = 1) {
    const c = this.ctx;
    if (!this.on || !c) return;
    const t = c.currentTime;
    const src = this.source("brown", true);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 150;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * strength, t + 0.35);
    g.gain.setValueAtTime(0.9 * strength, t + seconds * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    src.connect(lp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + seconds + 0.1);

    const sub = c.createOscillator();
    sub.frequency.value = 38;
    const subGain = c.createGain();
    subGain.gain.value = 0;
    const lfo = c.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.35 * strength;
    lfo.connect(lfoGain).connect(subGain.gain);
    const subEnv = c.createGain();
    subEnv.gain.setValueAtTime(0.0001, t);
    subEnv.gain.exponentialRampToValueAtTime(1, t + 0.3);
    subEnv.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    sub.connect(subGain).connect(subEnv).connect(this.master!);
    [sub, lfo].forEach((o) => {
      o.start(t);
      o.stop(t + seconds + 0.1);
    });
    for (let i = 0; i < 14 * strength; i++) {
      this.noise("white", rand(0.03, 0.12), rand(0.08, 0.2) * strength, { type: "bandpass", freq: rand(300, 1400), q: 2 }, { delay: rand(0.2, seconds * 0.8), pan: rand(-0.8, 0.8), send: 0.4 });
    }
  }

  /** A building giving way: tearing, a heavy impact, then debris. */
  collapse(pan = rand(-0.7, 0.7)) {
    if (!this.on) return;
    const d = rand(0, 0.15);
    this.noise("white", 1.7, 0.5, { type: "lowpass", freq: 4200, to: 220 }, { delay: d, pan, send: 0.55 });
    this.tone("sine", 72, 1, 0.85, { to: 26, delay: d + 0.15, pan });
    for (let i = 0; i < 9; i++) {
      this.noise("white", rand(0.03, 0.08), rand(0.08, 0.2), { type: "bandpass", freq: rand(1200, 3600), q: 3 }, { delay: d + rand(0.3, 1.5), pan: pan + rand(-0.2, 0.2) });
    }
  }

  /** Lightning crack followed by rolling thunder; `distance` 0 is overhead. */
  thunder(distance = 0.4) {
    if (!this.on) return;
    const delay = 0.15 + distance * 1.6;
    this.noise("white", 0.09, 0.55 * (1 - distance * 0.7), { type: "highpass", freq: 1800 }, { delay, send: 0.6 });
    this.noise("brown", 3.6, 0.85 * (1 - distance * 0.4), { type: "lowpass", freq: 900, to: 110 }, { delay: delay + 0.04, send: 0.7, attack: 0.08 });
    this.noise("brown", 2.2, 0.4, { type: "lowpass", freq: 300 }, { delay: delay + 0.9, send: 0.7, attack: 0.3 });
  }

  waterRush() {
    this.noise("pink", 1.8, 0.28, { type: "lowpass", freq: 1100, to: 500 }, { attack: 0.5, pan: rand(-0.5, 0.5) });
  }

  siren() {
    const c = this.ctx;
    if (!this.on || !c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(650, t);
    for (let k = 0; k < 2; k++) {
      o.frequency.linearRampToValueAtTime(1080, t + k * 1.4 + 0.7);
      o.frequency.linearRampToValueAtTime(650, t + k * 1.4 + 1.4);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    const p = c.createStereoPanner();
    p.pan.value = rand(-0.8, 0.8);
    o.connect(g).connect(p).connect(this.master!);
    g.connect(this.send!);
    o.start(t);
    o.stop(t + 2.9);
  }

  powerDown() {
    this.tone("sawtooth", 240, 1.4, 0.22, { to: 30 });
    this.tone("sine", 60, 0.5, 0.12, { to: 20, delay: 0.1 });
    this.noise("white", 0.05, 0.3, { type: "highpass", freq: 3000 }, { delay: 1.35 });
  }

  // ---------------------------------------------------------------- ambience

  /** Fade a looping ambience to `level` (0 stops it). */
  loop(name: LoopName, level: number) {
    const c = this.ctx;
    if (!c) return;
    const target = this.muted ? 0 : Math.max(0, Math.min(1, level));
    let h = this.loops.get(name);
    if (!h && target <= 0.001) return;
    if (!h) {
      h = this.makeLoop(name);
      this.loops.set(name, h);
    }
    const scale = { rain: 0.42, wind: 0.3, fire: 0.22, heat: 0.1 }[name];
    h.gain.gain.setTargetAtTime(target * scale, c.currentTime, 0.6);
    if (target <= 0.001) this.dropLoop(name, 2);
  }

  stopLoops(fade = 1) {
    for (const name of [...this.loops.keys()]) this.dropLoop(name, fade);
  }

  // ---------------------------------------------------------------- speech clips

  get now() {
    return this.ctx?.currentTime ?? 0;
  }

  /** Play an encoded clip (narration) through the same graph, so mute applies and iOS allows it. */
  async playClip(data: ArrayBuffer, onEnd?: () => void): Promise<{ stop: () => void; duration: number; startedAt: number } | null> {
    const c = this.ctx;
    if (!c || this.muted) return null;
    const buf = await c.decodeAudioData(data.slice(0));
    const s = c.createBufferSource();
    s.buffer = buf;
    const g = c.createGain();
    g.gain.value = 1.15;
    s.connect(g).connect(this.master!);
    s.onended = () => onEnd?.();
    const startedAt = c.currentTime;
    s.start();
    return {
      stop: () => {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      },
      duration: buf.duration,
      startedAt,
    };
  }

  // ---------------------------------------------------------------- internals

  private dropLoop(name: LoopName, fade: number) {
    const c = this.ctx;
    const h = this.loops.get(name);
    if (!c || !h) return;
    this.loops.delete(name);
    h.gain.gain.setTargetAtTime(0, c.currentTime, fade / 4);
    if (h.timer) clearInterval(h.timer);
    h.nodes.forEach((n) => n.stop(c.currentTime + fade + 0.1));
  }

  private makeLoop(name: LoopName): LoopHandle {
    const c = this.ctx!;
    const gain = c.createGain();
    gain.gain.value = 0;
    gain.connect(this.master!);
    const nodes: AudioScheduledSourceNode[] = [];
    const filtered = (kind: NoiseKind, type: BiquadFilterType, freq: number, q = 0.7) => {
      const s = this.source(kind, true);
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      s.connect(f).connect(gain);
      s.start();
      nodes.push(s);
      return f;
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    if (name === "rain") {
      filtered("pink", "highpass", 600);
      filtered("white", "bandpass", 5200, 0.4);
    } else if (name === "wind") {
      const f = filtered("pink", "bandpass", 420, 1.4);
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.08;
      const depth = c.createGain();
      depth.gain.value = 260;
      lfo.connect(depth).connect(f.frequency);
      lfo.start();
      nodes.push(lfo);
    } else if (name === "fire") {
      filtered("brown", "lowpass", 420);
      timer = setInterval(() => {
        for (let i = 0; i < 3; i++) this.noise("white", rand(0.01, 0.04), rand(0.03, 0.09), { type: "bandpass", freq: rand(1500, 5000), q: 4 }, { delay: rand(0, 0.25), out: gain });
      }, 260);
    } else {
      [55, 110.4].forEach((f) => {
        const o = c.createOscillator();
        o.frequency.value = f;
        o.connect(gain);
        o.start();
        nodes.push(o);
      });
      filtered("white", "highpass", 7000);
    }
    return { gain, nodes, timer };
  }

  private source(kind: NoiseKind, loop = false) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.buffers[kind] ?? (this.buffers[kind] = this.noiseBuffer(c, kind));
    s.loop = loop;
    return s;
  }

  private tone(type: OscillatorType, freq: number, dur: number, peak: number, o: { to?: number; delay?: number; pan?: number; send?: number } = {}) {
    const c = this.ctx;
    if (!this.on || !c) return;
    const t = c.currentTime + (o.delay ?? 0);
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.015, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this.route(osc.connect(g), o.pan, o.send);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise(
    kind: NoiseKind,
    dur: number,
    peak: number,
    filter: { type: BiquadFilterType; freq: number; to?: number; q?: number },
    o: { delay?: number; pan?: number; send?: number; attack?: number; out?: AudioNode } = {},
  ) {
    const c = this.ctx;
    if (!this.on || !c) return;
    const t = c.currentTime + (o.delay ?? 0);
    const s = this.source(kind);
    const f = c.createBiquadFilter();
    f.type = filter.type;
    f.frequency.setValueAtTime(filter.freq, t);
    if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t + dur);
    if (filter.q) f.Q.value = filter.q;
    const g = c.createGain();
    const a = o.attack ?? Math.min(0.01, dur / 4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const node = s.connect(f).connect(g);
    if (o.out) node.connect(o.out);
    else this.route(node, o.pan, o.send);
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.05);
  }

  private route(node: AudioNode, pan?: number, send?: number) {
    const c = this.ctx!;
    let out: AudioNode = node;
    if (pan) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      out = node.connect(p);
    }
    out.connect(this.master!);
    if (send) {
      const s = c.createGain();
      s.gain.value = send;
      out.connect(s).connect(this.send!);
    }
  }

  private noiseBuffer(c: AudioContext, kind: NoiseKind) {
    const len = c.sampleRate * 4;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "white") d[i] = w;
      else if (kind === "pink") {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  private impulse(c: AudioContext, seconds: number) {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }
}

export const sfx = new Sfx();
