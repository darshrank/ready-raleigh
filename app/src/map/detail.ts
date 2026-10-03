// Semantic zoom (DESIGN.md "Map", "Detail by zoom"): real places appear as the player zooms in, so
// placing a shelter or a bus pickup feels like choosing a real place. The city view stays as clean
// as before: every layer here has a minzoom at or above 14.
//
// All of it is part of the basemap style, painted from the same palette as the streets, so the
// storm re-paints it with the night colors (basemap.ts applyPalette). Icons are signed distance
// fields drawn on a canvas (there is no sprite), so their color is a paint property too.
import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import type { Palette } from './basemap';

const REGULAR = ['Noto Sans Regular'];

/** Places show from this zoom; their names from PLACE_NAME_ZOOM. */
export const PLACE_ZOOM = 14;
export const PLACE_NAME_ZOOM = 15;

const is = (key: string, value: string): ExpressionSpecification => ['==', ['get', key], value];
const among = (key: string, values: string[]): ExpressionSpecification => ['match', ['get', key], values, true, false];

/**
 * Planning-relevant places from the tiles' `poi` layer (OpenMapTiles class / subclass): schools,
 * hospitals and clinics, places of worship, community centers, libraries, grocery stores, fire and
 * police stations. No restaurants or shops. `library/books` is a bookshop and `grocery` also holds
 * department stores and delis, so those match on subclass.
 */
export const PLACES_FILTER: ExpressionSpecification = [
  'any',
  among('class', ['school', 'college', 'place_of_worship', 'fire_station', 'police']),
  ['all', is('class', 'hospital'), among('subclass', ['hospital', 'clinic'])],
  ['all', is('class', 'town_hall'), is('subclass', 'community_centre')],
  ['all', is('class', 'library'), is('subclass', 'library')],
  ['all', is('class', 'grocery'), among('subclass', ['supermarket', 'greengrocer', 'marketplace'])],
];

// ---------------------------------------------------------------------------------------------
// Icons: a small ink badge with a pictogram knocked out of it, stored as a signed distance field.

/** Badge size in image px (pixelRatio 2, so 16 css px) and the distance field's reach. */
const ICON = 32;
const SDF_R = 8;

type Draw = (g: CanvasRenderingContext2D) => void;

const disc: Draw = (g) => {
  g.beginPath();
  g.arc(ICON / 2, ICON / 2, ICON / 2 - 0.5, 0, Math.PI * 2);
  g.fill();
};

/** Badge shape, then the pictogram cut out of it (`cut`), then any parts drawn back in (`keep`). */
const badge = (shape: Draw, cut: Draw, keep?: Draw): Draw => (g) => {
  shape(g);
  g.globalCompositeOperation = 'destination-out';
  cut(g);
  g.globalCompositeOperation = 'source-over';
  keep?.(g);
};

const path = (g: CanvasRenderingContext2D, pts: number[]) => {
  g.beginPath();
  g.moveTo(pts[0]!, pts[1]!);
  for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k]!, pts[k + 1]!);
  g.closePath();
  g.fill();
};

