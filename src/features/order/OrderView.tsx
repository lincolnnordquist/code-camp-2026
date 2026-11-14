import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { cancelMyOrder, getOrder } from '../../shared/api'
import { useOnlineStatus } from '../../shared/live'
import type { Order } from '../../shared/types'
import { formatMoney, orderStatusLabels, refusalLabels } from '../../shared/ui/labels'
import { BoothLogo } from '../../shared/ui/BoothLogo'
import { ProductImage } from '../../shared/ui/ProductImage'
import { CancelSheet } from './CancelSheet'
import { forgetCheckoutUrl, readCheckoutUrl } from './checkoutLinks'
import { HoldTimer, formatClock } from './HoldTimer'
import { useBoothDetails, useBoothGone, useCatalogProduct } from './boothDetails'
import { orderEventSlug } from './orderExtras'
import { attendeeOrderLabels, FINAL_STATUSES, PICKUP_STATUSES, cancelledByAttendee, codeWithheld, type Refusal } from './orderStatus'
import { useFirstEntrance } from '../../shell/useFirstEntrance'
import { NameChevron, PassNotch, PassStrip, StorefrontLink } from './PassParts'
import { PickupMode } from './PickupMode'
import { RetryButton } from './RetryButton'
import { useNow } from './useNow'

/** Where focus goes after the next render, because the control that had it was replaced. */
type FocusTarget = 'question' | 'opener' | 'status' | 'error' | 'pickup'

const WITHHELD_LINE = 'The hold time has passed. Checking the latest status.'

/** How long the code card takes to fold away once the order no longer has a code to show. */
const CODE_COLLAPSE_MS = 300

/** The progress bar's steps, in the status badges' words; an order shows it only while it is on this path. */
const STEPS = (['confirmed', 'ready', 'collected'] as const).map((status) => ({ status, label: orderStatusLabels[status] }))

/** True while the device asks for reduced motion; follows changes to the setting. */
function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduce, setReduce] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const list = window.matchMedia?.(query)
    if (!list?.addEventListener) return
    const onChange = () => setReduce(list.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [])
  return reduce
}

/** True while the page is visible; the tracker's loops pause while it is hidden, to save battery. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

function StepCheck() {
  return (
    <svg className="order-steps__check" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M4 8.5l2.5 2.5L12 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
    </svg>
  )
}

/**
 * The live progress tracker (Confirmed, Ready, Collected). The current step's marker breathes and a
 * shimmer runs toward the next step; reaching a step fills its bar and pops its marker once, and
 * Collected draws a check. All of it is decoration: the hidden step sentence above it and the page's
 * live region say what changed. With reduced motion every change is instant.
 */
