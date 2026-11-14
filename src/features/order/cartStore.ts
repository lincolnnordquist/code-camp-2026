import { useSyncExternalStore } from 'react'
import type { Booth, Product } from '../../shared/types'

const CART_KEY = 'cart'

export interface CartItem {
  productId: string
  name: string
  priceCents: number
  qty: number
  /** The lower of the per-order maximum and the stock when the item was added. */
  maxQty: number
  /**
   * The two caps behind `maxQty`, so the cart can say which one binds. Missing
   * on a cart saved before they were recorded; such a line gives the plain limit.
   */
  maxPerOrder?: number
  stockQty?: number
}

/** A product's two caps on one order: the booth's per-order maximum and what is in stock. */
export interface ItemCaps {
  maxPerOrder: number
  stockQty: number
}

export interface Cart {
  eventSlug: string
  boothId: string
  boothCode: string
  vendorName: string
  /** The booth's logo when the first item was added; missing on carts saved before it was kept. */
  logoUrl?: string
  boothMode: Booth['mode']
  currency: string
  items: CartItem[]
  /**
   * Sent with the reservation so a retried submit returns the first order
   * (FR-08). Renewed whenever the cart contents change, and after a refused
   * checkout.
   */
  requestId: string
}

/** A request id that also works on a plain-http LAN address, where `crypto.randomUUID` is missing. */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const BOOTH_MODES: ReadonlyArray<Booth['mode']> = ['prepay', 'reservation', 'discovery']
const isCount = (n: unknown, min: number) => typeof n === 'number' && Number.isInteger(n) && n >= min
const isText = (s: unknown) => typeof s === 'string'

function isCartItem(value: unknown): value is CartItem {
  const v = value as Partial<CartItem> | null
  return (
    typeof v === 'object' &&
    v !== null &&
    isText(v.productId) &&
    isText(v.name) &&
    isCount(v.priceCents, 0) &&
    isCount(v.qty, 1) &&
    isCount(v.maxQty, 0) &&
    (v.maxPerOrder === undefined || isCount(v.maxPerOrder, 0)) &&
    (v.stockQty === undefined || isCount(v.stockQty, 0))
  )
}

/** A saved cart is only trusted if it still has the cart's shape, like the saved catalog. */
function isCart(value: unknown): value is Cart {
  const v = value as Partial<Cart> | null
  return (
    typeof v === 'object' &&
    v !== null &&
    [v.eventSlug, v.boothId, v.boothCode, v.vendorName, v.currency, v.requestId].every(isText) &&
    (v.logoUrl === undefined || isText(v.logoUrl)) &&
    BOOTH_MODES.includes(v.boothMode as Booth['mode']) &&
    Array.isArray(v.items) &&
    v.items.length > 0 &&
    v.items.every(isCartItem)
  )
}

const listeners = new Set<() => void>()
let cached: Cart | null = load()

/** The saved cart, or null. A malformed one (an older build, a hand edit) is dropped rather than shown. */
function load(): Cart | null {
  let saved: unknown = null
  try {
    const raw = localStorage.getItem(CART_KEY)
    if (!raw) return null
    saved = JSON.parse(raw)
  } catch {
    // Unreadable JSON, or storage that cannot be read: treated like a malformed cart.
  }
  if (isCart(saved)) return saved
  try {
    localStorage.removeItem(CART_KEY)
  } catch {
    // Without storage there is nothing saved to drop.
  }
  return null
}

