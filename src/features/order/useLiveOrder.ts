import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeToMyOrders } from '../../shared/live'
import type { Order, OrderLookupRefusal, Result } from '../../shared/types'
import { cacheOrders, dropCachedOrder, readCachedOrder } from './orderCache'
import type { Refusal } from './orderStatus'

/**
 * A link opened on another device has no session that owns the order, so it
 * cannot use `subscribeToMyOrders` (NFR-02). It re-reads the order instead.
 */
export const LINK_POLL_MS = 15_000

/**
 * How long a saved copy may stand in quietly for a refresh. A normal refresh
 * lands well inside it, so a fast visit shows no note.
 */
export const SAVED_NOTE_DELAY_MS = 2_000

export type LoadState =
  | { status: 'loading' }
  | {
      status: 'ready'
      order: Order
      /** Shown from the saved copy and not yet confirmed by the server on this visit. */
      provisional: boolean
      /** The last refresh failed or is overdue, so the status may be out of date. */
      stale: boolean
    }
  | { status: 'error'; refusal: Refusal }

/**
 * `mine`: an order of this browser's session. Updates arrive through
 * `subscribeToMyOrders`, and a saved copy is shown offline (FR-26).
 * `link`: the emailed private link (FR-18). Polled, and never saved, because
 * it may be someone else's order on a shared device and the pickup code is
 * the handover credential.
 */
export type Source = 'mine' | 'link'

/**
 * Loads one order and keeps it current as the vendor or the server changes it (FR-17).
 * `linkPollMs` lets the private link re-read faster while it waits for a payment webhook.
 */
export function useLiveOrder(
  fetchOrder: (key: string) => Promise<Result<Order, OrderLookupRefusal>>,
  key: string,
  source: Source,
  linkPollMs = LINK_POLL_MS,
) {
  // State is tagged with the key it belongs to, so a new key reads as loading
  // without resetting state inside the effect.
  // An order of this browser opens from its saved copy at once and refreshes
  // quietly, so the page does not flash a loading state on every visit.
  const initialFor = useCallback(
    (k: string): LoadState => {
      const saved = source === 'mine' ? readCachedOrder(k) : null
      return saved ? { status: 'ready', order: saved, provisional: true, stale: false } : { status: 'loading' }
    },
    [source],
  )
  const [tagged, setTagged] = useState<{ key: string; state: LoadState }>(() => ({ key, state: initialFor(key) }))
  const state: LoadState = tagged.key === key ? tagged.state : initialFor(key)
  const setState = useCallback(
    (next: LoadState | ((prev: LoadState) => LoadState)) =>
      setTagged((t) => {
        const prev: LoadState = t.key === key ? t.state : initialFor(key)
        return { key, state: typeof next === 'function' ? next(prev) : next }
      }),
    [key, initialFor],
  )
  // Only the newest read or write may set state, so a slow older response can
  // never overwrite a newer status.
  const latestRequest = useRef(0)
  /** The current effect's reader, so a pull-to-refresh re-reads through the same ordering guard. */
  const loadRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))

  /** Shows an order the server just returned from an action, and outranks any read still in flight. */
  const replace = useCallback(
    (order: Order) => {
      latestRequest.current++
      if (source === 'mine') cacheOrders([order])
      setState({ status: 'ready', order, provisional: false, stale: false })
    },
    [source, setState],
  )

  useEffect(() => {
    let active = true

    const markStale = () =>
      setState((s) => {
        if (s.status === 'ready') return { ...s, stale: true }
        const cached = source === 'mine' ? readCachedOrder(key) : null
        return cached
          ? { status: 'ready', order: cached, provisional: true, stale: true }
          : { status: 'error', refusal: { reason: 'network' } }
      })

    const load = () => {
      const request = ++latestRequest.current
      const current = () => active && request === latestRequest.current
      return fetchOrder(key)
        .then((r) => {
          if (!current()) return r.ok
          if (r.ok) {
            if (source === 'mine') cacheOrders([r.value])
            setState({ status: 'ready', order: r.value, provisional: false, stale: false })
          } else {
            if (source === 'mine' && r.reason === 'order_not_found') dropCachedOrder(key)
            setState({ status: 'error', refusal: { reason: r.reason } })
          }
          return r.ok
        })
        .catch(() => {
          if (current()) markStale()
          return false
        })
    }
    loadRef.current = load

    load()
    // A saved copy that the first refresh has not confirmed in time gets the "saved" note.
    const overdue = setTimeout(
      () => active && setState((s) => (s.status === 'ready' && s.provisional ? { ...s, stale: true } : s)),
      SAVED_NOTE_DELAY_MS,
    )
    window.addEventListener('online', load)
    // A pushed change is only a signal to re-read: the pushed row may be
    // partial, and re-reading keeps one ordered source of truth.
    const unsubscribe = source === 'mine' ? subscribeToMyOrders(load) : () => undefined
    const poll = source === 'link' ? setInterval(load, linkPollMs) : undefined
    return () => {
      active = false
      clearTimeout(overdue)
      window.removeEventListener('online', load)
      unsubscribe()
      clearInterval(poll)
    }
  }, [fetchOrder, key, source, setState, linkPollMs])

  /** Re-reads the order now; resolves whether the read succeeded. */
  const refresh = useCallback(() => loadRef.current(), [])

  return [state, replace, refresh] as const
}
