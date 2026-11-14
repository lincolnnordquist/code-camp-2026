import { listMyOrders } from '../../shared/api'
import type { Order } from '../../shared/types'

/** This device's orders, read once while the home's catalog loads. */
let primed: Order[] | null = null

/**
 * Reads the orders while the home's catalog loads, so the open-orders strip renders in the same pass
 * as the sections under it instead of arriving later and pushing them down (layout shift). Never rejects.
 */
export function primeOpenOrders(): Promise<void> {
  return listMyOrders()
    .then((all) => {
      primed = all
    })
    .catch(() => undefined)
}

/** The orders primeOpenOrders read, or null before it has. */
export const primedOrders = () => primed
