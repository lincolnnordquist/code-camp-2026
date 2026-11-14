import { useEffect, useRef, type RefObject } from 'react'
import { gestureBlocked } from './pullToRefresh'

/** A swipe must start this close to the left edge, as on iOS. */
export const EDGE_ZONE_PX = 20
/** Letting go past this share of the screen width goes Back. */
export const COMPLETE_FRACTION = 0.35
/** A flick this fast (px per ms, rightward) goes Back from a shorter drag. */
export const FLICK_VELOCITY = 0.5
/** The shortest drag a flick counts from, so a tap that slips is not a Back. */
export const MIN_FLICK_PX = 24
/** Movement before the gesture commits to horizontal or gives way to a scroll. */
const DIRECTION_SLOP_PX = 8
/** Only the last stretch of the drag sets the release speed. */
const VELOCITY_WINDOW_MS = 100
const SNAP_MS = 220

export function startsSwipeBack(x: number): boolean {
  return x >= 0 && x <= EDGE_ZONE_PX
}

export function swipeBackOutcome(dx: number, width: number, velocity: number): 'back' | 'cancel' {
  if (dx <= 0 || width <= 0) return 'cancel'
  if (dx >= width * COMPLETE_FRACTION) return 'back'
  if (velocity >= FLICK_VELOCITY && dx >= MIN_FLICK_PX) return 'back'
  return 'cancel'
}

/**
 * Home-screen mode only: iOS drops Safari's own swipe-back there, and in a
 * browser tab that native swipe already exists, so a second one would fight it.
 */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Edge swipe-back. A touch starting within EDGE_ZONE_PX of the left edge on a
 * screen with a Back slides the screen with the finger; letting go past
 * COMPLETE_FRACTION of the width or with a flick calls goBack, anything less
 * snaps back. Reduced motion skips the slide and only navigates.
 */
export function useSwipeBack(mainRef: RefObject<HTMLElement | null>, canGoBack: boolean, goBack: () => void) {
  const latest = useRef({ canGoBack, goBack })
  useEffect(() => {
    latest.current = { canGoBack, goBack }
  })

  useEffect(() => {
    type Drag = { startX: number; startY: number; dx: number; horizontal: boolean; samples: { x: number; t: number }[] }
    let drag: Drag | null = null
    const root = document.documentElement

    const place = (x: number, ms = 0) => {
      const main = mainRef.current
      if (!main) return
      main.style.transition = ms ? `transform ${ms}ms var(--ease-ios)` : 'none'
      main.style.transform = x ? `translate3d(${x}px, 0, 0)` : ''
    }
    const release = () => {
      root.classList.remove('is-swiping-back')
      const main = mainRef.current
      if (main) main.style.transition = ''
    }

    const onStart = (e: TouchEvent) => {
      drag = null
      // Not while the content is stretched by a pull or held for a refresh.
      if (!latest.current.canGoBack || e.touches.length !== 1 || !isStandalone()) return
      if (document.documentElement.hasAttribute('data-pull')) return
      const touch = e.touches[0]
      if (!startsSwipeBack(touch.clientX) || gestureBlocked(e.target, 'data-no-swipe-back')) return
      drag = { startX: touch.clientX, startY: touch.clientY, dx: 0, horizontal: false, samples: [{ x: touch.clientX, t: e.timeStamp }] }
    }
    const onMove = (e: TouchEvent) => {
      if (!drag) return
      const touch = e.touches[0]
      const dx = touch.clientX - drag.startX
      const dy = touch.clientY - drag.startY
      if (!drag.horizontal) {
        if (Math.abs(dx) < DIRECTION_SLOP_PX && Math.abs(dy) < DIRECTION_SLOP_PX) return
        if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
          drag = null
          return
        }
        drag.horizontal = true
        if (!prefersReducedMotion()) root.classList.add('is-swiping-back')
      }
      if (e.cancelable) e.preventDefault()
      drag.dx = Math.max(0, dx)
      drag.samples.push({ x: touch.clientX, t: e.timeStamp })
      while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > VELOCITY_WINDOW_MS) drag.samples.shift()
      if (!prefersReducedMotion()) place(drag.dx)
    }
    const onEnd = (e: TouchEvent) => {
      const ended = drag
      drag = null
      if (!ended?.horizontal) return
      const first = ended.samples[0]
      const last = ended.samples[ended.samples.length - 1]
      // A finger that stopped before lifting is a drag, not a flick.
      const held = e.timeStamp - last.t > VELOCITY_WINDOW_MS
      const velocity = !held && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0
      const width = window.innerWidth
      if (swipeBackOutcome(ended.dx, width, velocity) === 'cancel') {
        place(0, SNAP_MS)
        window.setTimeout(release, SNAP_MS)
        return
      }
      if (prefersReducedMotion()) {
        release()
        latest.current.goBack()
        return
      }
      // Finish the slide at the flick's speed (bounded), then go Back with the screen already off.
      const remaining = width - ended.dx
      const ms = Math.round(Math.min(SNAP_MS, Math.max(120, velocity > 0 ? remaining / velocity : SNAP_MS)))
      place(width, ms)
      window.setTimeout(() => {
        release()
        latest.current.goBack()
      }, ms)
    }
    const onCancel = () => {
      if (!drag?.horizontal) {
        drag = null
        return
      }
      drag = null
      place(0, SNAP_MS)
      window.setTimeout(release, SNAP_MS)
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onCancel)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onCancel)
    }
  }, [mainRef])
}
