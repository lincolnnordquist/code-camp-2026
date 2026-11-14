import { describe, expect, it } from 'vitest'
import { LOW_STOCK_QTY, soldOutLast, stockState } from './stockState'

describe('stockState (FR-05)', () => {
  it('says nothing while more than five are left', () => {
    expect(stockState(6)).toBeNull()
    expect(stockState(40)).toBeNull()
  })

  it('reads "Only N left" at five or fewer, as a warning', () => {
    expect(LOW_STOCK_QTY).toBe(5)
    expect(stockState(5)).toEqual({ tone: 'warning', label: 'Only 5 left' })
    expect(stockState(1)).toEqual({ tone: 'warning', label: 'Only 1 left' })
  })

  it('reads sold out at zero, as an error', () => {
    expect(stockState(0)).toEqual({ tone: 'error', label: 'Sold out' })
  })
})

describe('soldOutLast', () => {
  it('moves sold-out products to the end and keeps the rest in order', () => {
    const p = (id: string, availableQty: number) => ({ id, availableQty })
    expect(soldOutLast([p('a', 0), p('b', 3), p('c', 0), p('d', 9)]).map((x) => x.id)).toEqual(['b', 'd', 'a', 'c'])
  })
})
