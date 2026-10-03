import type { IconKey as SpecIcon } from "@/config/game";

export type IconKey = SpecIcon | "hospital" | "fire";

const GLYPH: Record<IconKey, string> = {
  shelter: '<path d="M18 33 L32 21 L46 33 V45 H18 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><rect x="28" y="36" width="8" height="9" fill="currentColor"/>',
  cooling: '<path d="M32 17 V47 M19 24.5 L45 39.5 M19 39.5 L45 24.5" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M27 19 L32 23 L37 19 M27 45 L32 41 L37 45" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  busPickup: '<rect x="19" y="19" width="26" height="22" rx="4" fill="none" stroke="currentColor" stroke-width="4"/><line x1="19" y1="31" x2="45" y2="31" stroke="currentColor" stroke-width="3"/><circle cx="25" cy="44" r="3" fill="currentColor"/><circle cx="39" cy="44" r="3" fill="currentColor"/>',
  protectRoad: '<path d="M32 17 L45 22 V32 C45 40 39 45 32 48 C25 45 19 40 19 32 V22 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M26 32 L30.5 36.5 L39 28" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  rescueTeam: '<circle cx="32" cy="32" r="13" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="32" cy="32" r="5" fill="none" stroke="currentColor" stroke-width="3"/><line x1="32" y1="19" x2="32" y2="27" stroke="currentColor" stroke-width="4"/><line x1="32" y1="37" x2="32" y2="45" stroke="currentColor" stroke-width="4"/><line x1="19" y1="32" x2="27" y2="32" stroke="currentColor" stroke-width="4"/><line x1="37" y1="32" x2="45" y2="32" stroke="currentColor" stroke-width="4"/>',
  barrier: '<path d="M16 40 Q24 30 32 40 T48 40" fill="none" stroke="currentColor" stroke-width="3.5"/><rect x="18" y="22" width="28" height="9" rx="2" fill="currentColor"/>',
  pump: '<circle cx="28" cy="34" r="9" fill="none" stroke="currentColor" stroke-width="4"/><path d="M37 34 H46 V24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M43 18 Q46 22 46 24 Q46 26 43 26" fill="currentColor"/>',
  generator: '<path d="M35 15 L22 35 H31 L28 49 L42 28 H33 Z" fill="currentColor"/>',
  water: '<path d="M32 16 C38 25 43 31 43 37 C43 43 38 48 32 48 C26 48 21 43 21 37 C21 31 26 25 32 16 Z" fill="none" stroke="currentColor" stroke-width="4"/>',
  medical: '<rect x="27" y="18" width="10" height="28" rx="2" fill="currentColor"/><rect x="18" y="27" width="28" height="10" rx="2" fill="currentColor"/>',
  fireStaging: '<path d="M32 16 C36 24 42 27 42 36 C42 42 37 47 32 47 C27 47 22 42 22 36 C22 30 27 28 28 22 C30 26 31 28 32 29 Z" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M20 47 H44" stroke="currentColor" stroke-width="3.5"/>',
  retrofit: '<path d="M20 46 V26 L32 18 L44 26 V46 Z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/><path d="M20 26 L44 46 M44 26 L20 46" stroke="currentColor" stroke-width="2.5"/>',
  hospital: '<rect x="27" y="18" width="10" height="28" fill="currentColor"/><rect x="18" y="27" width="28" height="10" fill="currentColor"/>',
  fire: '<path d="M32 17 C36 25 42 28 42 37 C42 43 37 47 32 47 C27 47 22 43 22 37 C22 31 27 29 28 23 C30 27 31 29 32 30 Z" fill="currentColor"/>',
};

export const ICON_COLOR: Record<IconKey, string> = {
  shelter: "#34d399",
  cooling: "#67e8f9",
  busPickup: "#facc15",
  protectRoad: "#38bdf8",
  rescueTeam: "#f8fafc",
  barrier: "#2dd4bf",
  pump: "#60a5fa",
  generator: "#fde047",
  water: "#7dd3fc",
  medical: "#fb7185",
  fireStaging: "#fb923c",
  retrofit: "#fbbf24",
  hospital: "#f87171",
  fire: "#fb923c",
};

const cache = new Map<string, string>();

export function iconUrl(key: IconKey, color = ICON_COLOR[key], ring = true): string {
  const k = `${key}|${color}|${ring}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const body = GLYPH[key].replaceAll("currentColor", color);
  const bg = ring ? `<circle cx="32" cy="32" r="28" fill="#0b1324" fill-opacity="0.92" stroke="${color}" stroke-width="3.5"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${bg}${body}</svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(k, url);
  return url;
}

export function deckIcon(key: IconKey, color?: string, ring = true) {
  return { url: iconUrl(key, color, ring), width: 64, height: 64, id: `${key}-${color ?? ""}-${ring}`, anchorY: 32 };
}
