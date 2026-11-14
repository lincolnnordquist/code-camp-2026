// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booth, Product } from '../../shared/types'


const booth = (id: string): Booth => ({
  id,
  code: id.toUpperCase(),
  vendorName: `Vendor ${id}`,
  slogan: '',
  logoUrl: '',
  bannerUrl: '',
  mode: 'reservation',
  orderingPaused: false,
  pickupInstructions: '',
  mapX: 0.05, mapY: 0.05,
})

const product = (id: string, boothId: string, maxPerOrder: number, availableQty: number): Product => ({
  id,
  boothId,
  name: id,
  description: '',
  category: 'C',
  priceCents: 250,
  availableQty,
  maxPerOrder,
  imageUrl: '',
})

// The store reads storage when the module loads, so each test gets a fresh copy.
async function freshStore() {
  vi.resetModules()
  return import('./cartStore')
}

const add = (store: Awaited<ReturnType<typeof freshStore>>, b: Booth, p: Product) =>
  store.addToCart({ eventSlug: 'ev', currency: 'USD', booth: b, product: p })

describe('cart store', () => {
  beforeEach(() => localStorage.clear())

  it('caps quantity at the lower of the per-order maximum and stock (FR-06)', async () => {
    const store = await freshStore()
    const limitedByMax = product('p1', 'a', 2, 10)
    const limitedByStock = product('p2', 'a', 5, 1)
    for (let i = 0; i < 4; i++) {
      add(store, booth('a'), limitedByMax)
      add(store, booth('a'), limitedByStock)
    }
    store.setQty('p1', 99)
    const items = JSON.parse(localStorage.getItem('cart')!).items
    expect(items.map((i: { qty: number }) => i.qty)).toEqual([2, 1])
  })

  it('reports a different booth so the screen can ask before replacing', async () => {
    const store = await freshStore()
    add(store, booth('a'), product('p1', 'a', 2, 5))
    const cart = JSON.parse(localStorage.getItem('cart')!)
    expect(store.isOtherBooth(cart, 'a')).toBe(false)
    expect(store.isOtherBooth(cart, 'b')).toBe(true)
    expect(store.isOtherBooth(null, 'b')).toBe(false)
  })

  it('replaces the cart when an item from another booth is added', async () => {
    const store = await freshStore()
    add(store, booth('a'), product('p1', 'a', 2, 5))
    add(store, booth('b'), product('p2', 'b', 2, 5))
    const cart = JSON.parse(localStorage.getItem('cart')!)
    expect(cart.boothId).toBe('b')
    expect(cart.items.map((i: { productId: string }) => i.productId)).toEqual(['p2'])
  })

  it('renews the request id when contents change, so a retry of the same cart reuses it (FR-08)', async () => {
    const store = await freshStore()
    add(store, booth('a'), product('p1', 'a', 3, 5))
    const first = JSON.parse(localStorage.getItem('cart')!).requestId
    expect(first).toBeTruthy()
    add(store, booth('a'), product('p1', 'a', 3, 5))
    expect(JSON.parse(localStorage.getItem('cart')!).requestId).not.toBe(first)
  })

  it('removes a line at zero and drops the cart when it is empty', async () => {
    const store = await freshStore()
    add(store, booth('a'), product('p1', 'a', 2, 5))
    store.setQty('p1', 0)
    expect(localStorage.getItem('cart')).toBeNull()
  })

  it('caps refused lines to what is left, removes sold-out ones, and leaves the rest', async () => {
    const store = await freshStore()
    for (const p of ['p1', 'p1', 'p1', 'p2', 'p3']) add(store, booth('a'), product(p, 'a', 3, 5))
    const before = JSON.parse(localStorage.getItem('cart')!).requestId
    store.capLines({ p1: { maxPerOrder: 3, stockQty: 2 }, p2: { maxPerOrder: 3, stockQty: 0 } })
    const cart = JSON.parse(localStorage.getItem('cart')!)
    expect(cart.items.map((i: { productId: string; qty: number; maxQty: number }) => [i.productId, i.qty, i.maxQty])).toEqual([
      ['p1', 2, 2],
      ['p3', 1, 3],
    ])
    expect(cart.requestId).not.toBe(before)
  })

  it('names the cap that binds once a line reaches its limit: stock, else the per-order maximum', async () => {
    const store = await freshStore()
    add(store, booth('a'), product('few', 'a', 3, 1))
    for (let i = 0; i < 2; i++) add(store, booth('a'), product('rule', 'a', 2, 9))
    add(store, booth('a'), product('roomy', 'a', 4, 9))
    const lines = JSON.parse(localStorage.getItem('cart')!).items
    expect(lines.map(store.limitNote)).toEqual(['Only 1 left', 'Up to 2 per order', null])
    // Caps applied after a refusal say which one binds as well.
    store.capLines({ roomy: { maxPerOrder: 4, stockQty: 1 } })
    const roomy = JSON.parse(localStorage.getItem('cart')!).items[2]
    expect([roomy.qty, store.limitNote(roomy)]).toEqual([1, 'Only 1 left'])
  })

  it('a line saved before both caps were recorded gives the plain limit', async () => {
    const store = await freshStore()
    expect(store.limitNote({ productId: 'p', name: 'p', priceCents: 1, qty: 2, maxQty: 2 })).toBe('Limit 2 for this item')
  })

  it('keeps the booth logo with the cart, for the checkout vendor row', async () => {
    const store = await freshStore()
    add(store, { ...booth('a'), logoUrl: '/branding/a-logo.svg' }, product('p1', 'a', 3, 5))
    expect(JSON.parse(localStorage.getItem('cart')!).logoUrl).toBe('/branding/a-logo.svg')
  })

  it('totals and counts in integer cents', async () => {
    const store = await freshStore()
    add(store, booth('a'), product('p1', 'a', 3, 5))
    add(store, booth('a'), product('p1', 'a', 3, 5))
    const cart = JSON.parse(localStorage.getItem('cart')!)
    expect(store.cartCount(cart)).toBe(2)
    expect(store.cartTotal(cart)).toBe(500)
  })
})

