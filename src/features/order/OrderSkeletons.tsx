import { Skeleton, SkeletonGroup } from '../../shell/Skeleton'

const BACK_STRIP_COUNT = 2
const PAST_ROW_COUNT = 3
const ITEM_ROW_COUNT = 2
const STEP_COUNT = 3

/** The wallet on its way, in its own shape: heading and Refresh, two pass strips over a front pass, then the history rows. */
export function MyOrdersSkeleton() {
  return (
    <SkeletonGroup label="Loading your orders..." className="my-orders">
      <div className="my-orders__head" aria-hidden="true">
        <Skeleton width="40%" height={36} />
        <Skeleton shape="pill" width={48} height={48} />
      </div>
      <div className="orders-layout orders-layout--with-wallet" aria-hidden="true">
        <div className="wallet-stack" style={{ height: BACK_STRIP_COUNT * 56 + 290 }}>
          {Array.from({ length: BACK_STRIP_COUNT + 1 }, (_, i) => (
            <span key={i} className="wallet-stack__placeholder" style={{ top: i * 56, height: i === BACK_STRIP_COUNT ? 290 : 76 }}>
              <Skeleton shape="card" width="100%" height="100%" />
            </span>
          ))}
        </div>
        <div className="orders-layout__side">
          <div className="orders-section">
            <Skeleton width="35%" height={28} />
            <ul className="ended-orders">
              {Array.from({ length: PAST_ROW_COUNT }, (_, i) => (
                <li key={i}>
                  <Skeleton shape="card" width="100%" height={80} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </SkeletonGroup>
  )
}

/** One order on its way, in the order page's shape: vendor row, headline, code card, details, items. */
export function OrderSkeleton() {
  return (
    <SkeletonGroup label="Loading your order..." className="order">
      {/* The pass's own shape: strip, logo and name, status and tracker, perforation, code. */}
      <div className="order-pass" aria-hidden="true">
        <span className="pass-strip" />
        <div className="order-pass__head">
          <Skeleton shape="circle" width={64} height={64} className="order-pass__logo" />
          <span className="order-pass__vendor">
            <Skeleton width="55%" height={16} />
            <Skeleton width="25%" height={12} className="order-skeleton__gap" />
          </span>
        </div>
        {/* Neutral blocks only: a coloured bar would read as a status before there is one. */}
        <div className="order-status">
          <Skeleton width="75%" height={28} />
          <Skeleton width="90%" height={16} />
          <ol className="order-steps">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <li key={i}>
                <span className="order-steps__bar" />
                <Skeleton width="70%" height={16} />
              </li>
            ))}
          </ol>
        </div>
        <span className="pass-notch" />
        <span className="order-code__body">
          <Skeleton width={80} height={16} />
          <Skeleton width={120} height={44} />
        </span>
        <span className="order-pass__end" />
      </div>
      <Skeleton shape="card" height={160} className="order-skeleton__card" />
      <div className="order-items" aria-hidden="true">
        <Skeleton width="20%" height={16} />
        <ul>
          {Array.from({ length: ITEM_ROW_COUNT }, (_, i) => (
            <li key={i} className="order-item">
              <Skeleton shape="card" width={48} height={48} />
              <Skeleton width={28} height={24} />
              <Skeleton width="70%" />
              <Skeleton width={56} />
            </li>
          ))}
        </ul>
      </div>
    </SkeletonGroup>
  )
}
