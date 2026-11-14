import { Link } from 'react-router-dom'
import type { Booth, Product } from '../../shared/types'
import { formatMoney } from '../../shared/ui/labels'
import { ProductImage } from '../../shared/ui/ProductImage'
import { useProductSheetLink } from './productSheetLink'
import { StockBadge } from './StockBadge'
import { stockState } from './stockState'
import type { Shelf } from './shelves'

/** The home's product card: photo, name, price with its stock state (drawn over the photo), booth. */
export function HomeProductCard({ product, booth, currency, priority = false }: { product: Product; booth: Booth; currency: string; priority?: boolean }) {
  const sheetLink = useProductSheetLink()
  return (
    <Link className="product-card" {...sheetLink(product.id)}>
      <ProductImage product={product} size="large" priority={priority} />
      <span className="product-card__body">
        <span className="product-card__name">{product.name}</span>
        <span className="product-card__row">
          <span className="product-card__price">
            <span className="visually-hidden">, </span>
            {formatMoney(product.priceCents, currency)}
          </span>
          {stockState(product.availableQty) && (
            <>
              <span className="visually-hidden">, </span>
              <StockBadge qty={product.availableQty} />
            </>
          )}
        </span>
        <span className="product-card__booth">
          <span className="visually-hidden">, </span>
          {booth.vendorName}
        </span>
      </span>
    </Link>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

/** A Shop-style row: a title with See all, then cards that scroll sideways (snapping to each card). */
export function ProductShelf({
  shelf,
  boothsById,
  currency,
  eventSlug,
}: {
  shelf: Shelf
  boothsById: Map<string, Booth>
  currency: string
  eventSlug: string
}) {
  const headingId = `shelf-${shelf.id}`
  return (
    <section className={`shelf shelf--${shelf.id}`} aria-labelledby={headingId}>
      <div className="shelf__head">
        <h2 id={headingId}>{shelf.title}</h2>
        {shelf.seeAll && (
          <Link className="shelf__all" to={`/e/${eventSlug}${shelf.seeAll}`}>
            See all<span className="visually-hidden"> {shelf.title}</span>
            <ChevronIcon />
          </Link>
        )}
      </div>
      <ul className="shelf__track" role="list">
        {shelf.products.map((product) => {
          const booth = boothsById.get(product.boothId)
          if (!booth) return null
          return (
            <li key={product.id}>
              <HomeProductCard product={product} booth={booth} currency={currency} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
