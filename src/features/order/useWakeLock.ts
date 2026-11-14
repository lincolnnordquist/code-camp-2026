import { useEffect } from 'react'

/**
 * Keeps the screen on while `active`, so the code does not dim away while
 * staff look for the order. The browser drops the lock whenever the page is
 * hidden, so it is asked for again each time the page becomes visible. Where
 * the Screen Wake Lock API is missing or refuses, the screen just follows the
 * device's own auto-lock.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    if (!('wakeLock' in navigator) || !navigator.wakeLock) return
    const wakeLock = navigator.wakeLock
    let sentinel: WakeLockSentinel | null = null
    let disposed = false

    const acquire = () => {
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return
      wakeLock
        .request('screen')
        .then((s) => {
          // Closed while the request was pending: give it straight back.
          if (disposed) void s.release().catch(() => undefined)
          else sentinel = s
        })
        .catch(() => undefined)
    }

    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', acquire)
      void sentinel?.release().catch(() => undefined)
      sentinel = null
    }
  }, [active])
}
