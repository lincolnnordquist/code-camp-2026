import { OPEN_STATUSES } from './orderStatus'
import { useMyOrders } from './useMyOrders'

/** Badge for the Orders tab: how many of this browser's orders are still open, the same list the wallet shows. */
export function OpenOrderCount() {
  const { orders } = useMyOrders()
  const count = orders?.filter((o) => OPEN_STATUSES.includes(o.status)).length ?? 0

  if (count === 0) return null
  return (
    <span className="tab-bar__badge">
      <span aria-hidden="true">{count}</span>
      <span className="visually-hidden">, {count} open</span>
    </span>
  )
}