describe('saved cart', () => {
  beforeEach(() => localStorage.clear())

  const valid = {
    eventSlug: 'ev',
    boothId: 'a',
    boothCode: 'A',
    vendorName: 'Vendor a',
    boothMode: 'reservation',
    currency: 'USD',
    requestId: 'r1',
    items: [{ productId: 'p1', name: 'p1', priceCents: 250, qty: 1, maxQty: 2 }],
  }

  it('keeps a saved cart that has the cart shape', async () => {
    localStorage.setItem('cart', JSON.stringify(valid))
    const store = await freshStore()
    add(store, booth('a'), product('p1', 'a', 2, 5))
    expect(JSON.parse(localStorage.getItem('cart')!).items[0].qty).toBe(2)
  })

  it.each([
    ['not JSON', '{oops'],
    ['an array', '[]'],
    ['no items', JSON.stringify({ ...valid, items: [] })],
    ['a line without a quantity', JSON.stringify({ ...valid, items: [{ productId: 'p1', name: 'p1', priceCents: 250, maxQty: 2 }] })],
    ['an unknown booth mode', JSON.stringify({ ...valid, boothMode: 'sale' })],
    ['a missing request id', JSON.stringify({ ...valid, requestId: undefined })],
  ])('drops a malformed saved cart (%s) and starts a fresh one', async (_label, saved) => {
    localStorage.setItem('cart', saved)
    const store = await freshStore()
    expect(localStorage.getItem('cart')).toBeNull()
    add(store, booth('b'), product('p9', 'b', 2, 5))
    const cart = JSON.parse(localStorage.getItem('cart')!)
    expect([cart.boothId, cart.items.map((i: { productId: string; qty: number }) => [i.productId, i.qty])]).toEqual(['b', [['p9', 1]]])
  })
})
