import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { confirmCheckout, getOrder, getOrderByToken } from '../../shared/api'
import type { Order } from '../../shared/types'
import { useOnlineStatus } from '../../shared/live'
import { refusalLabels } from '../../shared/ui/labels'
import { OrderSkeleton } from './OrderSkeletons'
import { RetryButton } from './RetryButton'
import type { Refusal } from './orderStatus'
import { OrderView } from './OrderView'
import { LINK_POLL_MS, useLiveOrder, type LoadState, type Source } from './useLiveOrder'
import { usePullRefresh } from './usePullRefresh'

/** How often, and for how long, the private link re-reads while the payment webhook confirms the order. */
export const CHECKOUT_RETURN_POLL_MS = 3_000
export const CHECKOUT_RETURN_WINDOW_MS = 60_000

/**
 * On return from Square (`?checkout=return`) the session that placed the
 * order asks the server to verify the payment once. The return itself never
 * confirms anything (FR-12). The private link has no session, so it only
 * waits for the webhook (`awaitingWebhook`).
 */
function OrderScreen({
  state,
  setOrder,
  refresh,
  source,
  awaitingWebhook = false,
}: {
  state: LoadState
  setOrder: (o: Order) => void
  /** Re-reads the order; the shell's pull-to-refresh runs it. */
  refresh: () => Promise<boolean>
  source: Source
  awaitingWebhook?: boolean
}) {
  const [params, setParams] = useSearchParams()
  const [checking, setChecking] = useState(false)
  const [paymentRefusal, setPaymentRefusal] = useState<Refusal | null>(null)
  const online = useOnlineStatus()
  const checkedFor = useRef<string | null>(null)
  const mounted = useRef(true)
  const order = state.status === 'ready' ? state.order : null
  const returnedFromCheckout = params.has('checkout')
  usePullRefresh(refresh)
  // A retry that brings the order back replaces the error screen, and its button with it; focus goes
  // to the page's heading in the same commit, and the message under it says what happened otherwise.
  const [retries, setRetries] = useState(0)
  const focusedRetry = useRef(0)
  const announcerRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    if (retries === focusedRetry.current || state.status !== 'ready') return
    focusedRetry.current = retries
    // The announcer sits beside the page's content, so its parent holds this page's h1.
    const h1 = announcerRef.current?.parentElement?.querySelector<HTMLElement>('h1')
    if (h1) {
      h1.tabIndex = -1
      h1.focus()
    }
  }, [retries, state.status])
  const afterRetry = (ok: boolean) => {
    if (ok) setRetries((n) => n + 1)
    // Cleared, then set, so the same sentence is read again on a second failed try.
    const el = announcerRef.current
    if (!el) return
    el.textContent = ''
    el.textContent = ok ? 'Order updated' : 'Could not reach the server. Try again in a moment.'
  }
  const announcer = <p className="visually-hidden" role="status" ref={announcerRef} />

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (source !== 'mine') return
    if (!order || !returnedFromCheckout || order.status !== 'pending_payment' || checkedFor.current === order.id) return
    checkedFor.current = order.id
    // Cleared before the call: a router update after the attendee has left
    // this page would pull them back to it.
    setParams({}, { replace: true })
    setChecking(true)
    confirmCheckout(order.id)
      .then((r) => {
        if (!mounted.current) return
        if (r.ok) setOrder(r.value)
        else setPaymentRefusal({ reason: r.reason })
      })
      .catch(() => mounted.current && setPaymentRefusal({ reason: 'network' }))
      .finally(() => mounted.current && setChecking(false))
  }, [order, returnedFromCheckout, setOrder, setParams, source])

  const showBack = source === 'mine'
  if (state.status === 'loading') return <OrderSkeleton />
  if (state.status === 'error' && state.refusal.reason === 'order_not_found') {
    // The design's "link invalid" layout (OrderLinkInvalid). The private link has no session, so its
    // way on is the attendee's own orders or the event home; an in-app address gets the same ways on.
    const fromLink = source === 'link'
    return (
      <div className="order order-invalid">
        <section className="order-status">
          <h1 className="order-status__headline">{fromLink ? "This link doesn't open an order" : "We can't find this order"}</h1>
          <p className="order-status__line">
            {fromLink ? 'Check that you opened the whole link from your email.' : 'It may have been removed, or the link is wrong.'}
          </p>
        </section>
        <div className="order-invalid__actions">
          <Link className="order-button order-button--filled" to="/orders">
            Go to my orders
          </Link>
          <Link className="order-button order-button--outlined" to="/">
            Go to event home
          </Link>
        </div>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="screen-state">
        <h1 className="screen-state__message">{refusalLabels.network}</h1>
        <div className="order-invalid__actions">
          <RetryButton refresh={refresh} onDone={afterRetry} className="order-button order-button--filled" />
          {showBack && (
            <Link className="order-button order-button--outlined" to="/orders">
              Your orders
            </Link>
          )}
        </div>
        {announcer}
      </div>
    )
  }
  // A saved copy is shown at once; the note appears only if the refresh fails, runs long, or cannot run offline.
  const showNote = state.stale || (state.provisional && !online)
  const noteText = showNote
    ? source === 'mine'
      ? 'Showing your saved order. Its status may have changed since.'
      : 'Could not refresh. Status may have changed.'
    : null
  return (
    <>
      {noteText && (
        <div className="order-note">
          <p>{noteText}</p>
          <RetryButton refresh={refresh} onDone={afterRetry} className="order-note__retry" iconLabel="Refresh order" />
        </div>
      )}
      {announcer}
      <OrderView
        key={state.order.id}
        savedNote={noteText}
        order={state.order}
        onChange={setOrder}
        checkingPayment={checking || (awaitingWebhook && state.order.status === 'pending_payment')}
        paymentRefusal={paymentRefusal}
        allowCancel={source === 'mine'}
        provisional={state.provisional}
        onCheckPayment={refresh}
      />
    </>
  )
}

