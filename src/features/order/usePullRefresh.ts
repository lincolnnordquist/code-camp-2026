import { useEffect, useRef } from 'react'

/** Sent by the shell when the attendee pulls down at the top of any screen. Cancelable: a screen that refreshes claims it. */
export const PULL_REFRESH_EVENT = 'app:pull-refresh'
/** Sent back once the screen's refresh has settled, so the shell can stop its spinner. */
export const PULL_REFRESH_DONE_EVENT = 'app:pull-refresh-done'

/**
 * Runs this screen's `refresh` when the shell's pull-to-refresh fires. The
 * gesture lives once in the shell; features only say what refreshing means.
 * The screen claims each pull (preventDefault), so the shell holds its spinner
 * until the answer. A pull that arrives while a refresh is already running
 * joins it instead of starting a second request, and is answered when that
 * one settles.
 */
export function usePullRefresh(refresh: () => Promise<unknown>) {
  const latest = useRef(refresh)
  const inFlight = useRef<Promise<unknown> | null>(null)

  useEffect(() => {
    latest.current = refresh
  })

  useEffect(() => {
    const done = () => window.dispatchEvent(new Event(PULL_REFRESH_DONE_EVENT))
    const onPull = (e: Event) => {
      // Claiming the pull keeps the shell's spinner up until this screen answers.
      e.preventDefault()
      inFlight.current ??= latest.current()
        .catch(() => undefined)
        .finally(() => {
          inFlight.current = null
        })
      void inFlight.current.then(done)
    }
    window.addEventListener(PULL_REFRESH_EVENT, onPull)
    return () => window.removeEventListener(PULL_REFRESH_EVENT, onPull)
  }, [])
}
