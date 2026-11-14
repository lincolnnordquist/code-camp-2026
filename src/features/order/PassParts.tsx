import { Link } from 'react-router-dom'
import type { Order } from '../../shared/types'
import { useBoothDetails, useBoothGone } from './boothDetails'
import { storefrontPath } from './orderExtras'

/**
 * The top of a pickup pass: the booth's banner as a soft strip, like the storefront header, so the
 * pass reads as that vendor's at a glance. Decorative; with no banner it is the quiet action tone.
 */
export function PassStrip({ bannerUrl, className = '' }: { bannerUrl?: string; className?: string }) {
  return (
    <div
      className={`pass-strip ${className}`.trim()}
      style={bannerUrl ? { backgroundImage: `url("${bannerUrl}")` } : undefined}
      aria-hidden="true"
    />
  )
}

/** The strip for an order: its booth's banner, once the event's booth details are read. */
export function OrderPassStrip({ order, className }: { order: Order; className?: string }) {
  return <PassStrip bannerUrl={useBoothDetails(order)?.bannerUrl} className={className} />
}

/** The perforation between a pass's header and its code: two half-circle notches and a dashed line. */
export function PassNotch() {
  return <div className="pass-notch" aria-hidden="true" />
}

/** The booth's storefront, unless the event is unknown here or its catalog no longer lists the booth. */
function useStorefrontPath(order: Order): string | null {
  const gone = useBoothGone(order)
  return gone ? null : storefrontPath(order)
}

/** The small chevron after a vendor name that leads to its storefront, shown only while there is one. Decorative. */
export function NameChevron({ order }: { order: Order }) {
  if (!useStorefrontPath(order)) return null
  return (
    <svg className="pass-name-chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * The vendor block (logo, name, booth) as one link to the storefront: an empty link stretched over
 * the block, so the h1 inside keeps its own heading and the link its own name, with no nesting.
 */
export function StorefrontLink({ order, onFollow }: { order: Order; onFollow?: () => void }) {
  const to = useStorefrontPath(order)
  if (!to) return null
  return (
    <Link
      className="pass-identity-link"
      to={to}
      aria-label={`${order.boothName} storefront, Booth ${order.boothCode}`}
      onClick={onFollow}
    />
  )
}
