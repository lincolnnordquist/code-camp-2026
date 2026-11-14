/**
 * Plan geometry for the floor map, kept free of the DOM so it can be tested on its own.
 * A plan point is a fraction (0 to 1) of the drawn canvas; sizes and offsets are CSS px.
 */
import type { FloorLayout } from './catalogExtras'

/**
 * Plan units added left of the layout for the row numbers, which do not fit
 * between the wall and the first column. Every position below includes this gutter.
 */
export const ROW_LABEL_GUTTER = 50
// The row numbers take a gutter on the left; an equal margin on the right keeps the hall centred in
// the card, in the overview and around the middle that button zoom holds.
export const drawnWidth = (layout: FloorLayout) => layout.width + 2 * ROW_LABEL_GUTTER

/** The drawn plan's aspect ratio, for the map and for a placeholder holding its place. */
export const drawnAspectRatio = (layout: FloorLayout) => `${drawnWidth(layout)} / ${layout.height}`

/** A plate's box in percent of the drawn plan, so plates scale with the plan. */
export interface MapPosition {
  x: number
  y: number
  width: number
  height: number
}

export interface PlanPoint {
  planX: number
  planY: number
}

export interface Size {
  width: number
  height: number
}

export interface ScrollOffset {
  left: number
  top: number
}

/** The scroll offset that puts a plan point under a point of the scroller's viewport. */
export function scrollToPin(point: PlanPoint, content: Size, viewX: number, viewY: number): ScrollOffset {
  return { left: point.planX * content.width - viewX, top: point.planY * content.height - viewY }
}

/** The middle of a booth plate, from its position in percent of the drawn box. */
export function plateCentre(position: MapPosition): PlanPoint {
  return { planX: (position.x + position.width / 2) / 100, planY: (position.y + position.height / 2) / 100 }
}

/** "Centre on booth" zooms to at least this; a map already closer stays at its zoom. */
export const CENTRE_SCALE = 2

/**
 * Where "Centre on booth" goes: the scale, the plate's middle, and the scroll offset that puts that
 * middle in the middle of the viewport (the browser then holds it inside the scroll range).
 * `fit` is the canvas size at 1x.
 */
export function centreOnPlate(position: MapPosition, currentScale: number, fit: Size, view: Size) {
  const scale = Math.max(currentScale, CENTRE_SCALE)
  const point = plateCentre(position)
  const content = { width: fit.width * scale, height: fit.height * scale }
  return { scale, point, scroll: scrollToPin(point, content, view.width / 2, view.height / 2) }
}

/** The plan point at the middle of the scroller's viewport. */
export function viewCentre(scroll: ScrollOffset, view: Size, content: Size): PlanPoint {
  return {
    planX: (scroll.left + view.width / 2) / content.width,
    planY: (scroll.top + view.height / 2) / content.height,
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * The part of the canvas on screen, as fractions of it, for the overview's rectangle.
 * Clamped to the plan, so the end margin that keeps tables clear of the zoom buttons is not drawn.
 */
export function visibleFraction(scroll: ScrollOffset, view: Size, content: Size) {
  if (content.width <= 0 || content.height <= 0) return { x: 0, y: 0, width: 1, height: 1 }
  const x = clamp01(scroll.left / content.width)
  const y = clamp01(scroll.top / content.height)
  return {
    x,
    y,
    width: clamp01((scroll.left + view.width) / content.width) - x,
    height: clamp01((scroll.top + view.height) / content.height) - y,
  }
}

/** The scroll offset that centres the viewport on a plan point, held inside the scroll range. */
export function centredScroll(point: PlanPoint, content: Size, view: Size, max: ScrollOffset): ScrollOffset {
  const pinned = scrollToPin(point, content, view.width / 2, view.height / 2)
  return {
    left: Math.min(max.left, Math.max(0, pinned.left)),
    top: Math.min(max.top, Math.max(0, pinned.top)),
  }
}
