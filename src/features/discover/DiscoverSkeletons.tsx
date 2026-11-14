import { Skeleton, SkeletonGroup, SkeletonText } from '../../shell/Skeleton'

/** Enough cards to fill a phone screen below the header; more would only scroll. */
const CARD_COUNT = 4
/** Two rows of three on a phone, one row wider. */
const TILE_COUNT = 6
const BOOTH_CARD_COUNT = 3

/** A product card: the photo, the name and price under it, and on a storefront the description line. */
function ProductCardSkeleton({ storefront = false }: { storefront?: boolean }) {
  return (
    <li>
      <span className="product-card">
        <Skeleton shape="card" className="skeleton--photo" />
        <span className="product-card__body">
          <SkeletonText lines={2} />
          {storefront && <Skeleton width="80%" height={20} />}
          <Skeleton width="40%" height={24} />
        </span>
      </span>
    </li>
  )
}

function ProductGridSkeleton({ className = '', storefront = false }: { className?: string; storefront?: boolean }) {
  return (
    <ul className={`product-grid ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: CARD_COUNT }, (_, i) => (
        <ProductCardSkeleton key={i} storefront={storefront} />
      ))}
    </ul>
  )
}

/** Cards a shelf placeholder shows: the first two and a peek of the third on a phone. */
const SHELF_CARD_COUNT = 4

/** The event home on its way, in the loaded layout: the title block on its wash, the search field,
    the featured slide, the category row, a shelf, then the first products. */
export function EventHomeSkeleton() {
  return (
    <SkeletonGroup label="Loading the event..." className="discover">
      <div className="discover__header">
        <Skeleton width="70%" height={40} className="skeleton--title" />
        <Skeleton width="40%" height={20} className="skeleton--venue" />
      </div>
      <Skeleton shape="pill" height={48} className="skeleton--field" />
      <div className="hero" aria-hidden="true">
        <ul className="hero__track">
          <li className="hero__slide">
            <Skeleton shape="card" className="skeleton--hero" />
          </li>
          <li className="hero__slide">
            <Skeleton shape="card" className="skeleton--hero" />
          </li>
        </ul>
      </div>
      <section className="home-section" aria-hidden="true">
        <Skeleton width="55%" height={28} className="skeleton--heading" />
        <ul className="category-tiles">
          {Array.from({ length: TILE_COUNT }, (_, i) => (
            <li key={i} className="category-tile">
              <Skeleton shape="card" className="skeleton--tile" />
              <Skeleton width="70%" height={20} />
            </li>
          ))}
        </ul>
      </section>
      <section className="shelf" aria-hidden="true">
        <Skeleton width="40%" height={28} className="skeleton--heading" />
        <ul className="shelf__track">
          {Array.from({ length: SHELF_CARD_COUNT }, (_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </ul>
      </section>
      <section className="home-section" aria-hidden="true">
        <Skeleton width="45%" height={28} className="skeleton--heading" />
        <ProductGridSkeleton />
      </section>
    </SkeletonGroup>
  )
}

/** A storefront on its way: the banner, the logo beside the name and slogan, the facts row, then its products. */
export function StorefrontSkeleton() {
  return (
    <SkeletonGroup label="Loading the booth..." className="storefront">
      {/* The same over-media header as the loaded storefront, so nothing shifts when it arrives. */}
      <div className="storefront__header" data-header="over-media">
        <Skeleton shape="control" className="storefront__banner" />
        <div className="storefront__identity">
          <span className="storefront__logo" />
          <div className="storefront__name storefront__name--loading">
            <Skeleton width="65%" height={28} />
            <Skeleton width="50%" height={20} />
          </div>
        </div>
        <Skeleton width="100%" height={42} />
      </div>
      <ProductGridSkeleton className="storefront__grid" storefront />
    </SkeletonGroup>
  )
}

/** The booths on their way, in the store cards' shape: the shop-type words, then cards with a banner, a name and a product row. */
export function BoothsSkeleton() {
  return (
    <SkeletonGroup label="Loading the booths..." className="booths-page">
      <div className="shop-switcher" aria-hidden="true">
        <Skeleton width={56} height={36} />
        <Skeleton width={200} height={36} />
      </div>
      <ul className="store-cards" aria-hidden="true">
        {Array.from({ length: BOOTH_CARD_COUNT }, (_, i) => (
          <li key={i}>
            <span className="store-card">
              <Skeleton shape="card" width="100%" height={112} className="store-card__banner" />
              <span className="store-card__text">
                <Skeleton width="55%" height={24} />
                <Skeleton width="75%" height={20} />
              </span>
              <span className="store-card__products store-card__products--3">
                {Array.from({ length: 3 }, (_, j) => (
                  <Skeleton key={j} shape="card" width="100%" height={96} />
                ))}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </SkeletonGroup>
  )
}

/** The map on its way: the heading, then the hall card's own shape: the plan, the zoom toolbar and the key. */
export function MapSkeleton() {
  return (
    <SkeletonGroup label="Loading the map..." className="map-page">
      <Skeleton width="45%" height={36} className="skeleton--title" />
      <div className="floor-map map-skeleton" aria-hidden="true">
        <span className="map-skeleton__plan">
          <Skeleton shape="card" className="map-skeleton__hall" />
        </span>
        <span className="floor-map__toolbar">
          <Skeleton width="55%" height={16} />
          <span className="floor-map__zoom">
            <Skeleton shape="circle" width={48} height={48} />
            <Skeleton shape="circle" width={48} height={48} />
          </span>
        </span>
        <span className="floor-map__legend">
          <Skeleton width="80%" height={16} />
        </span>
      </div>
    </SkeletonGroup>
  )
}
