import type { Booth, BoothMode } from '../../shared/types'

export type ShopType = 'all' | BoothMode

export const SHOP_TYPES: readonly ShopType[] = ['all', 'reservation', 'prepay', 'discovery']

const MODE_ORDER: readonly BoothMode[] = ['reservation', 'prepay', 'discovery']

export const isShopType = (value: string | null): value is ShopType => SHOP_TYPES.includes(value as ShopType)

/** The booths of one shop type in catalog order; under All, grouped as reservation, prepay, then discovery. */
export function boothsOfType(booths: Booth[], type: ShopType): Booth[] {
  if (type !== 'all') return booths.filter((b) => b.mode === type)
  return MODE_ORDER.flatMap((mode) => booths.filter((b) => b.mode === mode))
}

/** The shop type one step along, clamped at the ends (a swipe does not wrap). */
export function stepShopType(type: ShopType, step: 1 | -1): ShopType {
  const index = SHOP_TYPES.indexOf(type) + step
  return SHOP_TYPES[Math.min(Math.max(index, 0), SHOP_TYPES.length - 1)]
}

/** The shop type one step along, wrapping at the ends (the arrow keys). */
export function cycleShopType(type: ShopType, step: 1 | -1): ShopType {
  const n = SHOP_TYPES.length
  return SHOP_TYPES[(SHOP_TYPES.indexOf(type) + step + n) % n]
}

/**
 * The store card's product row: three columns for three or more products, else two. With fewer
 * than two products a See booth tile follows, so a single photo never stretches across the card.
 */
export function productRowLayout(productCount: number): { columns: 2 | 3; shown: number; seeBooth: boolean } {
  if (productCount >= 3) return { columns: 3, shown: 3, seeBooth: false }
  if (productCount === 2) return { columns: 2, shown: 2, seeBooth: false }
  return { columns: 2, shown: productCount, seeBooth: true }
}