const star = (g: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
  const pts: number[] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    pts.push(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  path(g, pts);
};

/** Pictograms, drawn in a 32 px box. */
export const PLACE_ICONS: Record<string, Draw> = {
  // Mortarboard.
  'place-school': badge(disc, (g) => {
    path(g, [16, 7, 28, 13, 16, 19, 4, 13]);
    g.fillRect(10, 15, 12, 7);
  }),
  // Cross.
  'place-health': badge(disc, (g) => {
    g.fillRect(13, 6, 6, 20);
    g.fillRect(6, 13, 20, 6);
  }),
  // Chapel with a door.
  'place-worship': badge(
    disc,
    (g) => path(g, [16, 5, 24, 13, 24, 26, 8, 26, 8, 13]),
    (g) => g.fillRect(14, 19, 4, 7),
  ),
  // Two people.
  'place-community': badge(disc, (g) => {
    for (const x of [11, 21]) {
      g.beginPath();
      g.arc(x, 11, 3.6, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.roundRect(x - 5, 16, 10, 10, 4);
      g.fill();
    }
  }),
  // Open book.
  'place-library': badge(disc, (g) => {
    path(g, [5, 9, 15, 11.5, 15, 25, 5, 22.5]);
    path(g, [17, 11.5, 27, 9, 27, 22.5, 17, 25]);
  }),
  // Basket with a handle.
  'place-grocery': badge(disc, (g) => {
    path(g, [6, 14, 26, 14, 23, 25, 9, 25]);
    g.lineWidth = 2.6;
    g.beginPath();
    g.arc(16, 14, 6, Math.PI, 0);
    g.stroke();
  }),
  // Flame.
  'place-fire': badge(disc, (g) => {
    g.beginPath();
    g.moveTo(16, 5);
    g.bezierCurveTo(19, 10, 24, 13, 24, 19);
    g.arc(16, 19, 8, 0, Math.PI);
    g.bezierCurveTo(8, 14, 12, 12, 13, 9);
    g.quadraticCurveTo(15, 12, 16, 5);
    g.fill();
  }),
  // Star badge.
  'place-police': badge(disc, (g) => star(g, 16, 17, 11)),
};

const PLACE_ICON_BY_CLASS: ExpressionSpecification = [
  'match',
  ['get', 'class'],
  ['school', 'college'],
  'place-school',
  'hospital',
  'place-health',
  'place_of_worship',
  'place-worship',
  'town_hall',
  'place-community',
  'library',
  'place-library',
  'grocery',
  'place-grocery',
  'fire_station',
  'place-fire',
  'police',
  'place-police',
  'place-community',
];

/**
 * A signed distance field of `draw` (alpha = distance, 0.75 on the edge), the encoding MapLibre
 * expects for `sdf: true` images: tiny-sdf's, with a radius of SDF_R image px.
 */
function sdfImage(draw: Draw, size = ICON): ImageData {
  const W = size + 2 * SDF_R;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = W;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.translate(SDF_R, SDF_R);
  g.fillStyle = '#000';
  g.strokeStyle = '#000';
  draw(g);
  const src = g.getImageData(0, 0, W, W).data;
  const alpha = new Float32Array(W * W);
  for (let i = 0; i < W * W; i++) alpha[i] = src[i * 4 + 3]! / 255;
  const out = new ImageData(W, W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = alpha[i]!;
      const inside = a >= 0.5;
      let best = SDF_R * SDF_R;
      for (let dy = -SDF_R; dy <= SDF_R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= W) continue;
        for (let dx = -SDF_R; dx <= SDF_R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          if (alpha[yy * W + xx]! >= 0.5 === inside) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) best = d2;
        }
      }
      // Positive outside. An antialiased edge pixel's coverage says how far the edge is; elsewhere
      // the edge lies halfway to the nearest pixel on the other side.
      const signed = a > 0 && a < 1 ? 0.5 - a : (inside ? -1 : 1) * (Math.sqrt(best) - 0.5);
      const v = 255 - 255 * (signed / SDF_R + 0.25);
      out.data[i * 4] = 255;
      out.data[i * 4 + 1] = 255;
      out.data[i * 4 + 2] = 255;
      out.data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(v)));
    }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Layers.

/** Places (z14+, names z15+). Among the labels, below street and place names so those win. */
export function placeLayers(P: Palette): LayerSpecification[] {
  return [
    {
      id: 'places',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'poi',
      minzoom: PLACE_ZOOM,
      filter: PLACES_FILTER,
      layout: {
        'icon-image': PLACE_ICON_BY_CLASS,
        'icon-size': ['interpolate', ['linear'], ['zoom'], PLACE_ZOOM, 0.85, 17, 1.1],
        'icon-padding': 2,
        'text-field': ['step', ['zoom'], '', PLACE_NAME_ZOOM, ['coalesce', ['get', 'name:en'], ['get', 'name'], '']],
        'text-font': REGULAR,
        'text-size': 11,
        'text-max-width': 9,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.95,
        'text-justify': 'auto',
        'text-optional': true,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: {
        'icon-color': P.placeIcon,
        'icon-halo-color': P.halo,
        'icon-halo-width': 1.2,
        'text-color': P.placeLabel,
        'text-halo-color': P.halo,
        'text-halo-width': 1.5,
      },
    },
  ];
}

/**
 * Adds the detail icons to `map` (now, and again if the style ever asks for one it lacks). Returns
 * a cleanup.
 */
export function installDetail(map: MapLibreMap): () => void {
  const icons: Record<string, Draw> = { ...PLACE_ICONS };
  const add = (id: string) => {
    const draw = icons[id];
    if (draw && !map.hasImage(id)) map.addImage(id, sdfImage(draw), { sdf: true, pixelRatio: 2 });
  };
  const onMissing = (e: { id: string }) => add(e.id);
  map.on('styleimagemissing', onMissing);
  for (const id of Object.keys(icons)) add(id);
  return () => {
    map.off('styleimagemissing', onMissing);
  };
}
