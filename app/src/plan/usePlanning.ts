// Input for the planning phase: tap to place, drag a piece to move it, keyboard play.
//
// Pointer handling runs in the capture phase on the map container, before MapLibre and deck.gl
// see the event. A press on a placed piece is kept from the map (so it drags the piece, not the
// map); any other press passes through, so panning and zooming still work while a piece is armed.
import { useCallback, useEffect, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Placement } from '@shared/types';
import type { MapData } from '../data';
import { FLOOD_PIECES, type FloodPiece } from './pieces';
import { targetOf, usePlan } from './store';
import { anchorOf, cellCenter, nearestCell, stepCell, targetAt, type SnapKind } from './targets';

type Px = { x: number; y: number };

/** A press that travels further than this is a pan or a drag, not a tap. */
const TAP_SLOP_PX = 6;
const PIECE_HIT_PX = { mouse: 20, touch: 28 };

const MISSED: Record<FloodPiece, string> = {
  shelter: 'Tap closer to a building square to open a shelter there.',
  bus_pickup: 'Bus pickups go inside the study area. Tap a street near the people it serves.',
  road_protection: 'Tap one of the pink flood-prone roads to protect it.',
};

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function pieceAt(map: MapLibreMap, data: MapData, placements: Placement[], p: Px, radius: number): Placement | null {
  let best: Placement | null = null;
  let bestD = radius;
  // Later pieces draw on top, so they win ties.
  for (const q of placements) {
    const t = targetOf(q);
    const at = t && anchorOf(data, t);
    if (!at) continue;
    const s = map.project(at);
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d <= bestD) [best, bestD] = [q, d];
  }
  return best;
}

/** Moves keyboard focus to the map, so arrows and Enter play right after a tray button. */
export function focusMap(map: MapLibreMap | null) {
  map?.getCanvas().focus({ preventScroll: true });
}

