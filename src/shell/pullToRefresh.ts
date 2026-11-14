import { useEffect, useRef, useState, type RefObject } from 'react'

/** Sent when the attendee pulls down at the top of a screen and lets go. A screen that refreshes calls preventDefault() to claim it. */
export const PULL_REFRESH_EVENT = 'app:pull-refresh'
/** Sent back by the screen once its refresh has settled. */
export const PULL_REFRESH_DONE_EVENT = 'app:pull-refresh-done'

/** Displayed stretch at which letting go refreshes. */
export const PULL_THRESHOLD_PX = 70
/**
 * The rubber band's limit: the stretch approaches it but never reaches it, so
 * the content keeps following the finger however far it goes.
 */
export const STRETCH_LIMIT_PX = 300
/** A screen that never answers stops the spinner after this. */
export const PULL_TIMEOUT_MS = 8_000
/** A refresh answered from cache still shows the spinner this long, so it reads as a refresh and not a flicker. */
export const MIN_SPINNER_MS = 500
/** Where the content rests while the refresh runs: room for the spinner. */
export const REFRESH_HOLD_PX = 56
/** The release animation, on --ease-ios. */
export const SPRING_MS = 300
const SPINNER_PX = 24
/** Movement before the gesture commits to a direction. */
const DIRECTION_SLOP_PX = 8

/**
 * Finger travel to displayed stretch: linear at first, then ever stiffer,
 * like UIScrollView's rubber band (raw * L / (raw + L)). Monotonic, with no
 * hard stop.
 */
export function dampen(raw: number): number {
  if (raw <= 0) return 0
  return (raw * STRETCH_LIMIT_PX) / (raw + STRETCH_LIMIT_PX)
}

/** The inverse, so a touch that lands mid-spring picks up from where the content is. */
export function undampen(stretch: number): number {
  if (stretch <= 0) return 0
  const d = Math.min(stretch, STRETCH_LIMIT_PX - 1)
  return (d * STRETCH_LIMIT_PX) / (STRETCH_LIMIT_PX - d)
}

/** Finger travel that arms the refresh. */
export const PULL_ARM_FINGER_PX = Math.ceil(undampen(PULL_THRESHOLD_PX))

export type PullPhase = 'idle' | 'pulling' | 'refreshing'
export type PullAction = { type: 'start' } | { type: 'release'; stretch: number } | { type: 'cancel' } | { type: 'settle' }

/** The gesture's phases. Per-frame movement is not state: only the phase changes are. */
export function pullReducer(phase: PullPhase, action: PullAction): PullPhase {
  switch (action.type) {
    case 'start':
      return phase === 'idle' ? 'pulling' : phase
    case 'release':
      if (phase !== 'pulling') return phase
      return action.stretch >= PULL_THRESHOLD_PX ? 'refreshing' : 'idle'
    case 'cancel':
      return phase === 'pulling' ? 'idle' : phase
    case 'settle':
      return phase === 'refreshing' ? 'idle' : phase
  }
}

/** Sheets, dialogs and the map scroller own their own drags; they opt out with these attributes. */
export function gestureBlocked(target: EventTarget | null, attribute: 'data-no-pull' | 'data-no-swipe-back'): boolean {
  if (document.querySelector('[aria-modal="true"], dialog[open]')) return true
  return target instanceof Element && target.closest(`[${attribute}]`) !== null
}

/** A drag inside a scrolled inner box scrolls that box, not the page. */
function insideScrolledBox(target: EventTarget | null): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) return true
  }
  return false
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The current vertical offset of an element, mid-transition included. */
function currentOffset(el: HTMLElement | null): number {
  if (!el) return 0
  const transform = getComputedStyle(el).transform
  if (!transform || transform === 'none') return 0
  const m = transform.match(/matrix(3d)?\(([^)]+)\)/)
  if (!m) return 0
  const values = m[2].split(',').map(Number)
  return (m[1] ? values[13] : values[5]) || 0
}

/**
 * The app-wide pull-to-refresh gesture, iOS style: the content under the
 * header stretches with the finger on a rubber band, the spinner turns with
 * the pull and settles when armed, and letting go springs to the spinner
 * (refreshing) or back to rest. Movement is written straight to the DOM once
 * per animation frame; React only hears the phase changes.
 *
 * Letting go armed dispatches PULL_REFRESH_EVENT once; the spinner holds until
 * the screen answers with PULL_REFRESH_DONE_EVENT (at least MIN_SPINNER_MS) or
 * PULL_TIMEOUT_MS passes. On a screen that does not claim the event it springs
 * back at once with nothing announced. Native overscroll is prevented only
 * while a pull is under way.
 */
