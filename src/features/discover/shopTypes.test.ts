import { describe, expect, it } from 'vitest'
import type { Booth } from '../../shared/types'
import { boothsOfType, cycleShopType, productRowLayout, stepShopType } from './shopTypes'

const booth = (id: string, mode: Booth['mode']) => ({ id, mode }) as Booth

describe('shop types', () => {
  const booths = [booth('d1', 'discovery'), booth('p1', 'prepay'), booth('r1', 'reservation'), booth('r2', 'reservation')]

  it('lists every booth under All, reservation then prepay then discovery, catalog order within each', () => {
    expect(boothsOfType(booths, 'all').map((b) => b.id)).toEqual(['r1', 'r2', 'p1', 'd1'])
  })

  it('lists only the booths of the chosen type', () => {
    expect(boothsOfType(booths, 'reservation').map((b) => b.id)).toEqual(['r1', 'r2'])
  })

  it('stops a swipe at the first and last type', () => {
    expect(stepShopType('all', -1)).toBe('all')
    expect(stepShopType('discovery', 1)).toBe('discovery')
    expect(stepShopType('all', 1)).toBe('reservation')
  })

  it('wraps the arrow keys around the ends', () => {
    expect(cycleShopType('all', -1)).toBe('discovery')
    expect(cycleShopType('discovery', 1)).toBe('all')
  })
})

describe('store card product row', () => {
  it('shows three products in three columns, and two in two', () => {
    expect(productRowLayout(5)).toEqual({ columns: 3, shown: 3, seeBooth: false })
    expect(productRowLayout(2)).toEqual({ columns: 2, shown: 2, seeBooth: false })
  })

  it('adds a See booth tile when a booth has one product or none', () => {
    expect(productRowLayout(1)).toEqual({ columns: 2, shown: 1, seeBooth: true })
    expect(productRowLayout(0)).toEqual({ columns: 2, shown: 0, seeBooth: true })
  })
})
