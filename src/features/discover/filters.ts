import type { Product } from '../../shared/types'

/**
 * Product filters and sort for search results and storefronts: an addition to SPEC FR-04 for
 * the team to confirm. Pure functions over products; the state lives in the URL
 * (?stock=1&price=10-25&sort=price-asc), so Back and reload keep it.
 */

export type PriceBandId = 'under-10' | '10-25' | '25-up'
export type SortOrder = 'default' | 'price-asc' | 'price-desc'

export interface ProductFilters {
  inStock: boolean
  price: PriceBandId | null
  sort: SortOrder
}

export const NO_FILTERS: ProductFilters = { inStock: false, price: null, sort: 'default' }

const CENTS_10 = 1000
const CENTS_25 = 2500

/**
 * Whole-dollar edges belong to the middle band: $10.00 and $25.00 are both "$10 to $25",
 * so "$25+" starts above $25.00 and "Under $10" stops below $10.00.
 */
export const PRICE_BANDS: ReadonlyArray<{ id: PriceBandId; label: string; includes: (cents: number) => boolean }> = [
  { id: 'under-10', label: 'Under $10', includes: (c) => c < CENTS_10 },
  { id: '10-25', label: '$10 to $25', includes: (c) => c >= CENTS_10 && c <= CENTS_25 },
  { id: '25-up', label: '$25+', includes: (c) => c > CENTS_25 },
]

export const SORT_LABELS: Record<Exclude<SortOrder, 'default'>, string> = {
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
}

export const FILTER_PARAMS = { stock: 'stock', price: 'price', sort: 'sort' } as const

const isBand = (v: string | null): v is PriceBandId => PRICE_BANDS.some((b) => b.id === v)
const isSort = (v: string | null): v is Exclude<SortOrder, 'default'> => v === 'price-asc' || v === 'price-desc'

/** Reads the filters from the URL. An unknown value (an old or edited link) reads as no filter. */
export function readFilters(params: URLSearchParams): ProductFilters {
  const price = params.get(FILTER_PARAMS.price)
  const sort = params.get(FILTER_PARAMS.sort)
  return {
    inStock: params.get(FILTER_PARAMS.stock) === '1',
    price: isBand(price) ? price : null,
    sort: isSort(sort) ? sort : 'default',
  }
}

/** A copy of `params` with the filters written in and every other parameter kept. */
export function writeFilters(params: URLSearchParams, filters: ProductFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  if (filters.inStock) next.set(FILTER_PARAMS.stock, '1')
  else next.delete(FILTER_PARAMS.stock)
  if (filters.price) next.set(FILTER_PARAMS.price, filters.price)
  else next.delete(FILTER_PARAMS.price)
  if (filters.sort !== 'default') next.set(FILTER_PARAMS.sort, filters.sort)
  else next.delete(FILTER_PARAMS.sort)
  return next
}

/** Filters that narrow the list (sort only reorders it). */
export function narrowingLabels(filters: ProductFilters): string[] {
  const labels: string[] = []
  if (filters.inStock) labels.push('In stock')
  const band = PRICE_BANDS.find((b) => b.id === filters.price)
  if (band) labels.push(band.label)
  return labels
}

/** How many choices differ from the default, for the Filters chip's count. */
export function activeFilterCount(filters: ProductFilters): number {
  return narrowingLabels(filters).length + (filters.sort === 'default' ? 0 : 1)
}

/**
 * Keeps the items whose product passes the filters, then sorts by price when asked.
 * The sort is stable: equal prices keep the incoming order (relevance or the booth's own order).
 */
export function applyFilters<T>(items: readonly T[], productOf: (item: T) => Product, filters: ProductFilters): T[] {
  const band = PRICE_BANDS.find((b) => b.id === filters.price)
  const kept = items.filter((item) => {
    const p = productOf(item)
    if (filters.inStock && p.availableQty <= 0) return false
    return band ? band.includes(p.priceCents) : true
  })
  if (filters.sort === 'default') return kept
  const direction = filters.sort === 'price-asc' ? 1 : -1
  return kept.sort((a, b) => direction * (productOf(a).priceCents - productOf(b).priceCents))
}
