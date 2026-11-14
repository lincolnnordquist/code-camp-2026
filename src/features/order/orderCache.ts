import type { Order } from '../../shared/types'

/**
 * FR-26: the last loaded orders stay viewable offline, only what the order
 * pages already showed. The copy belongs to this browser, not to a user:
 * anyone using the same browser sees the saved orders, pickup codes
 * included, until the next refresh replaces them. Once accounts exist,
 * sign-out should remove `orders.cache`.
 */
export const ORDER_CACHE_KEY = 'orders.cache'

function readSaved(): Order[] {
  try {
    const raw = localStorage.getItem(ORDER_CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    // Older copies were a plain list, or a list stamped with an owner that was never set.
    if (Array.isArray(parsed)) return parsed as Order[]
    const orders = (parsed as { orders?: unknown } | null)?.orders
    return Array.isArray(orders) ? (orders as Order[]) : []
  } catch {
    return []
  }
}

function writeSaved(orders: Order[]) {
  try {
    localStorage.setItem(ORDER_CACHE_KEY, JSON.stringify({ orders }))
  } catch {
    // A full or blocked storage only costs the offline copy.
  }
}

export function readCachedOrders(): Order[] {
  return readSaved()
}

export function readCachedOrder(id: string): Order | null {
  return readSaved().find((o) => o.id === id) ?? null
}

/** The server's full list replaces the copy, so orders it no longer returns are dropped. */
export function replaceCachedOrders(orders: Order[]) {
  writeSaved(orders)
}

/**
 * Updates single orders in place. An order not yet saved goes first, where
 * `listMyOrders` puts the newest, so the wallet does not reorder on refresh.
 */
export function cacheOrders(orders: Order[]) {
  const current = readSaved()
  const updates = new Map(orders.map((o) => [o.id, o]))
  const kept = current.map((o) => updates.get(o.id) ?? o)
  const added = orders.filter((o) => !current.some((c) => c.id === o.id))
  writeSaved([...added, ...kept])
}

export function dropCachedOrder(id: string) {
  const current = readSaved()
  if (current.some((o) => o.id === id)) writeSaved(current.filter((o) => o.id !== id))
}
