import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { useOnlineStatus } from '../../shared/live'
import type { Order } from '../../shared/types'
import { formatMoney, orderStatusLabels, refusalLabels } from '../../shared/ui/labels'
import { attendeeOrderLabels, OPEN_STATUSES, canShowCode, codeWithheld } from './orderStatus'
import { OrderBoothLogo } from './OrderBoothLogo'
import { PickupMode, type PickupSlide } from './PickupMode'
import { PickupQr } from './PickupQr'
import { MyOrdersSkeleton } from './OrderSkeletons'
import { refreshMyOrders, retryMyOrders, useMyOrders } from './useMyOrders'
import { useNow } from './useNow'
import { useFirstEntrance } from '../../shell/useFirstEntrance'
import { usePullRefresh } from './usePullRefresh'

const itemCount = (o: Order) => o.items.reduce((n, i) => n + i.quantity, 0)
/** Long enough for a screen reader to notice that the same sentence was written again. */
const ANNOUNCE_GAP_MS = 100


const PENDING_HINT = 'Your pickup code appears once payment is confirmed.'
const WITHHELD_HINT = 'Checking the latest status.'

const itemSummary = (o: Order) =>
  `${itemCount(o)} ${itemCount(o) === 1 ? 'item' : 'items'}, ${formatMoney(o.totalCents, o.currency)}`

/** A row's second line: where to collect it, then what is in it. */
const rowSummary = (o: Order) => `Booth ${o.boothCode}, ${itemSummary(o)}`

/** The same line on screen, its amount in the price style (Gabarito, tabular figures). */
function RowSummary({ order: o }: { order: Order }) {
  const count = itemCount(o)
  return (
    <>
      Booth {o.boothCode}, {count} {count === 1 ? 'item' : 'items'}, <span className="price">{formatMoney(o.totalCents, o.currency)}</span>
    </>
  )
}

/** The refund's words when money is owed back or was paid back ("Refund due", "Refunded"), else null. */
const refundText = (o: Order) => (o.refundStatus === 'none' ? null : (attendeeOrderLabels(o).paymentBadge?.label ?? null))

/** One badge per past order: its status, with any refund folded in ("Cancelled, refund due"). */
const pastStatus = (o: Order) => [orderStatusLabels[o.status], refundText(o)?.toLowerCase()].filter(Boolean).join(', ')

