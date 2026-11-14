import { describe, expect, it } from 'vitest'
import type { EventCatalog, Product } from '../../shared/types'
import { featuredProducts, homeShelves, MAX_CATEGORY_SHELVES } from './shelves'

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  boothId: 'b1',
  name: `Product ${id}`,
  category: 'Prints',
  description: '',
  imageUrl: `https://example.test/${id}.png`,
  priceCents: 2000,
  availableQty: 20,
  maxPerOrder: 2,
  ...over,
})

const catalog = (products: Product[]) => ({ event: {}, booths: [], products }) as unknown as EventCatalog

describe('home shelves', () => {
  it('lists almost-gone stock lowest first, leaves sold-out products off, and has no See all', () => {
    const shelves = homeShelves(
      catalog([product('a', { availableQty: 4 }), product('b', { availableQty: 1 }), product('c', { availableQty: 0 }), product('d', { availableQty: 5 }), product('e', { availableQty: 3 })]),
    )
    const almost = shelves.find((s) => s.id === 'almost-gone')!
    expect(almost.products.map((p) => p.id)).toEqual(['b', 'e', 'a', 'd'])
    expect(almost.seeAll).toBeNull()
  })

  it('lists under $10 cheapest first with the price filter as See all, $10.00 excluded', () => {
    const shelves = homeShelves(catalog([product('a', { priceCents: 999 }), product('b', { priceCents: 500 }), product('c', { priceCents: 1000 }), product('d', { priceCents: 100 })]))
    const cheap = shelves.find((s) => s.id === 'under-10')!
    expect(cheap.products.map((p) => p.id)).toEqual(['d', 'b', 'a'])
    expect(cheap.seeAll).toBe('?price=under-10')
  })

  it('shows only the largest categories with three or more in stock, linking to the category filter', () => {
    const products = [
      ...['1', '2', '3', '4'].map((i) => product(`t${i}`, { category: 'Tabletop' })),
      ...['1', '2', '3'].map((i) => product(`p${i}`, { category: 'Plush & Soft' })),
      ...['1', '2', '3'].map((i) => product(`f${i}`, { category: 'Figures' })),
      product('x1', { category: 'Apparel' }),
    ]
    const categories = homeShelves(catalog(products)).filter((s) => s.id.startsWith('category-'))
    expect(categories).toHaveLength(MAX_CATEGORY_SHELVES)
    expect(categories.map((s) => s.title)).toEqual(['Tabletop', 'Figures'])
    expect(categories[0].seeAll).toBe('?category=Tabletop')
  })

  it('drops a shelf with fewer than three products', () => {
    expect(homeShelves(catalog([product('a', { availableQty: 2 }), product('b', { availableQty: 3 })]))).toEqual([])
  })
})

describe('featured products', () => {
  it('takes the priciest in-stock product with a photo from each category, most valuable first', () => {
    const picks = featuredProducts([
      product('a', { category: 'Prints', priceCents: 1800 }),
      product('b', { category: 'Prints', priceCents: 2500 }),
      product('c', { category: 'Figures', priceCents: 8900 }),
      product('d', { category: 'Figures', priceCents: 9900, availableQty: 0 }),
      product('e', { category: 'Plush', priceCents: 9999, imageUrl: '' }),
    ])
    expect(picks.map((p) => p.id)).toEqual(['c', 'b'])
  })
})
