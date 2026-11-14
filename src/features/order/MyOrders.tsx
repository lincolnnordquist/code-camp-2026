import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { useOnlineStatus } from '../../shared/live'
import { EventBanner } from '../../shared/ui/EventBanner'
import { refusalLabels } from '../../shared/ui/labels'
import { useOrderEvent } from './boothDetails'
import { NotCollected, YourHaul } from './OrderHistory'
import { OPEN_STATUSES, canShowCode, codeWithheld } from './orderStatus'
import { PickupMode, type PickupSlide } from './PickupMode'
import { MyOrdersSkeleton } from './OrderSkeletons'
import { WalletStack } from './WalletStack'
import { refreshMyOrders, retryMyOrders, useMyOrders } from './useMyOrders'
import { useNow } from './useNow'
import { usePullRefresh } from './usePullRefresh'

/** Long enough for a screen reader to notice that the same sentence was written again. */
const ANNOUNCE_GAP_MS = 100

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={spinning ? 'my-orders__refresh-icon is-spinning' : 'my-orders__refresh-icon'}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** FR-16: this browser's orders across booths. */
export function MyOrders() {
  const online = useOnlineStatus()
  const now = useNow()
  // Opens from this browser's saved orders at once and refreshes quietly; the
  // "saved" note appears only if that refresh fails, runs long, or cannot run offline.
  const { orders, provisional, stale, failed } = useMyOrders()
  const event = useOrderEvent(orders?.[0])
  const showNote = stale || (provisional && !online)
  // "Try again" unmounts while loading, so focus moves to whatever the retry produced.
  const focusResult = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const announcerRef = useRef<HTMLParagraphElement>(null)
  const refreshing = useRef<Promise<boolean> | null>(null)
  const [refreshBusy, setRefreshBusy] = useState(false)
  // Pickup mode: the orders it pages through, fixed when it opened, and the button that opened it.
  const [pickup, setPickup] = useState<{ ids: string[]; index: number } | null>(null)
  const pickupOpener = useRef<HTMLElement | null>(null)
  const returnFocus = useRef(false)

  useEffect(() => {
    if (!focusResult.current || (orders === null && !failed)) return
    focusResult.current = false
    headingRef.current?.focus()
  })

  useEffect(() => {
    if (!returnFocus.current || pickup) return
    returnFocus.current = false
    // The opener is gone if its order ended while pickup mode was open.
    const opener = pickupOpener.current
    ;(opener?.isConnected ? opener : headingRef.current)?.focus()
  })

  const announce = (text: string) => {
    const el = announcerRef.current
    if (!el) return
    el.textContent = ''
    setTimeout(() => {
      el.textContent = text
    }, ANNOUNCE_GAP_MS)
  }

  /** The Refresh button and the shell's pull-to-refresh share one request at a time. */
  const refresh = useCallback((): Promise<boolean> => {
    if (refreshing.current) return refreshing.current
    setRefreshBusy(true)
    const run = refreshMyOrders().then((ok) => {
      refreshing.current = null
      setRefreshBusy(false)
      announce(ok ? 'Orders updated' : 'Could not update your orders. Showing saved orders.')
      return ok
    })
    refreshing.current = run
    return run
  }, [])
  usePullRefresh(refresh)

  if (orders === null) {
    if (!failed) return <MyOrdersSkeleton />
    return (
      <div className="screen-state">
        <h1 className="screen-state__message" ref={headingRef} tabIndex={-1}>
          {online ? refusalLabels.network : "You're offline. Your orders will appear once you're back online."}
        </h1>
        <button
          type="button"
          className="button"
          onClick={() => {
            focusResult.current = true
            retryMyOrders()
          }}
        >
          Try again
        </button>
      </div>
    )
  }

  // Ready orders lead: they are the ones to walk over and collect now. The sort is stable,
  // so the rest keep the server's order, and pickup mode pages in this same order.
  const open = orders
    .filter((o) => OPEN_STATUSES.includes(o.status))
    .sort((a, b) => Number(b.status === 'ready') - Number(a.status === 'ready'))
  const savedNote = showNote ? 'Showing saved orders. Status may have changed since.' : null

  const openPickup = (e: MouseEvent<HTMLButtonElement>, id: string) => {
    const ids = open.filter((o) => canShowCode(o, provisional, now)).map((o) => o.id)
    pickupOpener.current = e.currentTarget
    setPickup({ ids, index: Math.max(ids.indexOf(id), 0) })
  }

  const slides: PickupSlide[] =
    pickup?.ids.map((id) => {
      const o = orders.find((x) => x.id === id) ?? null
      return { id, order: o, withheld: o !== null && codeWithheld(o, provisional, now) }
    }) ?? []

  // Quiet, since pulling does the same: an icon button (WCAG 2.5.1's non-gesture way), its icon
  // turning while it works; "Orders updated" is said through the status region.
  const refreshButton = (
    <button
      type="button"
      className={`my-orders__refresh${event ? ' my-orders__refresh--on-banner' : ''}`}
      aria-label="Refresh orders"
      // aria-disabled, not disabled, so focus stays on the button while it works or goes offline.
      aria-disabled={refreshBusy || !online}
      aria-busy={refreshBusy}
      onClick={() => {
        if (online) void refresh()
      }}
    >
      <RefreshIcon spinning={refreshBusy} />
    </button>
  )

  return (
    <div className="my-orders">
      {event && <EventBanner name={event.name} venue={event.venueName} action={refreshButton} />}
      <div className="my-orders__head">
        <h1 className="headline-medium my-orders__title" ref={headingRef} tabIndex={-1}>
          Orders
        </h1>
        {open.length > 0 && <span className="body-medium my-orders__count">{open.length} open</span>}
        {!event && refreshButton}
      </div>
      <p className="visually-hidden" role="status" ref={announcerRef} />
      {savedNote && <p className="my-orders__note">{savedNote}</p>}
      {orders.length === 0 ? (
        <div className="wallet-empty">
          <p>Nothing reserved yet.</p>
          <Link className="order-button order-button--filled wallet-empty__action" to="/">
            Browse the event
          </Link>
        </div>
      ) : (
        <div className={`orders-layout${open.length > 0 ? ' orders-layout--with-wallet' : ''}`}>
          {open.length > 0 && (
            <section className="orders-wallet" aria-labelledby="open-orders-title">
              <h2 className="visually-hidden" id="open-orders-title">
                Open orders
              </h2>
              <WalletStack
                orders={open}
                showCode={(o) => canShowCode(o, provisional, now)}
                withheld={(o) => codeWithheld(o, provisional, now)}
                onShow={openPickup}
              />
            </section>
          )}
          <div className="orders-layout__side">
            <YourHaul orders={orders} />
            <NotCollected orders={orders} />
          </div>
        </div>
      )}
      {pickup && slides.length > 0 && (
        <PickupMode
          slides={slides}
          initialIndex={pickup.index}
          note={savedNote}
          detailsLink
          onClose={() => {
            returnFocus.current = true
            setPickup(null)
          }}
        />
      )}
    </div>
  )
}
