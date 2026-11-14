import type { Order } from '../../shared/types'

/** Ready orders first, then holds by the soonest end, then the rest newest first. */
function moreUrgent(a: Order, b: Order): number {
  const ready = Number(b.status === 'ready') - Number(a.status === 'ready')
  if (ready !== 0) return ready
  const aHold = a.holdEndsAt ? Date.parse(a.holdEndsAt) : null
  const bHold = b.holdEndsAt ? Date.parse(b.holdEndsAt) : null
  if (aHold !== null && bHold !== null && aHold !== bHold) return aHold - bHold
  if (aHold !== null && bHold === null) return -1
  if (aHold === null && bHold !== null) return 1
  return Date.parse(b.createdAt) - Date.parse(a.createdAt)
}

/** The stack's order, rear first and front last, with the most urgent order in front. */
export function urgencyStack(open: Order[]): string[] {
  return [...open].sort(moreUrgent).reverse().map((o) => o.id)
}

/**
 * The stack after the open orders change. The front stays where the attendee put it while that
 * order is still open; new orders join at the rear. When the front has gone, the stack is rebuilt
 * so the most urgent order comes forward.
 */
export function restack(previous: string[], open: Order[]): string[] {
  const ids = new Set(open.map((o) => o.id))
  const front = previous.at(-1)
  if (front === undefined || !ids.has(front)) return urgencyStack(open)
  const kept = previous.filter((id) => ids.has(id))
  const added = urgencyStack(open.filter((o) => !previous.includes(o.id)))
  return [...added, ...kept]
}

/** The tapped pass comes to the front, the old front goes to the rear, and the rest keep their order. */
export function bringToFront(stack: string[], id: string): string[] {
  const front = stack.at(-1)
  if (front === undefined || id === front || !stack.includes(id)) return stack
  return [front, ...stack.filter((x) => x !== id && x !== front), id]
}

export const PROGRESS_STEPS = ['Placed', 'Confirmed', 'Ready', 'Collected'] as const

/** How many progress steps an open order has reached. */
export function progressStep(status: Order['status']): number {
  return status === 'pending_payment' ? 1 : status === 'confirmed' ? 2 : status === 'ready' ? 3 : 4
}

/** Items of collected orders, one per product, newest order first. */
export function haulItems(orders: Order[]): Array<{ order: Order; productId: string; name: string; unitPriceCents: number }> {
  const seen = new Set<string>()
  const items: Array<{ order: Order; productId: string; name: string; unitPriceCents: number }> = []
  const collected = orders
    .filter((o) => o.status === 'collected')
    .sort((a, b) => Date.parse(b.collectedAt ?? b.createdAt) - Date.parse(a.collectedAt ?? a.createdAt))
  for (const order of collected) {
    for (const item of order.items) {
      if (seen.has(item.productId)) continue
      seen.add(item.productId)
      items.push({ order, productId: item.productId, name: item.name, unitPriceCents: item.unitPriceCents })
    }
  }
  return items
}
