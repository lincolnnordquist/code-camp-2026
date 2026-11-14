import { describe, expect, it } from 'vitest'
import {
  CENTRE_SCALE,
  centredScroll,
  centreOnPlate,
  clampScroll,
  flickVelocity,
  pinchScale,
  planPointAt,
  plateCentre,
  scrollToPin,
  viewCentre,
  visibleFraction,
} from './mapGeometry'

// A 300 x 240 map at fit; a plate at 40% / 50% of the plan, 10% square, so its middle is 45% / 55%.
const FIT = { width: 300, height: 240 }
const VIEW = { width: 300, height: 240 }
const PLATE = { x: 40, y: 50, width: 10, height: 10 }

describe('centre on booth', () => {
  it('zooms a map at fit to 2x and scrolls the plate middle to the viewport middle', () => {
    const target = centreOnPlate(PLATE, 1, FIT, VIEW)
    expect(target.scale).toBe(CENTRE_SCALE)
    expect(target.point.planX).toBeCloseTo(0.45, 10)
    expect(target.point.planY).toBeCloseTo(0.55, 10)
    // At 2x the canvas is 600 x 480: 0.45 * 600 - 150 and 0.55 * 480 - 120.
    expect(target.scroll.left).toBeCloseTo(120, 10)
    expect(target.scroll.top).toBeCloseTo(144, 10)
  })

  it('keeps a closer zoom instead of zooming out, and centres at that zoom', () => {
    const target = centreOnPlate(PLATE, 3, FIT, VIEW)
    expect(target.scale).toBe(3)
    // At 3x the canvas is 900 x 720: 0.45 * 900 - 150 and 0.55 * 720 - 120.
    expect(target.scroll.left).toBeCloseTo(255, 10)
    expect(target.scroll.top).toBeCloseTo(276, 10)
  })

  it('pins a plan point under any viewport point, and reads it back from the middle', () => {
    const content = { width: 600, height: 480 }
    const scroll = scrollToPin(plateCentre(PLATE), content, VIEW.width / 2, VIEW.height / 2)
    const back = viewCentre(scroll, VIEW, content)
    expect(back.planX).toBeCloseTo(0.45, 10)
    expect(back.planY).toBeCloseTo(0.55, 10)
    expect(scrollToPin({ planX: 0.5, planY: 0.25 }, content, 10, 20)).toEqual({ left: 290, top: 100 })
  })
})