function Chevron({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

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

/**
 * An open order as a wallet pass. With a code to hand over, the whole pass is one button
 * that opens pickup mode; otherwise (payment pending, or a saved copy past its hold whose
 * code waits for the server) it links to the order page and shows no code or QR. The
 * label reads the pass as one sentence; every visible word in it is in the label too.
 */
function WalletPass({
  order: o,
  showCode,
  withheld,
  onShow,
}: {
  order: Order
  /** `canShowCode` for this copy: the code and QR may be shown. */
  showCode: boolean
  withheld: boolean
  onShow: (e: MouseEvent<HTMLButtonElement>, id: string) => void
}) {
  const hint = o.status === 'pending_payment' ? PENDING_HINT : withheld ? WITHHELD_HINT : null
  const about = [`${o.boothName}, Booth ${o.boothCode}`, orderStatusLabels[o.status], itemSummary(o)].join(', ')
  const body = (
    <>
      <span className="wallet-stub__top">
        <OrderBoothLogo order={o} className="wallet-stub__plate" />
        <span className="wallet-stub__vendor">{o.boothName}</span>
        <span className="wallet-stub__summary">
          <RowSummary order={o} />
        </span>
        <span className={`wallet-badge wallet-badge--${o.status} wallet-stub__pill`}>{orderStatusLabels[o.status]}</span>
      </span>
      {showCode ? (
        <span className="wallet-stub__bottom">
          <span className="wallet-stub__code-block">
            <span className="wallet-stub__label">Pickup code</span>
            <span className="wallet-stub__code">{o.pickupCode}</span>
          </span>
          {/* A thumbnail for recognition only; pickup mode shows the scannable one. */}
          <span className="wallet-stub__qr-wrap" aria-hidden="true">
            <PickupQr code={o.pickupCode} className="wallet-stub__qr" />
          </span>
        </span>
      ) : (
        <span className="wallet-stub__bottom wallet-stub__bottom--hint">
          <span className="wallet-stub__hint">{hint}</span>
          <Chevron className="wallet-stub__chevron" />
        </span>
      )}
    </>
  )
  const className = `wallet-stub wallet-stub--${o.status}`
  return showCode ? (
    <button
      type="button"
      className={className}
      // Spelled out, so the code is read character by character, as staff will check it.
      aria-label={`Show at booth: ${about}, pickup code ${o.pickupCode.split('').join(' ')}`}
      onClick={(e) => onShow(e, o.id)}
    >
      {body}
    </button>
  ) : (
    <Link className={className} to={`/orders/${o.id}`} aria-label={`${about}. ${hint ?? ''}`.trim()}>
      {body}
    </Link>
  )
}

/** FR-16: this browser's orders across booths. */
export function MyOrders() {
  const online = useOnlineStatus()
  const now = useNow()
  // Opens from this browser's saved orders at once and refreshes quietly; the
  // "saved" note appears only if that refresh fails, runs long, or cannot run offline.
  const { orders, provisional, stale, failed } = useMyOrders()
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
  // The passes rise in the first time they show this session; never again on a tab return or Back.
  const openEntrance = useFirstEntrance('orders:open', (orders ?? []).some((o) => OPEN_STATUSES.includes(o.status)))
  const pastEntrance = useFirstEntrance('orders:past', (orders ?? []).some((o) => !OPEN_STATUSES.includes(o.status)))

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
  const past = orders.filter((o) => !OPEN_STATUSES.includes(o.status))
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

  return (
    <div className="my-orders">
      <div className="my-orders__head">
        <h1 className="my-orders__title" ref={headingRef} tabIndex={-1}>
          Your orders
        </h1>
        {/* Quiet, since pulling does the same: an icon button (WCAG 2.5.1's non-gesture way), its icon
            turning while it works; "Orders updated" is said through the status region below. */}
        <button
          type="button"
          className="my-orders__refresh"
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
        <>
          {open.length > 0 && (
            // A real heading, so the open orders are a stop in a screen reader's headings list.
            <section className="open-orders" aria-labelledby="open-orders-title">
              <h2 className="past-orders__title" id="open-orders-title">
                Open orders
              </h2>
              <ul className="wallet" role="list" aria-labelledby="open-orders-title" {...openEntrance}>
                {open.map((o) => (
                  <li key={o.id}>
                    <WalletPass
                      order={o}
                      showCode={canShowCode(o, provisional, now)}
                      withheld={codeWithheld(o, provisional, now)}
                      onShow={openPickup}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {past.length > 0 && (
            <section className="past-orders" aria-labelledby="past-orders-title">
              <h2 className="past-orders__title" id="past-orders-title">
                Past orders
              </h2>
              <ul className="past-orders__list" role="list" {...pastEntrance}>
                {past.map((o) => (
                  <li key={o.id}>
                    {/* Named as one sentence, like the open passes, so no hidden separators sit in the row's text. */}
                    <Link
                      className="past-order"
                      to={`/orders/${o.id}`}
                      aria-label={[o.boothName, rowSummary(o), pastStatus(o)].join(', ')}
                    >
                      <OrderBoothLogo order={o} className="wallet-stub__plate" />
                      <span className="past-order__name">{o.boothName}</span>
                      <span className="past-order__meta">
                        <RowSummary order={o} />
                      </span>
                      <span className={`wallet-badge wallet-badge--${o.refundStatus === 'due' ? 'refund_due' : o.status} past-order__badge`}>
                        {refundText(o) ?? orderStatusLabels[o.status]}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
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