/** `/orders/:orderId`, an order placed in this browser. */
export function OrderPage() {
  const { orderId = '' } = useParams()
  const [state, replace, refresh] = useLiveOrder(getOrder, orderId, 'mine')
  return <OrderScreen state={state} setOrder={replace} refresh={refresh} source="mine" />
}

/**
 * `/o/:token`, the private link from the confirmation email (FR-18). Works on
 * any device. It does not offer cancelling, because the real
 * `cancelMyOrder` only accepts the session that placed the order.
 *
 * It is also Square's return address (`?checkout=return`): from the home
 * screen app, iOS opens Square in Safari, which has no session or saved order.
 * The page then re-reads quickly for a while as the webhook confirms the payment.
 */
export function OrderByTokenPage() {
  const { token = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const [awaitingWebhook, setAwaitingWebhook] = useState(() => params.has('checkout'))
  const [state, replace, refresh] = useLiveOrder(
    getOrderByToken,
    token,
    'link',
    awaitingWebhook ? CHECKOUT_RETURN_POLL_MS : LINK_POLL_MS,
  )
  const settled = state.status === 'error' || (state.status === 'ready' && state.order.status !== 'pending_payment')
  const returnFlag = params.has('checkout')

  // Cleared at once, so a reload does not restart the wait.
  useEffect(() => {
    if (returnFlag) setParams({}, { replace: true })
  }, [returnFlag, setParams])

  // The wait ends when the order leaves pending payment (set during render, so the fast poll stops
  // with this render), or after the window; either way the link goes back to its normal poll.
  if (awaitingWebhook && settled) setAwaitingWebhook(false)
  useEffect(() => {
    if (!awaitingWebhook) return
    const timer = setTimeout(() => setAwaitingWebhook(false), CHECKOUT_RETURN_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [awaitingWebhook])

  return <OrderScreen state={state} setOrder={replace} refresh={refresh} source="link" awaitingWebhook={awaitingWebhook && !settled} />
}
