import { describe, expect, it } from 'vitest'
import { LOW_STOCK_QTY, stockState } from './stockState'

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
