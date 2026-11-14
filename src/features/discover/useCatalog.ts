import { useCallback, useEffect, useRef, useState } from 'react'
import { lastEventCatalog, requestEventCatalog } from '../../shell/catalogRequest'
import { PULL_REFRESH_DONE_EVENT, PULL_REFRESH_EVENT } from '../../shell/pullToRefresh'
import type { EventCatalog } from '../../shared/types'

// Bump the version when the catalog's shape changes, so copies saved by an older build are ignored.
const CACHE_PREFIX = 'catalog.v4.'

/**
 * How long a saved copy may stand in quietly for a refresh, as on the order
 * pages. A normal refresh lands well inside it, so a fast visit shows no note.
 */
export const SAVED_NOTE_DELAY_MS = 2_000

/** A first visit with nothing saved stops waiting after this and offers "Try again" (a late answer still lands). */
export const FIRST_LOAD_TIMEOUT_MS = 10_000

/** `network` stands for a call that threw or never answered; the shared API throws on a network failure. */
export interface CatalogRefusal {
  reason: 'event_not_found' | 'network'
}

export type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; catalog: EventCatalog; fromCache: boolean }
  | { status: 'error'; refusal: CatalogRefusal }

/** A saved copy is only trusted if it still has the catalog's shape. */
function isCatalog(value: unknown): value is EventCatalog {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<EventCatalog>
  return typeof v.event === 'object' && v.event !== null && Array.isArray(v.booths) && Array.isArray(v.products)
}

function readCache(slug: string): EventCatalog | null {
  // This page life's last answer first: a return to the screen shows it even where storage is blocked.
  const held = lastEventCatalog(slug)
  if (held) return held
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + slug)
    if (!raw) return null
    const saved: unknown = JSON.parse(raw)
    return isCatalog(saved) ? saved : null
  } catch {
    return null
  }
}

/**
 * Loads the event catalog and keeps the last good copy so the catalog stays
 * readable offline (FR-26). Screens open from the saved copy at once and
 * refresh quietly; `fromCache` is only set when that refresh fails or runs
 * past SAVED_NOTE_DELAY_MS, so the "saved info" note never flashes on a
 * normal visit, and a hung network still shows it.
 */
export function useCatalog(slug: string) {
  const [state, setState] = useState<CatalogState>(() => {
    const cached = readCache(slug)
    return cached ? { status: 'ready', catalog: cached, fromCache: false } : { status: 'loading' }
  })

  // Only the newest request may write state, so a slow response for an event
  // the screen has since left cannot overwrite the current one.
  const latestRequest = useRef(0)
  // The bounds of the request in flight; a newer request or leaving the screen clears them.
  const clearBounds = useRef(() => {})

  // Not async on purpose: every state write happens in a timer or promise
  // callback, never synchronously in the effect that starts the load.
  const load = useCallback((fresh = true) => {
    const request = ++latestRequest.current
    clearBounds.current()
    const isLatest = () => request === latestRequest.current
    const overdue = setTimeout(() => {
      if (isLatest()) setState((prev) => (prev.status === 'ready' ? { ...prev, fromCache: true } : prev))
    }, SAVED_NOTE_DELAY_MS)
    const givenUp = setTimeout(() => {
      if (isLatest()) setState((prev) => (prev.status === 'loading' ? { status: 'error', refusal: { reason: 'network' } } : prev))
    }, FIRST_LOAD_TIMEOUT_MS)
    clearBounds.current = () => {
      clearTimeout(overdue)
      clearTimeout(givenUp)
    }
    return requestEventCatalog(slug, { fresh })
      .catch(() => null)
      .then((result) => {
        if (!isLatest()) return
        clearBounds.current()
        if (result?.ok) {
          const catalog = result.value
          try {
            localStorage.setItem(CACHE_PREFIX + slug, JSON.stringify(catalog))
          } catch {
            // A full or blocked storage only costs the offline copy.
          }
          setState({ status: 'ready', catalog, fromCache: false })
          return
        }
        setState((prev) =>
          prev.status === 'ready'
            ? { ...prev, fromCache: true }
            : { status: 'error', refusal: { reason: result ? result.reason : 'network' } },
        )
      })
  }, [slug])

  useEffect(() => {
    // The shell's pull-to-refresh: claim it, reload once, and answer when the reload settles.
    const onPull = (e: Event) => {
      e.preventDefault()
      void load().finally(() => window.dispatchEvent(new Event(PULL_REFRESH_DONE_EVENT)))
    }
    // Opening the screen shares a request already out (the header asks for the same catalog);
    // a reload the person asks for, or coming back online, asks the server again.
    void load(false)
    const reconnect = () => void load()
    window.addEventListener('online', reconnect)
    window.addEventListener(PULL_REFRESH_EVENT, onPull)
    return () => {
      window.removeEventListener('online', reconnect)
      window.removeEventListener(PULL_REFRESH_EVENT, onPull)
      clearBounds.current()
    }
  }, [load])

  return { state, reload: () => load() }
}
