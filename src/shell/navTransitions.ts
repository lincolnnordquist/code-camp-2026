import { useCallback, useEffect, useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { chunkFor, waitForChunk } from './routeChunks'
import { hasBack, historyIndex, isAppRoute, isCartFlow, isTabRoot, parentOf } from './routes'

/** push slides the new screen in from the right, pop is its reverse, tab cross-fades. */
export type NavKind = 'push' | 'pop' | 'tab'

/** How long the screen Back returns to takes to settle after a completed swipe. */
const SWIPE_RETURN_MS = 280
/** A swipe's Back that has not produced a popstate by now is forgotten, so a later Back animates normally. */
const SWIPE_RETURN_WINDOW_MS = 1_000

export function kindFor(from: string, to: string, back: boolean): NavKind {
  // Between tab roots, or forward onto one, is a tab switch; Back to a tab root from a drilled screen is a pop.
  if (isTabRoot(to) && (isTabRoot(from) || !back)) return 'tab'
  return back ? 'pop' : 'push'
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const canAnimate = () => typeof document.startViewTransition === 'function' && !prefersReducedMotion()

let transitionToken = 0

/**
 * Runs a route change inside a view transition tagged with its direction
 * (html[data-nav]), or plainly where the browser has none or motion is reduced.
 * The update is flushed synchronously so the new screen is in the DOM, scrolled
 * and focused, before the browser captures it.
 */
export function transitionTo(kind: NavKind, update: () => void) {
  if (!canAnimate()) {
    update()
    return
  }
  const token = ++transitionToken
  const root = document.documentElement
  root.dataset.nav = kind
  const transition = document.startViewTransition(() => flushSync(update))
  // A transition skipped by a newer one (or by a duplicate view-transition-name) rejects `ready`; that is not an error here.
  transition.ready.catch(() => undefined)
  void transition.finished
    .catch(() => undefined)
    .finally(() => {
      if (token === transitionToken) delete root.dataset.nav
    })
}

let replayingPop = false

/** Hands a held-back popstate to the router, which reads the location itself rather than the event. */
function replayPop(state: unknown) {
  replayingPop = true
  try {
    window.dispatchEvent(new PopStateEvent('popstate', { state }))
  } finally {
    replayingPop = false
  }
}

let swipeReturnUntil = 0

/** The screen showing before a popstate, kept by useViewTransitions. */
const current = { path: window.location.pathname, idx: 0 }

/** The path of each in-app history entry this document has shown, by its position in the stack. */
const entryPaths = new Map<number, string>()

/** The path of the entry Back would return to, when this document has shown it. */
export function previousEntryPath(): string | undefined {
  return entryPaths.get(historyIndex() - 1)
}

/**
 * Back and Forward (the header Back, an edge swipe, the browser's own) arrive
 * as popstate. The shell holds the event back from the router until the old
 * screen is captured, then replays it inside the transition. This must run
 * before the router's own popstate listener: Chromium runs window listeners in
 * registration order whatever their phase, so it is installed from main.tsx
 * before the app renders.
 */
export function installPopTransitions() {
  current.idx = historyIndex()
  window.addEventListener(
    'popstate',
    (e: PopStateEvent) => {
      if (replayingPop) return
      const from = { ...current }
      const to = window.location.pathname
      if (Date.now() < swipeReturnUntil) {
        swipeReturnUntil = 0
        e.stopImmediatePropagation()
        flushSync(() => replayPop(e.state))
        settleSwipeReturn()
        return
      }
      if (!canAnimate()) return
      // A change on the same screen (a sheet's own history entry) is the screen's to animate.
      if (to === from.path) return
      const idx = (e.state as { idx?: unknown } | null)?.idx
      const back = typeof idx === 'number' && idx < from.idx
      e.stopImmediatePropagation()
      transitionTo(kindFor(from.path, to, back), () => replayPop(e.state))
    },
    true,
  )
}

/** The finger already slid the old screen away; the screen underneath settles in from the parallax offset. */
function settleSwipeReturn() {
  const main = document.querySelector('main')
  if (!main || prefersReducedMotion()) return
  main.style.transition = 'none'
  main.style.transform = 'translate3d(-30%, 0, 0)'
  main.style.opacity = '0.6'
  // Commit the start position before transitioning away from it.
  void main.offsetWidth
  main.style.transition = `transform ${SWIPE_RETURN_MS}ms var(--ease-ios), opacity ${SWIPE_RETURN_MS}ms ease`
  main.style.transform = ''
  main.style.opacity = ''
  window.setTimeout(() => {
    main.style.transition = ''
  }, SWIPE_RETURN_MS + 50)
}

/**
 * Back from the header button or an edge swipe: the previous in-app entry when
 * there is one, else one level up (parentOf). Returns false on a screen with
 * nowhere to go back to.
 */
export function useGoBack() {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  return useCallback(
    (via: 'button' | 'swipe' = 'button') => {
      const parent = parentOf(pathname, search)
      if (!hasBack(pathname, search)) return false
      // An order just placed sits on top of the cart it emptied; Back goes up to the wallet instead.
      const behindIsSpentCart = pathname.startsWith('/orders/') && isCartFlow(previousEntryPath() ?? '')
      if ((historyIndex() > 0 && !behindIsSpentCart) || !parent) {
        if (via === 'swipe') swipeReturnUntil = Date.now() + SWIPE_RETURN_WINDOW_MS
        navigate(-1)
        return true
      }
      if (via === 'swipe') {
        flushSync(() => navigate(parent))
        settleSwipeReturn()
      } else {
        transitionTo('pop', () => navigate(parent))
      }
      return true
    },
    [navigate, pathname, search],
  )
}

let replayingClick = false
/** A tap held while its screen's code downloads; further taps wait for it rather than queue up. */
let holdingClick = false

/** Hands a held-back link click to the page again, inside the transition, flagged so it is not taken over twice. */
function replayClick(anchor: HTMLAnchorElement) {
  replayingClick = true
  try {
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  } finally {
    replayingClick = false
  }
}

/** The in-app link an event came from (same origin, a path the router owns, this tab), or null. */
function appLinkOf(target: EventTarget | null): HTMLAnchorElement | null {
  const anchor = (target as Element | null)?.closest?.('a[href]')
  if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.hasAttribute('download')) return null
  const url = new URL(anchor.href)
  return url.origin === window.location.origin && isAppRoute(url.pathname) ? anchor : null
}

/**
 * Animates in-app navigation with the View Transitions API where the browser
 * has it. Declarative routing gets no help from the router here, so a click on
 * a link into the attendee router is held in the capture phase and replayed on
 * the same link inside the transition: the Link's own handler then navigates,
 * with its `state` and `replace`. Anything else (new tab, modifier keys, other
 * sites, paths the router does not own, same-page links) is left alone. Back
 * and Forward are animated by installPopTransitions.
 *
 * A link to a screen whose code has not arrived is held the same way, with the
 * old screen up, until the code is here or CHUNK_WAIT_MS passes: a quick
 * download then opens the screen directly instead of committing placeholders
 * React would keep up for at least 300 ms. Pressing or focusing a link starts
 * that download early.
 */
export function useViewTransitions() {
  const location = useLocation()

  useLayoutEffect(() => {
    current.path = location.pathname
    current.idx = historyIndex()
    entryPaths.set(current.idx, location.pathname)
  }, [location])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (replayingClick) return
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const anchor = appLinkOf(e.target)
      if (!anchor) return
      const url = new URL(anchor.href)
      // A same-screen change (a sheet) is the screen's to animate, and its code is already here.
      if (url.pathname === window.location.pathname) return
      const chunk = chunkFor(url.pathname)
      const pending = chunk && !chunk.loaded() ? chunk : null
      const animate = canAnimate()
      if (!pending && !animate) return
      e.preventDefault()
      e.stopPropagation()
      const go = () => {
        if (animate) transitionTo(kindFor(window.location.pathname, url.pathname, false), () => replayClick(anchor))
        else replayClick(anchor)
      }
      if (!pending) return go()
      if (holdingClick) return
      holdingClick = true
      void waitForChunk(pending).then(() => {
        holdingClick = false
        // A failed download opens the screen's own Try again; a link that left the page meanwhile
        // is followed as a plain navigation.
        if (anchor.isConnected) go()
        else window.location.assign(url.href)
      })
    }
    const warm = (e: Event) => {
      const anchor = appLinkOf(e.target)
      const chunk = anchor && chunkFor(new URL(anchor.href).pathname)
      if (chunk && !chunk.loaded()) void chunk.preload().catch(() => undefined)
    }
    document.addEventListener('click', onClick, true)
    document.addEventListener('pointerdown', warm, { capture: true, passive: true })
    document.addEventListener('focusin', warm)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('pointerdown', warm, true)
      document.removeEventListener('focusin', warm)
    }
  }, [])
}