export function usePullToRefresh(contentRef: RefObject<HTMLElement | null>, indicatorRef: RefObject<HTMLElement | null>) {
  const [phase, setPhase] = useState<PullPhase>('idle')
  const [announcement, setAnnouncement] = useState('')
  const live = useRef<PullPhase>('idle')

  useEffect(() => {
    const root = document.documentElement
    let drag: { startY: number; startX: number; base: number; engaged: boolean } | null = null
    let stretch = 0
    let armed = false
    let frame = 0
    let refreshStarted = 0
    let settleTimer = 0
    let timeoutTimer = 0
    let restTimer = 0

    const apply = (action: PullAction) => {
      const next = pullReducer(live.current, action)
      if (next !== live.current) {
        live.current = next
        setPhase(next)
      }
      return next
    }

    /** Writes the stretch to the content and the spinner; `ms` animates it there. */
    const paint = (d: number, ms = 0) => {
      const content = contentRef.current
      const indicator = indicatorRef.current
      const reduced = prefersReducedMotion()
      const transition = ms && !reduced ? `transform ${ms}ms var(--ease-ios), opacity ${ms}ms ease` : 'none'
      // Reduced motion: the content does not stretch while pulling; it only steps to the spinner's room.
      const contentY = reduced && live.current === 'pulling' ? 0 : d
      if (content) {
        content.style.transition = transition
        content.style.transform = contentY > 0 ? `translate3d(0, ${contentY}px, 0)` : ''
      }
      if (indicator) {
        const progress = Math.min(1, d / PULL_THRESHOLD_PX)
        const slot = indicator.firstElementChild as HTMLElement | null
        const spinner = slot?.firstElementChild as HTMLElement | null
        indicator.style.opacity = String(reduced ? (d > 0 ? 1 : 0) : progress)
        indicator.style.transition = transition
        if (slot) {
          slot.style.transition = transition
          slot.style.transform = `translate3d(0, ${Math.max(0, (reduced ? REFRESH_HOLD_PX : d) - SPINNER_PX) / 2}px, 0)`
        }
        if (spinner && !reduced) spinner.style.transform = `rotate(${Math.round(progress * 270)}deg)`
      }
      root.toggleAttribute('data-pull', d > 0)
      // Once the content is back at rest, drop the transform so it is not a containing block for fixed children.
      window.clearTimeout(restTimer)
      if (d === 0) {
        restTimer = window.setTimeout(() => {
          if (drag || live.current !== 'idle') return
          content?.style.removeProperty('transition')
          content?.style.removeProperty('will-change')
        }, ms + 50)
      }
    }

    const setArmed = (next: boolean) => {
      if (next === armed) return
      armed = next
      indicatorRef.current?.toggleAttribute('data-armed', next)
      if (next && live.current === 'pulling') navigator.vibrate?.(10)
    }

    const springTo = (d: number) => {
      cancelAnimationFrame(frame)
      stretch = d
      setArmed(d >= PULL_THRESHOLD_PX)
      paint(d, prefersReducedMotion() ? 0 : SPRING_MS)
    }

    const settle = (announce: string) => {
      window.clearTimeout(timeoutTimer)
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(
        () => {
          if (apply({ type: 'settle' }) !== 'idle') return
          setAnnouncement(announce)
          if (!drag) springTo(0)
        },
        Math.max(0, MIN_SPINNER_MS - (performance.now() - refreshStarted)),
      )
    }

    const onStart = (e: TouchEvent) => {
      drag = null
      if (e.touches.length !== 1) return
      if (window.scrollY > 0 || gestureBlocked(e.target, 'data-no-pull') || insideScrolledBox(e.target)) return
      // A touch landing mid-spring catches the content where it is.
      const at = currentOffset(contentRef.current)
      drag = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, base: undampen(at), engaged: false }
    }

    const onMove = (e: TouchEvent) => {
      if (!drag) return
      const touch = e.touches[0]
      const dx = touch.clientX - drag.startX
      const dy = touch.clientY - drag.startY
      if (!drag.engaged) {
        if (Math.abs(dx) < DIRECTION_SLOP_PX && Math.abs(dy) < DIRECTION_SLOP_PX) return
        // Up or sideways is a scroll or a swipe, unless the content is already stretched.
        if (drag.base === 0 && (dy <= 0 || Math.abs(dx) > dy)) {
          drag = null
          return
        }
        drag.engaged = true
        setAnnouncement('')
        apply({ type: 'start' })
        cancelAnimationFrame(frame)
        if (contentRef.current) contentRef.current.style.willChange = 'transform'
      }
      if (e.cancelable) e.preventDefault()
      stretch = dampen(Math.max(0, drag.base + dy))
      if (live.current === 'pulling') setArmed(stretch >= PULL_THRESHOLD_PX)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => paint(stretch))
    }

    const onEnd = () => {
      const ended = drag
      drag = null
      if (!ended?.engaged) return
      if (live.current === 'refreshing') {
        springTo(REFRESH_HOLD_PX)
        return
      }
      if (apply({ type: 'release', stretch }) !== 'refreshing') {
        springTo(0)
        return
      }
      refreshStarted = performance.now()
      const claimed = !window.dispatchEvent(new Event(PULL_REFRESH_EVENT, { cancelable: true }))
      if (!claimed) {
        apply({ type: 'settle' })
        springTo(0)
        return
      }
      springTo(REFRESH_HOLD_PX)
      setAnnouncement('Refreshing')
      timeoutTimer = window.setTimeout(() => settle(''), PULL_TIMEOUT_MS)
    }

    const onCancel = () => {
      const ended = drag
      drag = null
      if (!ended?.engaged) return
      apply({ type: 'cancel' })
      springTo(live.current === 'refreshing' ? REFRESH_HOLD_PX : 0)
    }

    const onDone = () => {
      if (live.current === 'refreshing') settle('Updated')
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onCancel)
    window.addEventListener(PULL_REFRESH_DONE_EVENT, onDone)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onCancel)
      window.removeEventListener(PULL_REFRESH_DONE_EVENT, onDone)
      cancelAnimationFrame(frame)
      window.clearTimeout(settleTimer)
      window.clearTimeout(timeoutTimer)
      window.clearTimeout(restTimer)
      root.removeAttribute('data-pull')
    }
  }, [contentRef, indicatorRef])

  return { phase, announcement }
}
