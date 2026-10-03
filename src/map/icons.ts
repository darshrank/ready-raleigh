import type { PlacementKind } from '../shared/types'

export const KIND_COLOR: Record<PlacementKind, string> = { shelter: '#e8590c', bus: '#0ca678', road: '#1c7ed6' }

const glyph: Record<PlacementKind | 'optimal', string> = {
  // house with roof
  shelter: '<path d="M16 33 L32 18 L48 33 M21 30 V46 H43 V30" fill="none" stroke="white" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>',
  // bus
  bus: '<rect x="18" y="17" width="28" height="26" rx="5" fill="white"/><rect x="22" y="21" width="20" height="9" fill="#0b6"/><circle cx="24" cy="46" r="4" fill="white"/><circle cx="40" cy="46" r="4" fill="white"/>',
  // shield
  road: '<path d="M32 15 L46 21 V32 C46 41 39 47 32 50 C25 47 18 41 18 32 V21 Z" fill="white"/>',
  // star: the algorithm's plan
  optimal: '<path d="M32 14 L37 27 H51 L40 36 L44 50 L32 42 L20 50 L24 36 L13 27 H27 Z" fill="white"/>',
}
const fill: Record<PlacementKind | 'optimal', string> = { ...KIND_COLOR, optimal: '#ae3ec9' }
const ORDER = ['shelter', 'bus', 'road', 'optimal'] as const

/**
 * One pre-packed SVG atlas for all markers. (deck.gl's auto-packing with
 * per-object icon descriptors kept re-uploading the atlas, redrawing every frame.)
 */
export const ICON_ATLAS = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${64 * ORDER.length}" height="64">` +
    ORDER.map((k, i) => `<g transform="translate(${64 * i} 0)"><circle cx="32" cy="32" r="28" fill="${fill[k]}" stroke="white" stroke-width="4"/>${glyph[k]}</g>`).join('') +
    '</svg>',
)}`

export const ICON_MAPPING = Object.fromEntries(
  ORDER.map((k, i) => [k, { x: 64 * i, y: 0, width: 64, height: 64, anchorY: 32, mask: false }]),
) as Record<(typeof ORDER)[number], { x: number; y: number; width: number; height: number; anchorY: number; mask: boolean }>
