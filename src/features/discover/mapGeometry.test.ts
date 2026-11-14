import { describe, expect, it } from 'vitest'
import { CENTRE_SCALE, centredScroll, centreOnPlate, plateCentre, scrollToPin, viewCentre, visibleFraction } from './mapGeometry'

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