export function usePlanning(data: MapData | null) {
  const dataRef = useRef(data);
  dataRef.current = data;
  const mapRef = useRef<MapLibreMap | null>(null);

  const onReady = useCallback((map: MapLibreMap) => {
    mapRef.current = map;
    const el = map.getContainer();
    // Touch drags on a piece must reach us as pointer moves, not as page or map gestures.
    el.style.touchAction = 'none';

    let gesture: { start: Px; pointerId: number; pieceId: string | null; moved: boolean; snap: SnapKind } | null = null;
    let suppressClick = false;
    let raf = 0;

    const local = (e: MouseEvent): Px => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const inside = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };

    const onPointerDown = (e: PointerEvent) => {
      suppressClick = false;
      const s = usePlan.getState();
      const d = dataRef.current;
      if (!d || s.phase !== 'planning' || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const snap: SnapKind = e.pointerType === 'mouse' ? 'mouse' : 'touch';
      const p = local(e);
      const piece = pieceAt(map, d, s.placements, p, PIECE_HIT_PX[snap]);
      gesture = { start: p, pointerId: e.pointerId, pieceId: piece?.id ?? null, moved: false, snap };
      if (piece) {
        e.stopPropagation();
        s.select(piece.id);
      }
    };

    // MapLibre and deck.gl listen to mouse and touch events too; keep a piece press from them.
    const onPressStart = (e: MouseEvent | TouchEvent) => {
      if (!gesture?.pieceId) return;
      e.stopPropagation();
      if (e.type === 'touchstart' && e.cancelable) e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      const s = usePlan.getState();
      const d = dataRef.current;
      if (!d) return;
      if (gesture && e.pointerId === gesture.pointerId) {
        const p = local(e);
        if (!gesture.moved && Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > TAP_SLOP_PX) gesture.moved = true;
        const piece = gesture.pieceId ? s.placements.find((q) => q.id === gesture!.pieceId) : undefined;
        if (piece && gesture.moved) {
          if (!s.dragging) s.setDragging(true);
          const t = targetAt(piece.type as FloodPiece, map, d, p, s.placements, gesture.snap, piece.id);
          s.setHover(t, piece.id);
        }
        return;
      }
      // Hover preview with a mouse while a piece is armed.
      if (e.pointerType !== 'mouse' || !s.armed || s.phase !== 'planning') return;
      if (!inside(e)) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const now = usePlan.getState();
        if (!now.armed) return;
        now.setHover(targetAt(now.armed, map, d, local(e), now.placements, 'mouse'));
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      const g = gesture;
      gesture = null;
      const s = usePlan.getState();
      const d = dataRef.current;
      if (!d) return;
      if (g.pieceId) {
        suppressClick = true;
        if (g.moved) {
          if (s.hover && s.movingId === g.pieceId) s.move(g.pieceId, s.hover);
          else s.setHover(null);
        }
        s.setDragging(false);
        return;
      }
      if (!g.moved && s.armed && e.type === 'pointerup' && inside(e)) {
        suppressClick = true;
        const t = targetAt(s.armed, map, d, local(e), s.placements, g.snap);
        if (t) s.place(t);
        else s.setNotice(MISSED[s.armed]);
      }
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      gesture = null;
      const s = usePlan.getState();
      if (s.dragging) {
        s.setDragging(false);
        s.setHover(null);
      }
    };

    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.stopPropagation();
    };

    const onLeave = () => {
      const s = usePlan.getState();
      if (!gesture && s.armed && s.cursor === null) s.setHover(null);
    };

    el.addEventListener('pointerdown', onPointerDown, true);
    el.addEventListener('mousedown', onPressStart, true);
    el.addEventListener('touchstart', onPressStart, { capture: true, passive: false });
    el.addEventListener('click', onClick, true);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      cancelAnimationFrame(raf);
      mapRef.current = null;
      el.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('mousedown', onPressStart, true);
      el.removeEventListener('touchstart', onPressStart, true);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, []);

  // Keyboard play (DESIGN.md): arrows move a cell cursor, Enter places, Delete removes.
  // 1 2 3 pick a piece, Esc cancels, + and - zoom.
  useEffect(() => {
    /** Aim the armed piece, or the selected piece, at the cursor cell. */
    const aimAtCursor = (cell: number) => {
      const s = usePlan.getState();
      const map = mapRef.current;
      const d = dataRef.current;
      if (!map || !d) return;
      const at = map.project(cellCenter(d, cell));
      if (s.armed) {
        s.setHover(targetAt(s.armed, map, d, at, s.placements, 'key'));
      } else if (s.selectedId) {
        const piece = s.placements.find((p) => p.id === s.selectedId);
        if (piece) s.setHover(targetAt(piece.type as FloodPiece, map, d, at, s.placements, 'key', piece.id), piece.id);
      }
    };

    const keepInView = (cell: number) => {
      const map = mapRef.current;
      const d = dataRef.current;
      if (!map || !d) return;
      const ll = cellCenter(d, cell);
      const p = map.project(ll);
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      const m = Math.min(80, w * 0.15, h * 0.15);
      if (p.x < m || p.x > w - m || p.y < m || p.y > h - m) map.easeTo({ center: ll, duration: reducedMotion() ? 0 : 250 });
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = usePlan.getState();
      const map = mapRef.current;
      const d = dataRef.current;
      if (!map || !d || s.phase !== 'planning') return;
      const onControl = !!target?.closest('button, a, [role="button"]');

      const k = FLOOD_PIECES.findIndex((_, i) => e.key === String(i + 1));
      if (k >= 0) {
        e.preventDefault();
        const piece = FLOOD_PIECES[k]!;
        s.arm(s.armed === piece ? null : piece);
        if (usePlan.getState().armed && s.cursor !== null) aimAtCursor(s.cursor);
        return;
      }

      const dir: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (dir[e.key]) {
        e.preventDefault();
        const [dx, dy] = dir[e.key]!;
        const c = map.getCenter();
        const cell = s.cursor === null ? nearestCell(d, [c.lng, c.lat]) : stepCell(map, d, s.cursor, dx, dy);
        s.setCursor(cell);
        keepInView(cell);
        aimAtCursor(cell);
        return;
      }

      switch (e.key) {
        case 'Enter': {
          if (onControl) return;
          e.preventDefault();
          if (s.armed) {
            if (s.hover) s.place(s.hover);
            else s.setNotice(s.cursor === null ? 'Use the arrow keys to pick a spot, then press Enter.' : MISSED[s.armed]);
          } else if (s.selectedId && s.hover && s.movingId === s.selectedId) {
            s.move(s.selectedId, s.hover);
          }
          return;
        }
        case 'Delete':
        case 'Backspace':
          if (s.selectedId) {
            e.preventDefault();
            s.remove(s.selectedId);
          }
          return;
        case 'Escape':
          if (s.armed) s.arm(null);
          else if (s.selectedId) s.select(null);
          else if (s.cursor !== null) s.setCursor(null);
          return;
        case '+':
        case '=':
          map.zoomIn({ duration: reducedMotion() ? 0 : 250 });
          return;
        case '-':
        case '_':
          map.zoomOut({ duration: reducedMotion() ? 0 : 250 });
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Select a piece from the plan list; from the keyboard, the cursor jumps to it. */
  const selectFromList = useCallback((id: string, byKeyboard: boolean) => {
    const s = usePlan.getState();
    const d = dataRef.current;
    const map = mapRef.current;
    s.select(id);
    const piece = s.placements.find((p) => p.id === id);
    const t = piece && targetOf(piece);
    const at = d && t ? anchorOf(d, t) : null;
    if (!at || !map || !d) return;
    if (byKeyboard) {
      s.setCursor(nearestCell(d, at));
      focusMap(map);
    }
    const p = map.project(at);
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    if (p.x < 40 || p.x > w - 40 || p.y < 40 || p.y > h - 40) map.easeTo({ center: at, duration: reducedMotion() ? 0 : 300 });
  }, []);

  return { onReady, mapRef, selectFromList };
}
