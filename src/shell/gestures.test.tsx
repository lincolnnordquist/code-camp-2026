// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { kindFor } from './navTransitions'
import {
  dampen,
  MIN_SPINNER_MS,
  PULL_ARM_FINGER_PX,
  PULL_REFRESH_DONE_EVENT,
  PULL_REFRESH_EVENT,
  PULL_THRESHOLD_PX,
  PULL_TIMEOUT_MS,
  pullReducer,
  REFRESH_HOLD_PX,
  STRETCH_LIMIT_PX,
  undampen,
  usePullToRefresh,
} from './pullToRefresh'
import { parentOf } from './routes'
import { COMPLETE_FRACTION, EDGE_ZONE_PX, FLICK_VELOCITY, MIN_FLICK_PX, startsSwipeBack, swipeBackOutcome } from './swipeBack'

describe('swipe-back thresholds', () => {
  const width = 393

  it('starts only from the left edge zone', () => {
    expect(startsSwipeBack(0)).toBe(true)
    expect(startsSwipeBack(EDGE_ZONE_PX)).toBe(true)
    expect(startsSwipeBack(EDGE_ZONE_PX + 1)).toBe(false)
    expect(startsSwipeBack(200)).toBe(false)
  })

  it('goes Back past the completion share of the width, and snaps back short of it', () => {
    expect(swipeBackOutcome(Math.ceil(width * COMPLETE_FRACTION), width, 0)).toBe('back')
    expect(swipeBackOutcome(Math.floor(width * COMPLETE_FRACTION) - 1, width, 0)).toBe('cancel')
  })

  it('goes Back on a fast flick from a short drag, but not on a slipped tap', () => {
    expect(swipeBackOutcome(60, width, FLICK_VELOCITY)).toBe('back')
    expect(swipeBackOutcome(60, width, FLICK_VELOCITY - 0.01)).toBe('cancel')
    expect(swipeBackOutcome(MIN_FLICK_PX - 1, width, 3)).toBe('cancel')
  })

  it('never goes Back on a leftward or empty drag', () => {
    expect(swipeBackOutcome(0, width, 5)).toBe('cancel')
    expect(swipeBackOutcome(-100, width, 5)).toBe('cancel')
    expect(swipeBackOutcome(300, 0, 5)).toBe('cancel')
  })
})

describe('navigation direction', () => {
  it('slides drilled screens and cross-fades tab switches', () => {
    expect(kindFor('/e/x', '/e/x/booth/b1', false)).toBe('push')
    expect(kindFor('/e/x/booth/b1', '/e/x', true)).toBe('pop')
    expect(kindFor('/e/x/booth/b1', '/e/x/map', false)).toBe('tab')
    expect(kindFor('/e/x/map', '/e/x', true)).toBe('tab')
    expect(kindFor('/orders/o1', '/orders', true)).toBe('pop')
    expect(kindFor('/orders', '/orders/o1', true)).toBe('pop')
  })

  it('has no Back on tab roots or the private order link', () => {
    expect(parentOf('/e/x')).toBeNull()
    expect(parentOf('/orders')).toBeNull()
    expect(parentOf('/o/token')).toBeNull()
    expect(parentOf('/e/x', '?q=tea')).toBe('/e/x')
    expect(parentOf('/e/x/booth/b1')).toBe('/e/x')
  })
})

describe('pull-to-refresh rubber band', () => {
  it('stretches monotonically with no hard stop, below the limit', () => {
    let previous = 0
    for (let raw = 1; raw <= 2_000; raw += 1) {
      const d = dampen(raw)
      expect(d).toBeGreaterThan(previous)
      expect(d).toBeLessThan(STRETCH_LIMIT_PX)
      previous = d
    }
    // Still moving with the finger far past the threshold.
    expect(dampen(400) - dampen(300)).toBeGreaterThan(10)
  })

  it('arms at about 90 px of finger travel and reaches about 150 px on a long pull', () => {
    expect(dampen(PULL_ARM_FINGER_PX)).toBeGreaterThanOrEqual(PULL_THRESHOLD_PX)
    expect(dampen(PULL_ARM_FINGER_PX - 1)).toBeLessThan(PULL_THRESHOLD_PX)
    expect(PULL_ARM_FINGER_PX).toBeGreaterThan(80)
    expect(PULL_ARM_FINGER_PX).toBeLessThan(100)
    expect(dampen(300)).toBeGreaterThanOrEqual(140)
    expect(dampen(300)).toBeLessThanOrEqual(160)
  })

  it('inverts, so a touch mid-spring picks up where the content is', () => {
    for (const d of [0, 10, REFRESH_HOLD_PX, 120, 200]) expect(dampen(undampen(d))).toBeCloseTo(d, 6)
  })
})

