import { Link } from 'react-router-dom'
import type { Order } from '../../shared/types'
import { Icon } from '../../shared/ui/Icon'
import { formatMoney } from '../../shared/ui/labels'
import { formatClock } from './HoldTimer'
import { useCatalogProduct } from './boothDetails'
import { orderEventSlug } from './orderExtras'
import { attendeeOrderLabels, cancelledByAttendee } from './orderStatus'
import { haulItems } from './walletOrder'

function HaulTile({ order, productId, name, unitPriceCents }: ReturnType<typeof haulItems>[number]) {
  const product = useCatalogProduct(productId)
  const slug = orderEventSlug(order)
  const price = formatMoney(product?.priceCents ?? unitPriceCents, order.currency)
  return (
    <li className="haul-tile">
      <span className="haul-tile__photo">
        {product && <img src={product.imageUrl} alt="" loading="lazy" decoding="async" />}
        {slug && product && (
          // The sheet state makes closing the sheet go Back to Orders.
          <Link
            className="haul-tile__add"
            to={{ pathname: `/e/${slug}`, search: `?product=${productId}` }}
            state={{ productSheet: true }}
            aria-label={`Add ${name} again`}
          >
            <Icon name="add" />
          </Link>
        )}
      </span>
      <span className="label-large haul-tile__name">{name}</span>
      <span className="label-large haul-tile__price">{price}</span>
    </li>
  )
}

export function YourHaul({ orders }: { orders: Order[] }) {
  const items = haulItems(orders)
  if (items.length === 0) return null
  return (
    <section className="orders-section" aria-labelledby="haul-title">
      <h2 className="title-large" id="haul-title">
        Your haul
      </h2>
      <ul className="haul" role="list">
        {items.map((item) => (
          <HaulTile key={item.productId} {...item} />
        ))}
      </ul>
    </section>
  )
}

function endedLine(o: Order): string {
  if (o.status === 'expired') return o.holdEndsAt ? `Hold expired at ${formatClock(o.holdEndsAt)}` : 'Hold expired'
  if (cancelledByAttendee(o)) return 'Cancelled by you'
  return o.cancelReason ? 'Cancelled by the booth' : 'Cancelled'
}

function EndedRow({ order: o }: { order: Order }) {
  const product = useCatalogProduct(o.items[0]?.productId ?? '')
  const refund = o.refundStatus === 'none' ? null : (attendeeOrderLabels(o).paymentBadge?.label ?? null)
  const status = endedLine(o)
  return (
    <li>
      <Link className="ended-order" to={`/orders/${o.id}`} aria-label={[o.boothName, status, refund].filter(Boolean).join(', ')}>
        <span className="ended-order__thumb">{product && <img src={product.imageUrl} alt="" loading="lazy" decoding="async" />}</span>
        <span className="ended-order__text">
          <span className="title-medium">{o.boothName}</span>
          <span className="body-medium ended-order__status">{status}</span>
          {refund && <span className="label-medium ended-order__refund">{refund}</span>}
        </span>
        <Icon name="chevron_right" className="ended-order__chevron" />
      </Link>
    </li>
  )
}

export function NotCollected({ orders }: { orders: Order[] }) {
  const ended = orders.filter((o) => o.status === 'cancelled' || o.status === 'expired')
  if (ended.length === 0) return null
  return (
    <section className="orders-section" aria-labelledby="not-collected-title">
      <h2 className="title-large" id="not-collected-title">
        Not collected
      </h2>
      <ul className="ended-orders" role="list">
        {ended.map((o) => (
          <EndedRow key={o.id} order={o} />
        ))}
      </ul>
    </section>
  )
}