describe('overview rectangle', () => {
  it('maps the visible part of a zoomed canvas to fractions of the plan', () => {
    const f = visibleFraction({ left: 120, top: 144 }, VIEW, { width: 600, height: 480 })
    expect(f.x).toBeCloseTo(0.2, 10)
    expect(f.y).toBeCloseTo(0.3, 10)
    expect(f.width).toBeCloseTo(0.5, 10)
    expect(f.height).toBeCloseTo(0.5, 10)
  })

  it('covers the whole plan at fit', () => {
    expect(visibleFraction({ left: 0, top: 0 }, VIEW, FIT)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('stops at the plan edge when the end margin past the last table is on screen', () => {
    // Scrolled 450 px into a 600 px canvas with a 300 px viewport: 150 px of margin is showing.
    const f = visibleFraction({ left: 450, top: 0 }, VIEW, { width: 600, height: 480 })
    expect(f.x).toBeCloseTo(0.75, 10)
    expect(f.width).toBeCloseTo(0.25, 10)
    expect(f.x + f.width).toBeLessThanOrEqual(1)
  })

  it('draws the whole plan for a canvas that has no size yet', () => {
    expect(visibleFraction({ left: 0, top: 0 }, VIEW, { width: 0, height: 0 })).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('a tap recentres on that plan point, held inside the scroll range', () => {
    const content = { width: 600, height: 480 }
    const max = { left: 300, top: 240 }
    expect(centredScroll({ planX: 0.5, planY: 0.5 }, content, VIEW, max)).toEqual({ left: 150, top: 120 })
    expect(centredScroll({ planX: 0.05, planY: 0.05 }, content, VIEW, max)).toEqual({ left: 0, top: 0 })
    expect(centredScroll({ planX: 0.98, planY: 0.98 }, content, VIEW, max)).toEqual({ left: 300, top: 240 })
  })
})

/** What a button zoom does with no booth selected: the plan point at the viewport middle stays there. */
function buttonZoom(scroll: { left: number; top: number }, before: { width: number; height: number }, factor: number) {
  const point = viewCentre(scroll, VIEW, before)
  const after = { width: before.width * factor, height: before.height * factor }
  const max = { left: after.width - VIEW.width, top: after.height - VIEW.height }
  const next = centredScroll(point, after, VIEW, max)
  return { point, after, next, centreAfter: viewCentre(next, VIEW, after) }
}

describe('button zoom keeps the viewport middle', () => {
  it('+ from fit keeps the plan middle in the middle, not the top-left corner', () => {
    const { next, centreAfter } = buttonZoom({ left: 0, top: 0 }, FIT, 1.5)
    expect(next).toEqual({ left: 75, top: 60 })
    expect(centreAfter.planX).toBeCloseTo(0.5, 10)
    expect(centreAfter.planY).toBeCloseTo(0.5, 10)
  })

  it('+ from a zoomed, panned view keeps the same plan point in the middle', () => {
    const before = { width: 600, height: 480 }
    const { point, centreAfter } = buttonZoom({ left: 210, top: 100 }, before, 1.5)
    expect(point).toEqual({ planX: 0.6, planY: 0.4583333333333333 })
    expect(centreAfter.planX).toBeCloseTo(point.planX, 10)
    expect(centreAfter.planY).toBeCloseTo(point.planY, 10)
  })

  it('- from a zoomed, panned view keeps the same plan point in the middle', () => {
    const before = { width: 900, height: 720 }
    const { point, centreAfter } = buttonZoom({ left: 330, top: 260 }, before, 1 / 1.5)
    expect(centreAfter.planX).toBeCloseTo(point.planX, 10)
    expect(centreAfter.planY).toBeCloseTo(point.planY, 10)
  })

  it('- back to fit settles at the top-left scroll, since fit has no scroll range', () => {
    const { next } = buttonZoom({ left: 150, top: 120 }, { width: 600, height: 480 }, 0.5)
    expect(next).toEqual({ left: 0, top: 0 })
  })
})

/** Where a plan point is drawn in the viewport, for a scroll and a canvas size. */
const onScreen = (point: { planX: number; planY: number }, scroll: { left: number; top: number }, content: { width: number; height: number }) => ({
  x: point.planX * content.width - scroll.left,
  y: point.planY * content.height - scroll.top,
})
const atScale = (scale: number) => ({ width: FIT.width * scale, height: FIT.height * scale })

describe('pinch: zoom anchored at the fingers\' midpoint', () => {
  it('keeps the plan point under an off-centre midpoint under it at every scale', () => {
    const start = { left: 0, top: 0 }
    const mid = { x: 84, y: 70 }
    const anchor = planPointAt(start, atScale(1), mid.x, mid.y)
    for (const scale of [1.2, 1.7, 2.4, 3]) {
      const scroll = scrollToPin(anchor, atScale(scale), mid.x, mid.y)
      const drawn = onScreen(anchor, scroll, atScale(scale))
      expect(drawn.x).toBeCloseTo(mid.x, 10)
      expect(drawn.y).toBeCloseTo(mid.y, 10)
    }
  })

  it('follows the midpoint as the fingers move, so a pinch also pans', () => {
    const anchor = planPointAt({ left: 120, top: 90 }, atScale(2), 150, 100)
    const moved = { x: 171, y: 83 }
    const scroll = scrollToPin(anchor, atScale(2.5), moved.x, moved.y)
    const drawn = onScreen(anchor, scroll, atScale(2.5))
    expect(drawn.x).toBeCloseTo(moved.x, 10)
    expect(drawn.y).toBeCloseTo(moved.y, 10)
  })

  it('scales by how far apart the fingers are, held to 1x..3x', () => {
    expect(pinchScale(1, 60, 90, 1, 3)).toBeCloseTo(1.5, 10)
    expect(pinchScale(2, 100, 50, 1, 3)).toBe(1)
    expect(pinchScale(2, 50, 200, 1, 3)).toBe(3)
  })

  it('keeps the start scale when the fingers gave no distance to compare with', () => {
    expect(pinchScale(1.4, 0, 0, 1, 3)).toBe(1.4)
    expect(pinchScale(1.4, 0, 30, 1, 3)).toBe(1.4)
  })
})

describe('a finger lifting re-bases the gesture with no jump', () => {
  it('reading the point under the remaining finger and pinning it there leaves the scroll as it was', () => {
    const content = atScale(2.37)
    const scroll = { left: 213.4, top: 157.9 }
    const finger = { x: 41.2, y: 96.7 }
    const anchor = planPointAt(scroll, content, finger.x, finger.y)
    const pinned = scrollToPin(anchor, content, finger.x, finger.y)
    expect(pinned.left).toBeCloseTo(scroll.left, 10)
    expect(pinned.top).toBeCloseTo(scroll.top, 10)
  })

  it('then pans with that finger, one px of map per px of finger', () => {
    const content = atScale(2)
    const scroll = { left: 200, top: 150 }
    const anchor = planPointAt(scroll, content, 40, 90)
    const next = scrollToPin(anchor, content, 25, 81)
    expect(next.left).toBeCloseTo(215, 10)
    expect(next.top).toBeCloseTo(159, 10)
  })
})

describe('button zoom uses the same anchored zoom, at the middle of the visible map', () => {
  it('+ keeps the plan point at the viewport middle there, from fit and from a panned zoom', () => {
    for (const [scroll, from, to] of [
      [{ left: 0, top: 0 }, 1, 1.5],
      [{ left: 233, top: 141 }, 2, 3],
    ] as const) {
      const middle = { x: VIEW.width / 2, y: VIEW.height / 2 }
      const anchor = planPointAt(scroll, atScale(from), middle.x, middle.y)
      expect(anchor).toEqual(viewCentre(scroll, VIEW, atScale(from)))
      const next = scrollToPin(anchor, atScale(to), middle.x, middle.y)
      const drawn = onScreen(anchor, next, atScale(to))
      expect(drawn.x).toBeCloseTo(middle.x, 10)
      expect(drawn.y).toBeCloseTo(middle.y, 10)
    }
  })
})

describe('clamping to the scroll range', () => {
  it('leaves an offset inside the range alone', () => {
    expect(clampScroll({ left: 40, top: 12 }, { left: 300, top: 240 })).toEqual({ left: 40, top: 12 })
  })

  it('holds an offset past either end at that end, on each axis on its own', () => {
    expect(clampScroll({ left: -25, top: 260 }, { left: 300, top: 240 })).toEqual({ left: 0, top: 240 })
    expect(clampScroll({ left: 340, top: -1 }, { left: 300, top: 240 })).toEqual({ left: 300, top: 0 })
  })

  it('at fit there is no range, so every offset is the top-left', () => {
    expect(clampScroll({ left: 17, top: -9 }, { left: 0, top: 0 })).toEqual({ left: 0, top: 0 })
  })
})

describe('flick at the end of a pan', () => {
  it('is the finger velocity over the samples of the last window only', () => {
    // At 85 ms with an 80 ms window the sample at 0 ms is out: 60 px left and 10 up over 40 ms.
    const v = flickVelocity([{ t: 0, x: 300, y: 200 }, { t: 40, x: 260, y: 200 }, { t: 80, x: 200, y: 190 }], 85, 80, 0.05)
    expect(v?.x).toBeCloseTo(-1.5, 10)
    expect(v?.y).toBeCloseTo(-0.25, 10)
  })

  it('is none for a finger that rested before lifting, or moved too slowly', () => {
    expect(flickVelocity([{ t: 0, x: 300, y: 200 }, { t: 40, x: 260, y: 200 }], 400, 80, 0.05)).toBeNull()
    expect(flickVelocity([{ t: 0, x: 300, y: 200 }, { t: 80, x: 299, y: 200 }], 80, 80, 0.05)).toBeNull()
    expect(flickVelocity([{ t: 0, x: 300, y: 200 }], 0, 80, 0.05)).toBeNull()
  })
})