describe('pull-to-refresh state machine', () => {
  it('refreshes on release only at the threshold', () => {
    const pulling = pullReducer('idle', { type: 'start' })
    expect(pulling).toBe('pulling')
    expect(pullReducer(pulling, { type: 'release', stretch: PULL_THRESHOLD_PX - 0.1 })).toBe('idle')
    expect(pullReducer(pulling, { type: 'release', stretch: PULL_THRESHOLD_PX })).toBe('refreshing')
    expect(pullReducer(pulling, { type: 'cancel' })).toBe('idle')
  })

  it('keeps refreshing through new drags and settles only from refreshing', () => {
    expect(pullReducer('refreshing', { type: 'start' })).toBe('refreshing')
    expect(pullReducer('refreshing', { type: 'release', stretch: 200 })).toBe('refreshing')
    expect(pullReducer('refreshing', { type: 'cancel' })).toBe('refreshing')
    expect(pullReducer('refreshing', { type: 'settle' })).toBe('idle')
    expect(pullReducer('idle', { type: 'settle' })).toBe('idle')
  })
})

/** React commits of the probe, counted after each one. */
const commits = { count: 0 }
function PullProbe() {
  const content = useRef<HTMLDivElement>(null)
  const indicator = useRef<HTMLDivElement>(null)
  const { phase, announcement } = usePullToRefresh(content, indicator)
  useEffect(() => {
    commits.count += 1
  })
  return (
    <>
      <div ref={indicator} data-testid="indicator">
        <span>
          <span />
        </span>
      </div>
      <p data-testid="phase">{phase}</p>
      <p role="status">{announcement}</p>
      <div ref={content} data-testid="free">
        content
      </div>
      <div data-no-pull="" data-testid="blocked">
        map
      </div>
    </>
  )
}

const touch = (y: number, x = 100) => ({ touches: [{ clientX: x, clientY: y }] })

function pull(target: Element, distance: number) {
  fireEvent.touchStart(target, touch(100))
  fireEvent.touchMove(target, touch(110))
  fireEvent.touchMove(target, touch(100 + distance))
  act(() => {
    vi.advanceTimersByTime(20)
  })
  fireEvent.touchEnd(target, { touches: [] })
}

