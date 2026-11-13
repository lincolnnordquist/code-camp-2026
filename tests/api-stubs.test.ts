// Checks that the shared API functions can be called and follow the main rules.
// These run against the sample-data stubs. When the real Supabase calls replace the
// stubs, the order and access tests that run against the local database take over.
import { describe, expect, it } from 'vitest'
import {
  cancelReservation,
  collectOrder,
  createReservation,
  getEventCatalog,
  getOrder,
  listBoothOrders,
  listMyOrders,
  markOrderReady,
  setOrderingPaused,
  setProductStock,
} from '../src/shared/api'

const email = 'attendee@example.com'

describe('catalog', () => {
  it('returns the demo event with booths and products', async () => {
    const result = await getEventCatalog('demo')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.booths).toHaveLength(3)
      expect(result.value.products.length).toBeGreaterThan(0)
    }
  })

  it('refuses an unknown event', async () => {
    expect(await getEventCatalog('nope')).toEqual({ ok: false, reason: 'event_not_found' })
  })
})

describe('reservation journey', () => {
  it('reserves, shows up for the vendor, becomes ready, and is collected', async () => {
    const reserved = await createReservation({
      boothId: 'booth-a',
      items: [{ productId: 'p-2', quantity: 2 }],
      email,
      requestId: 'journey-1',
    })
    expect(reserved.ok).toBe(true)
    if (!reserved.ok) return
    const order = reserved.value
    expect(order.status).toBe('confirmed')
    expect(order.totalCents).toBe(1600)
    expect(order.pickupCode).toMatch(/^\d{4}$/)

    expect((await listMyOrders()).some((o) => o.id === order.id)).toBe(true)
    expect((await listBoothOrders('booth-a')).some((o) => o.id === order.id)).toBe(true)

    const ready = await markOrderReady(order.id)
    expect(ready.ok && ready.value.status).toBe('ready')

    expect(await collectOrder('booth-b', order.pickupCode)).toEqual({ ok: false, reason: 'not_found' })

    const collected = await collectOrder('booth-a', order.pickupCode)
    expect(collected.ok && collected.value.status).toBe('collected')

    const again = await collectOrder('booth-a', order.pickupCode)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.reason).toBe('already_collected')
  })

  it('returns the first order when the same request is sent twice', async () => {
    const request = { boothId: 'booth-a', items: [{ productId: 'p-2', quantity: 1 }], email, requestId: 'retry-1' }
    const first = await createReservation(request)
    const second = await createReservation(request)
    expect(first.ok && second.ok && first.value.id === second.value.id).toBe(true)
  })

  it('gives the last item to only one of two requests', async () => {
    const make = (requestId: string) =>
      createReservation({ boothId: 'booth-a', items: [{ productId: 'p-1', quantity: 1 }], email, requestId })
    const [a, b] = await Promise.all([make('last-1'), make('last-2')])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    const refused = a.ok ? b : a
    expect(refused.ok === false && refused.reason).toBe('insufficient_stock')
  })

  it('returns stock when a reservation is cancelled', async () => {
    await setProductStock('p-2', 5)
    const reserved = await createReservation({
      boothId: 'booth-a',
      items: [{ productId: 'p-2', quantity: 3 }],
      email,
      requestId: 'cancel-1',
    })
    expect(reserved.ok).toBe(true)
    if (!reserved.ok) return
    const cancelled = await cancelReservation(reserved.value.id)
    expect(cancelled.ok && cancelled.value.status).toBe('cancelled')
    const catalog = await getEventCatalog('demo')
    expect(catalog.ok && catalog.value.products.find((p) => p.id === 'p-2')?.availableQty).toBe(5)
    expect((await getOrder(reserved.value.id)).ok).toBe(true)
  })
})

describe('refusals', () => {
  it('refuses a reservation above the per-order maximum', async () => {
    const result = await createReservation({
      boothId: 'booth-a',
      items: [{ productId: 'p-2', quantity: 6 }],
      email,
      requestId: 'max-1',
    })
    expect(result.ok === false && result.reason).toBe('over_max_per_order')
  })

  it('refuses a reservation at a paused booth and at a discovery booth', async () => {
    await setOrderingPaused('booth-a', true)
    const paused = await createReservation({
      boothId: 'booth-a',
      items: [{ productId: 'p-2', quantity: 1 }],
      email,
      requestId: 'paused-1',
    })
    expect(paused.ok === false && paused.reason).toBe('ordering_paused')
    await setOrderingPaused('booth-a', false)

    const discovery = await createReservation({
      boothId: 'booth-c',
      items: [{ productId: 'p-4', quantity: 1 }],
      email,
      requestId: 'discovery-1',
    })
    expect(discovery.ok === false && discovery.reason).toBe('booth_not_accepting_orders')
  })
})