function StepTracker({ status }: { status: Order['status'] }) {
  const reduce = useReducedMotion()
  const visible = usePageVisible()
  const index = STEPS.findIndex((s) => s.status === status)
  // The step reached while the page was open; the first render is the page's starting state, not an arrival.
  const [arrived, setArrived] = useState<Order['status'] | null>(null)
  const shown = useRef(status)
  useEffect(() => {
    if (shown.current === status) return
    shown.current = status
    setArrived(status)
  }, [status])
  const done = status === 'collected'
  const live = !reduce && !done
  const className = [
    'order-steps',
    `order-steps--${status}`,
    live && 'order-steps--live',
    !reduce && arrived === status && 'order-steps--arrived',
    !visible && 'order-steps--paused',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <ol className={className} aria-hidden="true">
      {STEPS.map((s, i) => (
        <li key={s.status} className={i === index ? (done ? 'is-current is-done' : 'is-current') : i < index ? 'is-done' : undefined}>
          <span className="order-steps__bar">
            <span className="order-steps__fill" />
          </span>
          <span className="order-steps__label">
            <span className="order-steps__dot">{i <= index && (i < index || done) && <StepCheck />}</span>
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * The sentence under the status headline, also read out when a pushed change
 * arrives. The order records no cancel time, so that one says what happened
 * without it.
 */
function statusDetail(order: Order): string | null {
  const noun = order.type === 'prepaid' ? 'order' : 'reservation'
  const holdEnd = order.holdEndsAt ? formatClock(order.holdEndsAt) : null
  switch (order.status) {
    case 'confirmed':
      return "We'll update this when it's ready."
    case 'ready':
      return `Show this code at Booth ${order.boothCode}.`
    case 'collected':
      return `Handed over at Booth ${order.boothCode}${order.collectedAt ? ` at ${formatClock(order.collectedAt)}` : ''}.`
    case 'cancelled':
      if (cancelledByAttendee(order)) return `You cancelled this ${noun}.`
      // A vendor cancel always carries a reason (FR-23); without one, who cancelled is unknown.
      return order.cancelReason ? `${order.boothName} cancelled this ${noun}.` : `This ${noun} was cancelled.`
    case 'expired':
      if (order.type === 'prepaid') {
        // A prepaid order expires before checkout finished (FR-14); a refund means the payment came late.
        if (order.refundStatus !== 'none') {
          return holdEnd ? `The hold ended at ${holdEnd}. Your payment arrived after that.` : 'Your payment arrived after the hold ended.'
        }
        return "The payment wasn't completed before the hold ended, so the items went back on sale. You weren't charged."
      }
      return holdEnd ? `The hold ended at ${holdEnd} before pickup.` : 'The hold ended before pickup.'
    default:
      return null
  }
}

/** The hold's length is not part of the order, so the sentence leaves it to the countdown below. */
const PENDING_LINE = 'Your items are held while you pay with Square.'

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** One item: its photo (from the event's catalog once read, else the neutral tile), the quantity, the name, the line price. */
function OrderItemRow({ item, currency }: { item: Order['items'][number]; currency: string }) {
  const product = useCatalogProduct(item.productId)
  return (
    <li className="order-item">
      <span className="order-item__photo" aria-hidden="true">
        {product ? <ProductImage product={product} size="small" eager /> : <span className="product-image product-image--small product-image--frame" />}
      </span>
      <span className="order-item__qty" aria-hidden="true">
        {item.quantity}×
      </span>
      <span className="order-item__name">
        <span className="visually-hidden">{item.quantity} × </span>
        {item.name}
      </span>
      <span className="order-item__price price">{formatMoney(item.quantity * item.unitPriceCents, currency)}</span>
    </li>
  )
}

function QrIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface OrderViewProps {
  order: Order
  onChange: (order: Order) => void
  /** Shown while a prepaid order waits for the server's payment check. */
  checkingPayment?: boolean
  paymentRefusal?: Refusal | null
  /** Only the session that placed a reservation may cancel it (FR-10). */
  allowCancel?: boolean
  /**
   * Shown from the saved copy before the server confirmed it. Until then
   * nothing can be cancelled, and a hold that has run out shows no pickup code.
   */
  provisional?: boolean
  /** The "saved copy" note, repeated in pickup mode because the page behind it is hidden. */
  savedNote?: string | null
  /** Re-reads the order; offered as "Check payment" when a pending payment has no link to go back to. */
  onCheckPayment?: () => Promise<boolean>
}

/** FR-17: everything the attendee needs to collect one order (design: design/order-page). */
export function OrderView({
  order,
  onChange,
  checkingPayment = false,
  paymentRefusal = null,
  allowCancel = true,
  provisional = false,
  savedNote = null,
  onCheckPayment,
}: OrderViewProps) {
  const online = useOnlineStatus()
  const booth = useBoothDetails(order)
  // A booth that has left the event has no spot on the map to find.
  const boothGone = useBoothGone(order)
  const itemsEntrance = useFirstEntrance(`order:${order.id}:items`, order.items.length > 0)
  const eventSlug = orderEventSlug(order)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  // Set at once, unlike `cancelling`: two clicks in one task both see the old state, so only this stops a second request.
  const cancelInFlight = useRef(false)
  const [cancelError, setCancelError] = useState<Refusal | null>(null)
  const pendingFocus = useRef<FocusTarget | null>(null)
  const questionRef = useRef<HTMLHeadingElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)
  const statusRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const pickupOpenerRef = useRef<HTMLButtonElement>(null)
  const [pickupOpen, setPickupOpen] = useState(false)
  const announcerRef = useRef<HTMLParagraphElement>(null)
  const announced = useRef({ status: order.status, refund: order.refundStatus })
  // Whether focus was last inside the cancel controls, so a push that removes them can recover it.
  const focusInCancel = useRef(false)
  const isFinal = FINAL_STATUSES.includes(order.status)
  // Cancelled or expired: the pass is muted. Collected is a receipt, not muted.
  const ended = isFinal && order.status !== 'collected'
  // Once the hold ends the server is closing the Square link (FR-14), so it is no longer offered.
  const now = useNow()
  const holdOver = order.holdEndsAt !== null && Date.parse(order.holdEndsAt) <= now
  // A saved copy past its hold may already be expired or collected, so its code is withheld until the server answers.
  const awaitingStatus = codeWithheld(order, provisional, now) && PICKUP_STATUSES.includes(order.status)
  const canPickUp = PICKUP_STATUSES.includes(order.status) && !awaitingStatus
  // FR-10: either kind of order, while confirmed or ready; a prepaid one becomes refund due.
  // A saved copy (offline, or before the first read) shows Cancel too, off, with the reason.
  const canCancel = allowCancel && canPickUp
  const cancelBlocked = !online || provisional
  const cancelReason = !online ? "You're offline. Connect to cancel." : provisional ? 'Checking the latest status first.' : null
  const cancelLabel = order.type === 'prepaid' ? 'Cancel order' : 'Cancel reservation'
  const checkoutUrl = order.status === 'pending_payment' && !holdOver ? readCheckoutUrl(order.id) : null
  // Without the link (another session, another device) the payment is finished in Square's own tab.
  const noLinkLine =
    order.status === 'pending_payment' && !holdOver && !checkoutUrl && order.holdEndsAt
      ? `Finish paying in the Square tab, or this order is released at ${formatClock(order.holdEndsAt)}.`
      : null
  useEffect(() => {
    if (order.status !== 'pending_payment') forgetCheckoutUrl(order.id)
  }, [order.id, order.status])
  const labels = attendeeOrderLabels(order)
  const headline = labels.headline
  const detail = statusDetail(order)
  const refund = labels.refundBanner
  // Square sent the attendee back without a verified payment: usually they left the payment page unpaid.
  const unpaidReturn = paymentRefusal?.reason === 'payment_not_verified'
  const pendingText = unpaidReturn
    ? checkoutUrl
      ? 'Payment not completed yet. You can continue to payment while the hold lasts.'
      : 'Payment not completed yet.'
    : paymentRefusal
      ? refusalLabels[paymentRefusal.reason]
      : PENDING_LINE
  const stepIndex = STEPS.findIndex((s) => s.status === order.status)
  // The payment line; the badge beside it is the label module's, absent where it would repeat the line.
  const payment = labels.attendeePayment
  // A collected reservation's badge would repeat its sentence ("Paid at the booth").
  const paymentBadge = labels.paymentBadge?.label ?? null
  // The attendee's own cancel is said by the status line; its recorded reason would only repeat it.
  const reasonRow = order.status === 'cancelled' && order.cancelReason && !cancelledByAttendee(order) ? order.cancelReason : null
  const holdEndedRow = order.status === 'expired' ? order.holdEndsAt : null
  // The countdown follows the code: a saved copy past its hold shows neither until the server answers.
  const holdRow =
    order.holdEndsAt !== null &&
    !awaitingStatus &&
    (order.status === 'pending_payment' || (order.type === 'reservation' && canPickUp))
      ? order.holdEndsAt
      : null
  const showInstructions = !isFinal && order.status !== 'pending_payment' && Boolean(booth?.pickupInstructions)
  // When the code goes (collected, expired, cancelled) the card folds away instead of vanishing, so
  // the content below moves up gently. With reduced motion it goes at once.
  const reduceMotion = useReducedMotion()
  const [codeLeaving, setCodeLeaving] = useState(false)
  const hadCode = useRef(canPickUp)
  useEffect(() => {
    const had = hadCode.current
    hadCode.current = canPickUp
    if (!had || canPickUp || reduceMotion) return
    // The card is about to become inert; focus on it moves to the status headline, which says why.
    if (pickupOpenerRef.current === document.activeElement) statusRef.current?.focus()
    setCodeLeaving(true)
    const timer = setTimeout(() => setCodeLeaving(false), CODE_COLLAPSE_MS)
    return () => clearTimeout(timer)
  }, [canPickUp, reduceMotion])
  // Payment now sits with the items' summary, beside the total.
  const hasDetails = reasonRow !== null || holdEndedRow !== null || holdRow !== null || showInstructions

  // Layout effects, so focus moves in the same commit that removes or replaces the focused control,
  // never a task later: in between, focus sat on <body> (and a test or a screen reader could read it).
  // Declared before the focus effect, which clears `pendingFocus`.
  useLayoutEffect(() => {
    const previous = announced.current
    if (previous.status === order.status && previous.refund === order.refundStatus) return
    announced.current = { status: order.status, refund: order.refundStatus }
    // The region only ever holds what is still true: a change that is not announced here (the
    // headline is focused instead) clears the previous sentence, which a screen reader could
    // otherwise still find in the page. Clearing is silent.
    const region = announcerRef.current
    if (region) region.textContent = ''
    // The cancel flow focuses the status headline, which reads it out; announcing too would say it twice.
    if (pendingFocus.current) return
    const focusLost = !document.activeElement || document.activeElement === document.body
    if (focusLost && focusInCancel.current) {
      focusInCancel.current = false
      statusRef.current?.focus()
      return
    }
    // Written directly so the region stays mounted and only changes when a pushed change arrives.
    const statusText = [headline, detail].filter(Boolean).join('. ')
    const text = previous.status !== order.status ? statusText : refund ? `${refund.title} ${refund.body}` : ''
    if (region && text) region.textContent = text
  }, [order.status, order.refundStatus, headline, detail, refund])

  useLayoutEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    focusInCancel.current = target === 'question' || target === 'opener'
    const refs = { question: questionRef, opener: openerRef, status: statusRef, error: errorRef, pickup: pickupOpenerRef }
    // The pickup opener is gone (or folding away, inert) if the order ended while pickup mode was open; the status says why.
    const el = target === 'pickup' && !canPickUp ? null : refs[target].current
    ;(el ?? statusRef.current)?.focus()
  })

  const openSheet = () => {
    if (cancelBlocked) return
    pendingFocus.current = 'question'
    setConfirmCancel(true)
  }

  const keepIt = () => {
    pendingFocus.current = 'opener'
    setConfirmCancel(false)
  }

  async function cancel() {
    if (cancelInFlight.current || !online) return
    cancelInFlight.current = true
    setCancelling(true)
    setCancelError(null)
    const r = await cancelMyOrder(order.id).catch(() => null)
    cancelInFlight.current = false
    setCancelling(false)
    setConfirmCancel(false)
    if (r?.ok) {
      // The sheet is gone, so the status headline says what happened.
      pendingFocus.current = 'status'
      onChange(r.value)
      return
    }
    // The refusal is read once from focus; the refreshed status below is then announced on its own.
    pendingFocus.current = 'error'
    setCancelError({ reason: r ? r.reason : 'network' })
    // A refusal usually means the order moved on (collected, expired), so show its current state.
    if (r) {
      const latest = await getOrder(order.id).catch(() => null)
      if (latest?.ok) onChange(latest.value)
    }
  }

  return (
    <div className="order">
      {/* Kept apart from the headline, so a change is announced once and never as the focus target. */}
      <p className="visually-hidden" aria-live="polite" aria-atomic="true" ref={announcerRef} />

      {/* The order as one pass, in every state (design: OrderReady, OrderCollected, ...): the vendor's
          strip and logo, its name, the status and tracker; below a perforation, the code while it can
          be collected, a receipt stamp once it was, or the outcome when it ended. */}
      <article className={`order-pass${ended ? ' order-pass--ended' : ''}`}>
        <PassStrip bannerUrl={booth?.bannerUrl} />
        <div className="order-pass__head">
          {/* Logo, name and booth lead to the storefront: one link stretched over the block. */}
          <div className="order-pass__id pass-identity">
            <BoothLogo booth={{ code: order.boothCode, logoUrl: booth?.logoUrl ?? '' }} size="lg" className="order-pass__logo" />
            <div className="order-pass__vendor">
              <h1 className="order-vendor__name">
                {/* The space stays outside the hidden span, where every name computation keeps it. */}
                <span className="visually-hidden">Order from</span> {order.boothName}
                <NameChevron order={order} />
              </h1>
              <p className="order-vendor__booth">Booth {order.boothCode}</p>
            </div>
            <StorefrontLink order={order} />
          </div>
          {eventSlug && !boothGone && (
            <Link
              className={`order-find${order.status === 'collected' ? ' order-find--quiet' : ''}`}
              to={`/e/${eventSlug}/map?booth=${order.boothId}`}
            >
              <MapIcon />
              Find booth<span className="visually-hidden">: Booth {order.boothCode}</span>
            </Link>
          )}
        </div>

        <section className="order-status">
          <h2 className="order-status__headline" ref={statusRef} tabIndex={-1}>
            {headline}
          </h2>
          {order.status === 'pending_payment' ? (
            // Live while the payment is checked; the countdown sits outside it, so its ticks are silent.
            <p className="order-status__line" aria-live="polite">
              {checkingPayment ? 'Checking your payment...' : pendingText}
            </p>
          ) : (
            // Collected: the stamp below says when and where, so the line would repeat it.
            order.status !== 'collected' && <p className="order-status__line">{awaitingStatus ? WITHHELD_LINE : detail}</p>
          )}
          {stepIndex >= 0 && (
            <>
              <p className="visually-hidden">
                Step {stepIndex + 1} of {STEPS.length}: {STEPS[stepIndex].label}
              </p>
              <StepTracker status={order.status} />
            </>
          )}
        </section>

        {(canPickUp || codeLeaving) && (
          // The design's code card, made the way into pickup mode, where the scannable QR is.
          <div className={`order-code-slot${canPickUp ? '' : ' is-leaving'}`} inert={!canPickUp} aria-hidden={canPickUp ? undefined : true}>
            <div className="order-code-slot__inner">
              {/* The pass's lower part: a perforation, the code, then the way into pickup mode. */}
              <div className="order-code">
                <PassNotch />
                <div className="order-code__body">
                  <p className="order-code__label" aria-hidden="true">
                    Pickup code
                  </p>
                  {/* Spelled out for screen readers, so the code is read character by character, as staff check it. */}
                  <p className="visually-hidden">
                    Pickup code {order.pickupCode.split('').join(' ')}
                  </p>
                  <p className="order-code__value" aria-hidden="true">
                    {order.pickupCode}
                  </p>
                </div>
                {/* The name starts with the visible words, so voice control finds it; a hidden span's
                    punctuation is spaced differently by different name computations. */}
                <button
                  ref={pickupOpenerRef}
                  type="button"
                  className="order-code__action"
                  aria-label="Show code at booth, full screen"
                  onClick={() => setPickupOpen(true)}
                >
                  <QrIcon />
                  Show code at booth
                </button>
                <span className="order-code__end" />
              </div>
            </div>
          </div>
        )}

        {order.status === 'collected' && (
          <>
            <PassNotch />
            <div className="order-pass__stamp">
              <span className="order-pass__stamp-icon" aria-hidden="true">
                <CheckIcon />
              </span>
              <div>
                <p className="order-pass__stamp-title">
                  {orderStatusLabels.collected}
                  {order.collectedAt ? ` at ${formatClock(order.collectedAt)}` : ''}
                </p>
                <p className="order-pass__stamp-detail">Booth {order.boothCode}</p>
              </div>
            </div>
          </>
        )}

        {refund && order.status !== 'collected' && (
          <>
            <PassNotch />
            <div className="order-pass__outcome">
              <div className={`order-banner order-banner--${order.refundStatus}`}>
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
                  {/* A tick once the money is back; an alert while it is still owed. */}
                  <path
                    d={order.refundStatus === 'refunded' ? 'M8 12.5l2.5 2.5L16 9.5' : 'M12 7.5v5M12 16.5h.01'}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <p>
                  <strong>{refund.title}</strong> {refund.body}
                </p>
              </div>
            </div>
          </>
        )}
        <span className="order-pass__end" />
      </article>

      {hasDetails && (
        <dl className="order-details">
          {reasonRow && (
            <div>
              <dt>Reason</dt>
              <dd>{reasonRow}</dd>
            </div>
          )}
          {holdEndedRow && (
            <div>
              <dt>Hold ended</dt>
              <dd>
                <time dateTime={holdEndedRow}>{formatClock(holdEndedRow)}</time>
              </dd>
            </div>
          )}
          {holdRow && (
            <div>
              <dt>Held until</dt>
              <dd>
                <HoldTimer endsAt={holdRow} />
              </dd>
            </div>
          )}
          {showInstructions && (
            <div>
              <dt>Pickup instructions</dt>
              <dd>{booth?.pickupInstructions}</dd>
            </div>
          )}
        </dl>
      )}

      {!checkingPayment && checkoutUrl && (
        <a className="order-button order-button--filled" href={checkoutUrl}>
          Continue to payment
        </a>
      )}

      {!checkingPayment && noLinkLine && (
        <div className="order-pay-elsewhere">
          <p>{noLinkLine}</p>
          {onCheckPayment && (
            <RetryButton
              refresh={onCheckPayment}
              className="order-button order-button--outlined"
              label="Check payment"
              busyLabel="Checking payment..."
            />
          )}
        </div>
      )}

      <section className="order-items" aria-labelledby="order-items-title">
        <h2 id="order-items-title">Items</h2>
        <ul role="list" {...itemsEntrance}>
          {order.items.map((i) => (
            <OrderItemRow key={i.productId} item={i} currency={order.currency} />
          ))}
        </ul>
        <dl className="order-summary">
          {payment && (
            <div>
              <dt className="order-details__label-row">
                <span>Payment</span>
                {paymentBadge && <span className="order-badge">{paymentBadge}</span>}
              </dt>
              <dd className="price">{payment}</dd>
            </div>
          )}
          <div className="order-summary__total">
            <dt>Total</dt>
            <dd className="price">{formatMoney(order.totalCents, order.currency)}</dd>
          </div>
        </dl>
      </section>

      {order.status === 'collected' && eventSlug && (
        <Link className="order-button order-button--tonal" to={`/e/${eventSlug}/booth/${order.boothId}`}>
          Order again from {order.boothName}
        </Link>
      )}

      {/* Outside the cancel controls: a refusal often means the order moved on and they are gone. */}
      {/* Focused when it appears, which reads it once; role="alert" as well would read it twice. */}
      {cancelError && (
        <p className="order-error" ref={errorRef} tabIndex={-1}>
          {refusalLabels[cancelError.reason]}
        </p>
      )}

      {pickupOpen && (
        <PickupMode
          slides={[{ id: order.id, order, withheld: awaitingStatus }]}
          note={savedNote}
          onClose={() => {
            pendingFocus.current = 'pickup'
            setPickupOpen(false)
          }}
        />
      )}

      {canCancel && (
        // React events bubble through the sheet's portal, so this also sees focus inside the sheet.
        <div
          className="order-actions"
          onFocus={() => {
            focusInCancel.current = true
          }}
          onBlur={(e) => {
            // Removing the focused control blurs with no target; only a move elsewhere clears the flag.
            if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) focusInCancel.current = false
          }}
        >
          <button
            ref={openerRef}
            type="button"
            className="order-button order-button--destructive"
            // aria-disabled instead of disabled, so focus stays on the button when the device goes offline.
            aria-disabled={cancelBlocked}
            aria-describedby={cancelReason ? 'cancel-blocked-reason' : undefined}
            onClick={openSheet}
          >
            {cancelLabel}
          </button>
          {cancelReason && (
            <p className="order-actions__reason" id="cancel-blocked-reason">
              {cancelReason}
            </p>
          )}
          {confirmCancel && (
            <CancelSheet
              vendorName={order.boothName}
              prepaid={order.type === 'prepaid'}
              titleRef={questionRef}
              cancelling={cancelling}
              online={online}
              onConfirm={() => void cancel()}
              onKeep={keepIt}
            />
          )}
        </div>
      )}
      {/* The order's reference and when it was placed, for a question at the booth. */}
      <p className="order-meta">
        Order {order.id.slice(-6).toUpperCase()} · Placed {formatClock(order.createdAt)}
      </p>
    </div>
  )
}