/** The content's stretch in px, from its inline transform (0 at rest). */
const offset = () => {
  const t = screen.getByTestId('free').style.transform
  return t ? Number(t.match(/translate3d\(0(?:px)?, ([\d.]+)px/)![1]) : 0
}

describe('pull-to-refresh gesture', () => {
  let pulls: number
  const claim = (e: Event) => {
    pulls += 1
    e.preventDefault()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    pulls = 0
    commits.count = 0
    window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true })
    window.addEventListener(PULL_REFRESH_EVENT, claim)
  })

  afterEach(() => {
    window.removeEventListener(PULL_REFRESH_EVENT, claim)
    cleanup()
    vi.useRealTimers()
  })

  it('stretches the content per frame without re-rendering per move', () => {
    render(<PullProbe />)
    const target = screen.getByTestId('free')
    const before = commits.count
    fireEvent.touchStart(target, touch(100))
    for (let y = 110; y <= 500; y += 10) {
      fireEvent.touchMove(target, touch(y))
      act(() => {
        vi.advanceTimersByTime(16)
      })
    }
    expect(offset()).toBeCloseTo(dampen(400), 2)
    // One render for the phase change into pulling; none for the 40 moves.
    expect(commits.count - before).toBe(1)
    expect(screen.getByTestId('indicator').hasAttribute('data-armed')).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('')
    fireEvent.touchEnd(target, { touches: [] })
  })

  it('dispatches the refresh once past the threshold, holds at the spinner, and springs back when the screen answers', () => {
    render(<PullProbe />)
    pull(screen.getByTestId('free'), PULL_ARM_FINGER_PX + 10)
    expect(pulls).toBe(1)
    expect(screen.getByTestId('phase').textContent).toBe('refreshing')
    expect(screen.getByRole('status').textContent).toBe('Refreshing')
    expect(offset()).toBe(REFRESH_HOLD_PX)

    // A second pull while refreshing joins the first and returns to the hold.
    pull(screen.getByTestId('free'), PULL_ARM_FINGER_PX + 10)
    expect(pulls).toBe(1)
    expect(offset()).toBe(REFRESH_HOLD_PX)

    act(() => {
      window.dispatchEvent(new Event(PULL_REFRESH_DONE_EVENT))
    })
    // A refresh answered at once still shows the spinner briefly.
    act(() => {
      vi.advanceTimersByTime(MIN_SPINNER_MS - 100)
    })
    expect(screen.getByTestId('phase').textContent).toBe('refreshing')
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByTestId('phase').textContent).toBe('idle')
    expect(screen.getByRole('status').textContent).toBe('Updated')
    expect(offset()).toBe(0)
  })

  it('springs back from below the threshold without refreshing', () => {
    render(<PullProbe />)
    pull(screen.getByTestId('free'), PULL_ARM_FINGER_PX - 5)
    expect(pulls).toBe(0)
    expect(screen.getByTestId('phase').textContent).toBe('idle')
    expect(offset()).toBe(0)
    expect(screen.getByTestId('free').style.transition).toContain('transform')
  })

  it('springs back after the timeout when the screen never answers', () => {
    render(<PullProbe />)
    pull(screen.getByTestId('free'), PULL_ARM_FINGER_PX + 10)
    act(() => {
      vi.advanceTimersByTime(PULL_TIMEOUT_MS - 100)
    })
    expect(screen.getByTestId('phase').textContent).toBe('refreshing')
    act(() => {
      vi.advanceTimersByTime(MIN_SPINNER_MS + 100)
    })
    expect(screen.getByTestId('phase').textContent).toBe('idle')
    expect(screen.getByRole('status').textContent).toBe('')
    expect(offset()).toBe(0)
  })

  it('retracts at once on a screen with nothing to refresh', () => {
    window.removeEventListener(PULL_REFRESH_EVENT, claim)
    render(<PullProbe />)
    pull(screen.getByTestId('free'), PULL_ARM_FINGER_PX + 10)
    expect(screen.getByTestId('phase').textContent).toBe('idle')
    expect(screen.getByRole('status').textContent).toBe('')
    expect(offset()).toBe(0)
  })

  it('leaves opted-out areas, open dialogs and a scrolled page alone', () => {
    render(<PullProbe />)
    pull(screen.getByTestId('blocked'), PULL_ARM_FINGER_PX + 10)
    expect(pulls).toBe(0)

    const dialog = document.createElement('div')
    dialog.setAttribute('aria-modal', 'true')
    document.body.append(dialog)
    pull(screen.getByTestId('free'), PULL_ARM_FINGER_PX + 10)
    dialog.remove()
    expect(pulls).toBe(0)

    window.scrollY = 40
    pull(screen.getByTestId('free'), PULL_ARM_FINGER_PX + 10)
    expect(pulls).toBe(0)
  })

  it('prevents native overscroll only while pulling', () => {
    render(<PullProbe />)
    const target = screen.getByTestId('free')
    fireEvent.touchStart(target, touch(100))
    // Upward: a scroll, never cancelled.
    expect(fireEvent.touchMove(target, touch(60))).toBe(true)
    fireEvent.touchEnd(target, { touches: [] })
    fireEvent.touchStart(target, touch(100))
    expect(fireEvent.touchMove(target, touch(130))).toBe(false)
    fireEvent.touchEnd(target, { touches: [] })
  })
})
