// Lights for the 3D city: a warm low sun by day, a dim cool moon in the storm. One LightingEffect
// whose light objects are changed in place as the mood fades (deck.gl reads them at every draw,
// so this is uniforms only). Every color comes from the world tokens.
import { AmbientLight, DirectionalLight, LightingEffect } from '@deck.gl/core';
import { tint, type RGB, type Tokens } from '../tokens';

interface Mood {
  ambient: RGB;
  ambientI: number;
  key: RGB;
  keyI: number;
  /** Direction the light travels (east, north, up). */
  dir: [number, number, number];
}

/** Where a light comes from: azimuth clockwise from north and elevation, degrees -> travel direction. */
function from(azimuth: number, elevation: number): [number, number, number] {
  const a = (azimuth * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  return [-Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), -Math.sin(e)];
}

/** The sun: low in the south-west, late afternoon. Also casts the ground shadows (R2). */
export const SUN_FROM = { azimuth: 235, elevation: 30 };
const MOON_FROM = { azimuth: 140, elevation: 48 };

function moods({ rgb }: Tokens): [Mood, Mood] {
  const day: Mood = {
    ambient: tint(rgb.bond, rgb['sky-day'], 0.6),
    ambientI: 1.0,
    key: tint(rgb.bond, rgb['window-lit'], 0.45),
    keyI: 1.25,
    dir: from(SUN_FROM.azimuth, SUN_FROM.elevation),
  };
  const night: Mood = {
    ambient: tint(rgb['sky-night'], rgb.bond, 0.45),
    ambientI: 1.3,
    key: tint(rgb.bond, rgb['sky-night'], 0.35),
    keyI: 0.9,
    dir: from(MOON_FROM.azimuth, MOON_FROM.elevation),
  };
  return [day, night];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: readonly number[], b: readonly number[], t: number) =>
  [lerp(a[0]!, b[0]!, t), lerp(a[1]!, b[1]!, t), lerp(a[2]!, b[2]!, t)] as [number, number, number];

export class WorldLights {
  readonly effect: LightingEffect;
  private ambient: AmbientLight;
  private key: DirectionalLight;
  private day: Mood;
  private night: Mood;
  private last = -1;

  constructor(t: Tokens) {
    [this.day, this.night] = moods(t);
    this.ambient = new AmbientLight({ color: this.day.ambient, intensity: this.day.ambientI });
    this.key = new DirectionalLight({ color: this.day.key, intensity: this.day.keyI, direction: this.day.dir });
    this.effect = new LightingEffect({ ambient: this.ambient, key: this.key });
  }

  /** Blend day (0) to night (1). Returns whether anything changed (the map needs a repaint). */
  set(night: number): boolean {
    if (night === this.last) return false;
    this.last = night;
    const { day: d, night: n } = this;
    this.ambient.color = lerp3(d.ambient, n.ambient, night);
    this.ambient.intensity = lerp(d.ambientI, n.ambientI, night);
    this.key.color = lerp3(d.key, n.key, night);
    this.key.intensity = lerp(d.keyI, n.keyI, night);
    const dir = lerp3(d.dir, n.dir, night);
    const len = Math.hypot(...dir) || 1;
    this.key.direction = dir.map((v) => v / len) as [number, number, number];
    return true;
  }
}
