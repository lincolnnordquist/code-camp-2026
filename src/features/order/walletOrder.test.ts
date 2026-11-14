import { describe, expect, it } from 'vitest'
import type { Order } from '../../shared/types'
import { bringToFront, haulItems, progressStep, restack, urgencyStack } from './walletOrder'

const order = (id: string, patch: Partial<Order> = {}): Order => ({
  id,
  boothId: 'b1',
  eventId: 'e1',
  boothCode: 'A3',
  boothName: 'Wall Rose Goods',
  type: 'reservation',
  status: 'confirmed',
  items: [],
  totalCents: 1000,
  currency: 'USD',
  pickupCode: '1234',
  holdEndsAt: null,
  createdAt: '2026-11-14T10:00:00Z',
  collectedAt: null,
  cancelReason: null,
  refundStatus: 'none',
  refundedCents: 0,
  ...patch,
})

describe('wallet stack order', () => {
  it('puts a ready order in front, then the hold ending soonest, then the newest', () => {
    const open = [
      order('new', { type: 'prepaid', createdAt: '2026-11-14T11:00:00Z' }),
      order('late-hold', { holdEndsAt: '2026-11-14T13:00:00Z' }),
      order('ready', { status: 'ready' }),
      order('soon-hold', { holdEndsAt: '2026-11-14T12:00:00Z' }),
    ]
    expect(urgencyStack(open)).toEqual(['new', 'late-hold', 'soon-hold', 'ready'])
  })

  it('brings a tapped pass to the front and sends the old front to the rear', () => {
    expect(bringToFront(['1', '2', '0'], '2')).toEqual(['0', '1', '2'])
    expect(bringToFront(['a', 'b', 'c', 'd'], 'b')).toEqual(['d', 'a', 'c', 'b'])
  })

  it('leaves the stack alone when the front pass is tapped', () => {
    expect(bringToFront(['a', 'b'], 'b')).toEqual(['a', 'b'])
  })

  it('keeps the chosen front while it is open and adds new orders at the rear', () => {
    const open = [order('a'), order('b'), order('c', { status: 'ready' })]
    expect(restack(['b', 'c', 'a'], [...open, order('d')])).toEqual(['d', 'b', 'c', 'a'])
  })

  it('rebuilds by urgency once the front order has left the open list', () => {
    const open = [order('a'), order('c', { status: 'ready' })]
    expect(restack(['a', 'c', 'b'], open)).toEqual(['a', 'c'])
  })
})

describe('progress track', () => {
  it('counts the steps an open order has reached', () => {
    expect(progressStep('pending_payment')).toBe(1)
    expect(progressStep('confirmed')).toBe(2)
    expect(progressStep('ready')).toBe(3)
  })
})

describe('your haul', () => {
  it('lists the items of collected orders once per product, newest collection first', () => {
    const item = (productId: string, name: string) => ({ productId, name, quantity: 1, unitPriceCents: 500 })
    const orders = [
      order('old', { status: 'collected', collectedAt: '2026-11-14T09:00:00Z', items: [item('p1', 'Patch'), item('p2', 'Poster')] }),
      order('open', { items: [item('p3', 'Hoodie')] }),
      order('recent', { status: 'collected', collectedAt: '2026-11-14T11:00:00Z', items: [item('p1', 'Patch')] }),
    ]
    expect(haulItems(orders).map((i) => [i.order.id, i.productId])).toEqual([
      ['recent', 'p1'],
      ['old', 'p2'],
    ])
  })
})
