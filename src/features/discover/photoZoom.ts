/** The photo viewer's zoom and pan arithmetic, kept apart from the gestures so it can be tested on its own. */

export const MIN_SCALE = 1
export const MAX_SCALE = 4
/** A double tap (or double click) zooms to this, around the point tapped. */
export const DOUBLE_TAP_SCALE = 2.5

/** Scale and pan of the current photo; the pan is in screen pixels from the stage's centre. */
export interface Zoom {
  s: number
  tx: number
  ty: number
}

export const NO_ZOOM: Zoom = { s: 1, tx: 0, ty: 0 }

/** The stage (the viewport the photo fits in) and the photo's drawn size at scale 1. */
export interface Frame {
  stageW: number
  stageH: number
  photoW: number
  photoH: number
}

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

/** Keeps the zoomed photo covering the stage where it can: no panning past its edges, none on an axis that still fits. */
export function clampPan(zoom: Zoom, frame: Frame): Zoom {
  const maxX = Math.max(0, (frame.photoW * zoom.s - frame.stageW) / 2)
  const maxY = Math.max(0, (frame.photoH * zoom.s - frame.stageH) / 2)
  return { s: zoom.s, tx: Math.min(maxX, Math.max(-maxX, zoom.tx)), ty: Math.min(maxY, Math.max(-maxY, zoom.ty)) }
}

type Point = { x: number; y: number }

/**
 * Scales to `nextScale` keeping the photo point that was under `point` (relative to the stage's
 * centre) under `to`: the same place for a wheel or a double tap, the fingers' new midpoint for a
 * pinch, so the photo follows the fingers. Then clamps the pan.
 */
export function zoomAround(zoom: Zoom, nextScale: number, point: Point, frame: Frame, to: Point = point): Zoom {
  const s = clampScale(nextScale)
  if (s === MIN_SCALE) return NO_ZOOM
  // The photo point under the pointer before, in unscaled photo coordinates.
  const cx = (point.x - zoom.tx) / zoom.s
  const cy = (point.y - zoom.ty) / zoom.s
  return clampPan({ s, tx: to.x - s * cx, ty: to.y - s * cy }, frame)
}

/** Double tap: in to DOUBLE_TAP_SCALE around the tap, or back out to the whole photo. */
export function toggleZoom(zoom: Zoom, point: Point, frame: Frame): Zoom {
  return zoom.s > MIN_SCALE ? NO_ZOOM : zoomAround(zoom, DOUBLE_TAP_SCALE, point, frame)
}

/** A sideways swipe moves to the next or previous photo past a fifth of the stage, or on a quick flick. */
export function swipeStep(dx: number, elapsedMs: number, stageW: number): -1 | 0 | 1 {
  const flick = Math.abs(dx) / Math.max(1, elapsedMs) > 0.5 && Math.abs(dx) > 24
  if (Math.abs(dx) < stageW / 5 && !flick) return 0
  return dx < 0 ? 1 : -1
}

/** A swipe down closes past this distance, or on a quick flick down. */
export function dismisses(dy: number, elapsedMs: number): boolean {
  return dy > 120 || (dy / Math.max(1, elapsedMs) > 0.6 && dy > 24)
}
