import { useSyncExternalStore } from 'react'
import { listMyOrders } from '../../shared/api'
import { subscribeToMyOrders } from '../../shared/live'
import type { Order } from '../../shared/types'
import { readCachedOrders, replaceCachedOrders } from './orderCache'
import { SAVED_NOTE_DELAY_MS } from './useLiveOrder'

export interface MyOrdersState {
  /** `null` until there is something to show: no saved copy and no answer yet. */
  orders: Order[] | null
  /** Shown from the saved copy and not yet confirmed by the server on this visit. */
  provisional: boolean
  /** The last refresh failed or is overdue, so statuses may be out of date. */
  stale: boolean
  /** The refresh failed and there was no saved copy to show. */
  failed: boolean
}

/**
 * One shared reader for this browser's orders, used by the wallet and the
 * Orders tab badge, so both show the same list and a push costs one fetch.
 * It runs while anything is subscribed and starts again from the saved copy
 * after everything unsubscribes.
 */
let snapshot: MyOrdersState | null = null
const listeners = new Set<() => void>()
let latestRequest = 0
let inFlight = false
let stop: (() => void) | null = null

function seeded(): MyOrdersState {
  const saved = readCachedOrders()
  return saved.length > 0
    ? { orders: saved, provisional: true, stale: false, failed: false }
    : { orders: null, provisional: false, stale: false, failed: false }
}

function getSnapshot(): MyOrdersState {
  snapshot ??= seeded()
  return snapshot
}

function set(next: MyOrdersState) {
  snapshot = next
  listeners.forEach((l) => l())
}

function show(orders: Order[]) {
  // The server's list is the whole truth, so orders it no longer returns leave the saved copy too.
  replaceCachedOrders(orders)
  set({ orders, provisional: false, stale: false, failed: false })
}

function markStale() {
  const current = getSnapshot()
  if (current.orders) {
    set({ ...current, stale: true })
    return
  }
  const saved = readCachedOrders()
  set(
    saved.length > 0
      ? { orders: saved, provisional: true, stale: true, failed: false }
      : { orders: null, provisional: false, stale: false, failed: true },
  )
}

/** Only the newest request may write state, so an older response cannot overwrite a newer list. */
function load(): Promise<boolean> {
  const request = ++latestRequest
  inFlight = true
  const current = () => stop !== null && request === latestRequest
  return listMyOrders()
    .then((orders) => {
      if (!current()) return true
      inFlight = false
      show(orders)
      return true
    })
    .catch(() => {
      if (current()) {
        inFlight = false
        markStale()
      }
      return false
    })
}

function start(): () => void {
  load()
  const overdue = setTimeout(() => {
    const current = getSnapshot()
    if (current.provisional && !current.stale) set({ ...current, stale: true })
  }, SAVED_NOTE_DELAY_MS)
  window.addEventListener('online', load)
  // A push is only a signal to re-read: the pushed row may be partial, and re-reading keeps one source of truth.
  const unsubscribe = subscribeToMyOrders(load)
  return () => {
    clearTimeout(overdue)
    window.removeEventListener('online', load)
    unsubscribe()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!stop) stop = start()
  // A screen opened later still gets a fresh read, unless one is already on its way.
  else if (!inFlight) load()
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0 || !stop) return
    stop()
    stop = null
    inFlight = false
    snapshot = null
  }
}

/** Asks again after a failure with nothing to show. */
export function retryMyOrders() {
  set({ ...getSnapshot(), failed: false })
  load()
}

/** Re-reads the list on request (the Refresh button, a pull); resolves whether it succeeded. */
export function refreshMyOrders(): Promise<boolean> {
  return load()
}

export function useMyOrders(): MyOrdersState {
  return useSyncExternalStore(subscribe, getSnapshot)
}
