/**
 * FR-05 stock state (SPEC.md, commit 34b9a3a): nothing while more than LOW_STOCK_QTY are left,
 * "Only N left" at LOW_STOCK_QTY or fewer, and sold out at zero. Feature-local until the shared
 * label module (src/shared/ui/labels.ts) carries this wording.
 */
export const LOW_STOCK_QTY = 5

export type StockState = { tone: 'warning' | 'error'; label: string } | null

export function stockState(availableQty: number): StockState {
  if (availableQty <= 0) return { tone: 'error', label: 'Sold out' }
  if (availableQty <= LOW_STOCK_QTY) return { tone: 'warning', label: `Only ${availableQty} left` }
  return null
}

/** Sold-out products moved to the end; the rest keep their order. */
export function soldOutLast<T extends { availableQty: number }>(products: T[]): T[] {
  return [...products].sort((a, b) => Number(a.availableQty <= 0) - Number(b.availableQty <= 0))
}