function save(next: Cart | null) {
  cached = next && next.items.length > 0 ? next : null
  try {
    if (cached) localStorage.setItem(CART_KEY, JSON.stringify(cached))
    else localStorage.removeItem(CART_KEY)
  } catch {
    // The cart still works for this page view without storage.
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useCart(): Cart | null {
  return useSyncExternalStore(subscribe, () => cached)
}

export function maxQtyFor(product: Product) {
  return Math.min(product.maxPerOrder, product.availableQty)
}

export function capsFor(product: Product): ItemCaps {
  return { maxPerOrder: product.maxPerOrder, stockQty: product.availableQty }
}

/**
 * The note under a line that has reached its limit: the stock when that is
 * what runs out first, else the booth's per-order maximum. Null below the limit.
 */
export function limitNote(item: CartItem): string | null {
  if (item.qty < item.maxQty) return null
  if (item.maxPerOrder === undefined || item.stockQty === undefined) return `Limit ${item.maxQty} for this item`
  if (item.stockQty <= 0) return 'Sold out'
  return item.stockQty < item.maxPerOrder ? `Only ${item.stockQty} left` : `Up to ${item.maxPerOrder} per order`
}

/** FR-06: the cart holds one booth. Callers confirm with the attendee before replacing. */
export function isOtherBooth(cart: Cart | null, boothId: string) {
  return cart !== null && cart.boothId !== boothId
}

export function addToCart(args: { eventSlug: string; currency: string; booth: Booth; product: Product }) {
  const { eventSlug, currency, booth, product } = args
  const base: Cart =
    cached && cached.boothId === booth.id
      ? cached
      : {
          eventSlug,
          boothId: booth.id,
          boothCode: booth.code,
          vendorName: booth.vendorName,
          logoUrl: booth.logoUrl,
          boothMode: booth.mode,
          currency,
          items: [],
          requestId: '',
        }
  const maxQty = maxQtyFor(product)
  const caps = capsFor(product)
  const existing = base.items.find((i) => i.productId === product.id)
  const items = existing
    ? base.items.map((i) => (i.productId === product.id ? { ...i, ...caps, maxQty, qty: Math.min(i.qty + 1, maxQty) } : i))
    : [...base.items, { productId: product.id, name: product.name, priceCents: product.priceCents, qty: 1, maxQty, ...caps }]
  save({ ...base, items, requestId: newRequestId() })
}

export function setQty(productId: string, qty: number) {
  if (!cached) return
  const items = cached.items
    .map((i) => (i.productId === productId ? { ...i, qty: Math.min(qty, i.maxQty) } : i))
    .filter((i) => i.qty > 0)
  save({ ...cached, items, requestId: newRequestId() })
}

/**
 * Applies what the server says is left after a refused order (FR-07): each
 * named line drops to its new limit, and a line with none left is removed.
 */
export function capLines(limits: Record<string, ItemCaps>) {
  if (!cached) return
  const items = cached.items
    .map((i) => {
      const caps = limits[i.productId]
      if (caps === undefined) return i
      const maxQty = Math.min(caps.maxPerOrder, caps.stockQty)
      return { ...i, ...caps, maxQty, qty: Math.min(i.qty, maxQty) }
    })
    .filter((i) => i.qty > 0)
  save({ ...cached, items, requestId: newRequestId() })
}

/**
 * Records the caps the server reported with a refusal, keeping every quantity: the cart then
 * shows which lines are over ("Only 1 left") and the attendee chooses how to fix them.
 */
export function applyCaps(limits: Record<string, ItemCaps>) {
  if (!cached) return
  const items = cached.items.map((i) => {
    const caps = limits[i.productId]
    return caps === undefined ? i : { ...i, ...caps, maxQty: Math.min(caps.maxPerOrder, caps.stockQty) }
  })
  // Same quantities, so the request id stays: a retry of this cart is still the same request.
  save({ ...cached, items })
}

/** A line holding more than it may: the server lowered its cap after it was added. */
export function isOverLimit(item: CartItem) {
  return item.qty > item.maxQty
}

const LAST_ORDER_KEY = 'cart.lastOrder'

/** The order this device placed last from the cart, so an emptied cart can point to it. */
export function rememberLastOrder(orderId: string) {
  try {
    sessionStorage.setItem(LAST_ORDER_KEY, orderId)
  } catch {
    // Without storage the empty cart simply offers the event.
  }
}

export function lastOrderId(): string | null {
  try {
    return sessionStorage.getItem(LAST_ORDER_KEY)
  } catch {
    return null
  }
}

// A refused checkout may have created an order on the server and released it,
// and a retry with the same request id returns that released order.
export function renewRequestId() {
  if (!cached) return
  save({ ...cached, requestId: newRequestId() })
}

export function clearCart() {
  save(null)
}

export function cartCount(cart: Cart | null) {
  return cart ? cart.items.reduce((n, i) => n + i.qty, 0) : 0
}

export function cartTotal(cart: Cart) {
  return cart.items.reduce((sum, i) => sum + i.qty * i.priceCents, 0)
}
