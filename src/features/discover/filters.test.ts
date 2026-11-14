import { describe, expect, it } from 'vitest'
import type { Product } from '../../shared/types'
import { activeFilterCount, applyFilters, NO_FILTERS, narrowingLabels, readFilters, writeFilters, type ProductFilters } from './filters'

const product = (id: string, priceCents: number, availableQty = 5): Product => ({
  id,
  boothId: 'b',
  name: id,
  description: '',
  category: 'Prints',
  priceCents,
  availableQty,
  maxPerOrder: 1,
  imageUrl: '',
})

const ids = (items: Product[], filters: Partial<ProductFilters>) => applyFilters(items, (p) => p, { ...NO_FILTERS, ...filters }).map((p) => p.id)

describe('price bands', () => {
  const edges = [product('9.99', 999), product('10.00', 1000), product('10.01', 1001), product('24.99', 2499), product('25.00', 2500), product('25.01', 2501)]

  it('Under $10 stops below $10.00', () => {
    expect(ids(edges, { price: 'under-10' })).toEqual(['9.99'])
  })

  it('$10 to $25 holds both whole-dollar edges', () => {
    expect(ids(edges, { price: '10-25' })).toEqual(['10.00', '10.01', '24.99', '25.00'])
  })

  it('$25+ starts above $25.00', () => {
    expect(ids(edges, { price: '25-up' })).toEqual(['25.01'])
  })

  it('every price falls in exactly one band', () => {
    for (const p of edges) {
      const hits = (['under-10', '10-25', '25-up'] as const).filter((band) => ids([p], { price: band }).length === 1)
      expect(hits, p.id).toHaveLength(1)
    }
  })
})

describe('stock and sort', () => {
  const items = [product('a', 2000), product('sold', 500, 0), product('b', 800), product('c', 2000), product('d', 800)]

  it('In stock hides only sold-out products', () => {
    expect(ids(items, { inStock: true })).toEqual(['a', 'b', 'c', 'd'])
  })

  it('default keeps the incoming order', () => {
    expect(ids(items, {})).toEqual(['a', 'sold', 'b', 'c', 'd'])
  })

  it('price sorts are stable: equal prices keep the incoming order in both directions', () => {
    expect(ids(items, { sort: 'price-asc' })).toEqual(['sold', 'b', 'd', 'a', 'c'])
    expect(ids(items, { sort: 'price-desc' })).toEqual(['a', 'c', 'b', 'd', 'sold'])
  })

  it('filters and sort combine, and the input is not changed', () => {
    const before = items.map((p) => p.id)
    expect(ids(items, { inStock: true, price: 'under-10', sort: 'price-desc' })).toEqual(['b', 'd'])
    expect(items.map((p) => p.id)).toEqual(before)
  })
})

describe('URL round trip', () => {
  it('writes only non-default values and keeps other parameters', () => {
    const next = writeFilters(new URLSearchParams('q=titan&category=Prints'), { inStock: true, price: '10-25', sort: 'price-asc' })
    expect(next.toString()).toBe('q=titan&category=Prints&stock=1&price=10-25&sort=price-asc')
    expect(readFilters(next)).toEqual({ inStock: true, price: '10-25', sort: 'price-asc' })
    expect(writeFilters(next, NO_FILTERS).toString()).toBe('q=titan&category=Prints')
  })

  it('reads unknown or malformed values as no filter', () => {
    expect(readFilters(new URLSearchParams('stock=yes&price=5-500&sort=random'))).toEqual(NO_FILTERS)
  })

  it('counts and names the active filters', () => {
    const f: ProductFilters = { inStock: true, price: 'under-10', sort: 'price-desc' }
    expect(narrowingLabels(f)).toEqual(['In stock', 'Under $10'])
    expect(activeFilterCount(f)).toBe(3)
    expect(activeFilterCount(NO_FILTERS)).toBe(0)
  })
})
