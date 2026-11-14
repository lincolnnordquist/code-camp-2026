import { Skeleton, SkeletonGroup, SkeletonText } from '../../shell/Skeleton'

/** Enough cards to fill a phone screen below the header; more would only scroll. */
const CARD_COUNT = 4
/** Two rows of three on a phone, one row wider. */
const TILE_COUNT = 6
const BOOTH_ROW_COUNT = 6

/** A product card: the square photo, the name and price under it, and on a storefront the Add button. */
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
      {storefront && (
        <span className="product-card__order">
          <Skeleton shape="pill" height={40} className="skeleton--button" />
        </span>
      )}
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

/** The event home on its way: the title block, the search field, the category tiles and the first products. */
export function EventHomeSkeleton() {
  return (
    <SkeletonGroup label="Loading the event..." className="discover">
      <div className="discover__header">
        <Skeleton width="70%" height={36} className="skeleton--title" />
        <Skeleton width="40%" height={20} className="skeleton--venue" />
      </div>
      <Skeleton height={56} className="skeleton--field" />
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
      <section className="home-section" aria-hidden="true">
        <Skeleton width="45%" height={28} className="skeleton--heading" />
        <ProductGridSkeleton />
      </section>
    </SkeletonGroup>
  )
}

/** A storefront on its way: the banner with the logo over its edge, the name, the slogan, the booth row, then its products. */
export function StorefrontSkeleton() {
  return (
    <SkeletonGroup label="Loading the booth..." className="storefront">
      {/* The same over-media header as the loaded storefront, so nothing shifts when it arrives. */}
      <div className="storefront__header" data-header="over-media">
        <Skeleton shape="control" className="storefront__banner" />
        <span className="storefront__logo">
          <Skeleton shape="circle" width={64} height={64} />
        </span>
        <Skeleton width="65%" height={32} />
        <Skeleton width="55%" height={20} />
        <div className="storefront__badges">
          <Skeleton width={64} height={20} />
          <Skeleton shape="pill" width={120} height={24} />
        </div>
      </div>
      <ProductGridSkeleton className="storefront__grid" storefront />
    </SkeletonGroup>
  )
}

/** The booth directory on its way: the heading, then cards of logo, name, code, slogan and mode. */
export function BoothsSkeleton() {
  return (
    <SkeletonGroup label="Loading the booths..." className="booths-page">
      <Skeleton width="40%" height={36} className="skeleton--title" />
      <ul className="directory" aria-hidden="true">
        {Array.from({ length: BOOTH_ROW_COUNT }, (_, i) => (
          <li key={i}>
            <span className="directory__row">
              <Skeleton shape="circle" width={40} height={40} />
              <span className="directory__text">
                <Skeleton width="60%" height={24} />
                <Skeleton width="80%" height={20} />
                <Skeleton shape="pill" width={112} height={24} />
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
