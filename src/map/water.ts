import type { HandRaster } from '../engine/world'

/**
 * Paint flood water for a given level from the HAND raster: every pixel whose
 * height above drainage is below the water level is under water, with
 * depth = level - HAND. Permanent water (rivers, lakes) is always drawn.
 */
export function waterImage(h: HandRaster, level: number, opts: { alpha?: number } = {}): ImageData {
  const { width, height, code, water, step } = h
  const img = new ImageData(width, height)
  const px = img.data
  const lv = level / step
  const a = opts.alpha ?? 1
  for (let i = 0, n = width * height; i < n; i++) {
    const o = i * 4
    if (water[i]) {
      px[o] = 38
      px[o + 1] = 92
      px[o + 2] = 170
      px[o + 3] = 200 * a
      continue
    }
    const c = code[i]
    if (c === 255 || c >= lv) continue
    const depth = (lv - c) * step // metres
    const t = Math.min(1, depth / 3)
    px[o] = 70 - 40 * t
    px[o + 1] = 170 - 70 * t
    px[o + 2] = 235 - 25 * t
    px[o + 3] = (110 + 110 * t) * a
  }
  return img
}
