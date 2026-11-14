import { Skeleton, SkeletonGroup } from '../../shell/Skeleton'

const PASS_COUNT = 2
const PAST_ROW_COUNT = 3
const ITEM_ROW_COUNT = 2
const STEP_COUNT = 3

/** The wallet on its way, in the rows' own shape: heading and Refresh, two open orders, then past orders. */
export function MyOrdersSkeleton() {
  return (
    <SkeletonGroup label="Loading your orders..." className="my-orders">
      <div className="my-orders__head" aria-hidden="true">
        <Skeleton width="55%" height={36} />
        <Skeleton shape="pill" width={104} height={40} />
      </div>
      <ul className="wallet" aria-hidden="true">
        {Array.from({ length: PASS_COUNT }, (_, i) => (
          <li key={i} className="wallet-stub">
            <span className="wallet-stub__top">
              <Skeleton shape="circle" width={40} height={40} className="wallet-stub__plate" />
              <Skeleton width="70%" height={20} className="wallet-stub__vendor" />
              <Skeleton width="55%" height={14} className="order-skeleton__gap wallet-stub__summary" />
              <Skeleton shape="pill" width={88} height={24} className="wallet-stub__pill" />
            </span>
            <span className="wallet-stub__bottom">
              <span className="wallet-stub__code-block">
                <Skeleton width="30%" height={14} />
                <Skeleton width="40%" height={24} className="order-skeleton__code" />
              </span>
              <Skeleton shape="plate" width={48} height={48} />
            </span>
          </li>
        ))}
      </ul>
      <div className="past-orders" aria-hidden="true">
        <Skeleton width="30%" height={20} />
        <ul className="past-orders__list">
          {Array.from({ length: PAST_ROW_COUNT }, (_, i) => (
            <li key={i}>
              <span className="past-order">
                <Skeleton shape="circle" width={40} height={40} className="wallet-stub__plate" />
                <Skeleton width="60%" height={20} className="past-order__name" />
                <Skeleton width="45%" height={14} className="order-skeleton__gap past-order__meta" />
                <Skeleton shape="pill" width={80} height={24} className="past-order__badge" />
              </span>
            </li>
          ))}
        </ul>
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
