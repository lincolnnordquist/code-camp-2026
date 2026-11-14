import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/** Back to a screen still loading waits this long for its content before settling where it can. */
export const RESTORE_WAIT_MS = 1_000
const STORAGE_KEY = 'shell.scroll'

function readSaved(): Map<string, number> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return new Map()
    return new Map(parsed.filter((e): e is [string, number] => Array.isArray(e) && typeof e[0] === 'string' && Number.isFinite(e[1])))
  } catch {
    return new Map()
  }
}

/**
 * Every document's first entry has the key "default", so on its own that key names a different
 * page after each full load (a Square return, an emailed link). It is kept per pathname instead.
 */
function keyOf(location: { key: string; pathname: string }) {
  return location.key === 'default' ? `default:${location.pathname}` : location.key
}

/** A reload of this same document, where the attendee expects to stay where they were. */
function isReload() {
  const entry = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
  return entry?.type === 'reload'
}

function maxScrollY() {
  return document.documentElement.scrollHeight - window.innerHeight
}

/**
 * Each history entry keeps its own scroll position, keyed by location.key, as
 * a native navigation stack does. Back and Forward return to it once the
 * screen is tall enough (or after RESTORE_WAIT_MS); a new screen starts at the
 * top. A push that only changes the query (search typing, a category, the
 * map's booth) and a replace keep the position: the screen owns those.
 *
 * Runs in a layout effect, so inside a view transition's update the new
 * screen is already scrolled when the browser captures it. The browser's own
 * restoration is switched off in main.tsx so the two do not fight.
 */
export function useScrollRestoration() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const positions = useRef<Map<string, number> | null>(null)
  positions.current ??= readSaved()
  const currentKey = useRef(keyOf(location))
  const previousPath = useRef<string | null>(null)

  useEffect(() => {
    const onScroll = () => positions.current?.set(currentKey.current, window.scrollY)
    // A reload or a return to the app from another site keeps the stack's positions for this tab.
    const save = () => {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...(positions.current ?? [])].slice(-50)))
      } catch {
        // Without storage the positions last until the tab reloads.
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', save)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', save)
    }
  }, [])

  const { key: locationKey, pathname } = location
  useLayoutEffect(() => {
    const fromPath = previousPath.current
    const fromKey = currentKey.current
    const key = keyOf({ key: locationKey, pathname })
    previousPath.current = pathname
    currentKey.current = key
    const saved = positions.current!

    // A fresh document load starts at the top; only a reload of the same page returns to its spot.
    if (fromPath === null && !isReload()) return

    if (navigationType === 'REPLACE') {
      saved.set(key, saved.get(fromKey) ?? window.scrollY)
      return
    }
    if (navigationType === 'PUSH') {
      if (fromPath === pathname) return
      window.scrollTo(0, 0)
      return
    }

    // POP: Back, Forward, or the first load of this entry.
    const target = saved.get(key)
    if (target === undefined) {
      if (fromPath !== null && fromPath !== pathname) window.scrollTo(0, 0)
      return
    }
    if (maxScrollY() >= target) {
      window.scrollTo(0, target)
      return
    }

    // The screen is still filling in (a load, a lazy image row): wait for the height, briefly.
    let frame = 0
    const started = performance.now()
    const stop = () => {
      cancelAnimationFrame(frame)
      for (const type of ['touchstart', 'wheel', 'keydown'] as const) window.removeEventListener(type, stop)
    }
    const attempt = () => {
      if (maxScrollY() >= target || performance.now() - started >= RESTORE_WAIT_MS) {
        stop()
        window.scrollTo(0, target)
        return
      }
      frame = requestAnimationFrame(attempt)
    }
    // The attendee scrolling or typing while it waits wins.
    for (const type of ['touchstart', 'wheel', 'keydown'] as const) window.addEventListener(type, stop, { passive: true })
    frame = requestAnimationFrame(attempt)
    return stop
  }, [locationKey, pathname, navigationType])
}
