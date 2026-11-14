import type { EventCatalog, Product } from '../../shared/types'
import { PRICE_BANDS } from './filters'
import { LOW_STOCK_QTY } from './stockState'

/** A shelf needs at least this many products to be worth a row of its own. */
export const MIN_SHELF_SIZE = 3

/** Category rows on the home: the biggest categories only, so the grid below stays in reach. */
export const MAX_CATEGORY_SHELVES = 2

/** The most products one shelf shows; See all has the rest. */
export const MAX_SHELF_ITEMS = 10

const UNDER_10 = PRICE_BANDS.find((b) => b.id === 'under-10')!

export interface Shelf {
  id: string
  title: string
  products: Product[]
  /** The search URL (relative to the event home) that lists the whole shelf, when one exists. */
  seeAll: string | null
}

/**
 * The home's horizontal rows, all read from the loaded catalog: what is nearly gone, what is
 * cheap, then the largest categories. Sold-out products are left out: a shelf is for buying.
 */
export function homeShelves(catalog: EventCatalog): Shelf[] {
  const inStock = catalog.products.filter((p) => p.availableQty > 0)
  const shelves: Shelf[] = []

  const almostGone = inStock.filter((p) => p.availableQty <= LOW_STOCK_QTY).sort((a, b) => a.availableQty - b.availableQty)
  // No filter lists low stock, so this shelf has no See all; it is short by nature.
  shelves.push({ id: 'almost-gone', title: 'Almost gone', products: almostGone, seeAll: null })

  const cheap = inStock.filter((p) => UNDER_10.includes(p.priceCents)).sort((a, b) => a.priceCents - b.priceCents)
  shelves.push({ id: 'under-10', title: UNDER_10.label, products: cheap, seeAll: '?price=under-10' })

  const byCategory = new Map<string, Product[]>()
  for (const p of inStock) byCategory.set(p.category, [...(byCategory.get(p.category) ?? []), p])
  const categories = [...byCategory.entries()]
    .filter(([, list]) => list.length >= MIN_SHELF_SIZE)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, MAX_CATEGORY_SHELVES)
  for (const [category, list] of categories) {
    shelves.push({ id: `category-${category}`, title: category, products: list, seeAll: `?category=${encodeURIComponent(category)}` })
  }

  return shelves
    .filter((s) => s.products.length >= MIN_SHELF_SIZE)
    .map((s) => ({ ...s, products: s.products.slice(0, MAX_SHELF_ITEMS) }))
}

/** Featured: one product per category (its priciest in stock with a photo), most valuable first. */
export function featuredProducts(products: Product[], limit = 5): Product[] {
  const best = new Map<string, Product>()
  for (const p of products) {
    if (p.availableQty <= 0 || !p.imageUrl) continue
    const current = best.get(p.category)
    if (!current || p.priceCents > current.priceCents) best.set(p.category, p)
  }
  return [...best.values()].sort((a, b) => b.priceCents - a.priceCents).slice(0, limit)
}
