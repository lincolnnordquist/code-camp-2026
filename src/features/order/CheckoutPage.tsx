import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createReservation, getEventCatalog, startCheckout } from '../../shared/api'
import { useOnlineStatus } from '../../shared/live'
import { formatMoney, refusalLabels } from '../../shared/ui/labels'
import { BoothLogo } from '../../shared/ui/BoothLogo'
import { EmptyCart } from './CartPage'
import {
  applyCaps,
  capLines,
  capsFor,
  cartTotal,
  clearCart,
  rememberLastOrder,
  useCart,
  type CartItem,
  type ItemCaps,
} from './cartStore'
import { rememberCheckoutUrl } from './checkoutLinks'
import { useFirstEntrance } from '../../shell/useFirstEntrance'
import { announceIn } from './announce'
import { withDeadline } from './deadline'
import { cacheOrders } from './orderCache'
import type { Refusal } from './orderStatus'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/


/**
 * A reserve or checkout that has not answered by then is shown as a network
 * failure. Retrying is safe: the request id returns the first order (FR-08).
 */
export const SUBMIT_TIMEOUT_MS = 15_000

/** How long a refused order waits for the current stock before naming the items without it. */
export const STOCK_LOOKUP_TIMEOUT_MS = 3_000

const STOCK_REFUSALS: Refusal['reason'][] = ['insufficient_stock', 'over_max_per_order']

/** A line with nothing left: removed when the cart is adjusted. */
const NONE_LEFT: ItemCaps = { maxPerOrder: 0, stockQty: 0 }

/** The current caps of each named product, or null when the catalog cannot be read. */
async function currentLimits(eventSlug: string, productIds: string[]): Promise<Record<string, ItemCaps> | null> {
  const result = await withDeadline(getEventCatalog(eventSlug), STOCK_LOOKUP_TIMEOUT_MS)
  if (!result?.ok) return null
  const limits: Record<string, ItemCaps> = {}
  for (const id of productIds) {
    const product = result.value.products.find((p) => p.id === id)
    // A product the catalog no longer lists cannot be ordered at all.
    limits[id] = product ? capsFor(product) : NONE_LEFT
  }
  return limits
}

/** Where focus goes after the next render: the refusal when it appears, the heading after the cart changes. */
type FocusTarget = 'heading' | 'error'

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7.5v5M12 16.5h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The second step after the cart (design/app-mockups/project/CheckoutReserve.dc.html and
 * CheckoutPrepay.dc.html): what is being ordered, how it is paid, the email, and the one action.
 * A refusal shows at the top with a way back to the cart.
 */
export function CheckoutPage() {
  const { eventSlug = '' } = useParams()
  const cart = useCart()
  const online = useOnlineStatus()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  /** What is left of each refused item, when the catalog could be read after the refusal. */
  const [limits, setLimits] = useState<Record<string, ItemCaps> | null>(null)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const pendingFocus = useRef<FocusTarget | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const emailAlertRef = useRef<HTMLParagraphElement>(null)
  const cartAlertRef = useRef<HTMLParagraphElement>(null)
  const itemsEntrance = useFirstEntrance('checkout:items', (cart?.items.length ?? 0) > 0)
  // Kept mounted in the checkout and the empty cart, so a fix that empties the cart is still announced.
  const cartAlert = <p className="visually-hidden" role="status" ref={cartAlertRef} />

  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    ;(target === 'heading' ? headingRef : errorRef).current?.focus()
  })

  if (!cart || cart.items.length === 0) {
    return (
      <>
        {cartAlert}
        <EmptyCart eventSlug={eventSlug} headingRef={headingRef} />
      </>
    )
  }

  const emailValid = EMAIL_PATTERN.test(email.trim())
  const emailEmpty = email.trim() === ''
  // A blur on an empty field is not an error yet; a submit with it empty is.
  const showEmailError = !emailValid && ((emailTouched && !emailEmpty) || submitAttempted)
  const isPrepay = cart.boothMode === 'prepay'
  const total = formatMoney(cartTotal(cart), cart.currency)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!cart || submitting || !online) return
    if (!emailValid) {
      setEmailTouched(true)
      setSubmitAttempted(true)
      emailRef.current?.focus()
      // Enter from the field leaves focus where it is, so nothing would be read: the error is
      // announced on every failed submit, cleared first so a repeat is read again (WCAG 3.3.1, 4.1.3).
      announceIn(emailAlertRef.current, emailEmpty ? 'Enter your email address' : 'Enter a full email address, like name@example.com.')
      return
    }
    setSubmitting(true)
    setRefusal(null)
    setLimits(null)
    const input = {
      boothId: cart.boothId,
      items: cart.items.map((i) => ({ productId: i.productId, quantity: i.qty })),
      email: email.trim(),
      requestId: cart.requestId,
    }
    if (isPrepay) {
      const result = await withDeadline(startCheckout(input), SUBMIT_TIMEOUT_MS)
      if (result?.ok) {
        clearCart()
        rememberLastOrder(result.value.order.id)
        rememberCheckoutUrl(result.value.order.id, result.value.checkoutUrl)
        // Square's hosted page is a different site, so this is a full navigation.
        window.location.assign(result.value.checkoutUrl)
        return
      }
      await showRefusal(result ?? { reason: 'network' })
      return
    }
    const result = await withDeadline(createReservation(input), SUBMIT_TIMEOUT_MS)
    if (result?.ok) {
      setSubmitting(false)
      // The order page opens from this copy at once, instead of flashing a loading state.
      cacheOrders([result.value])
      clearCart()
      // Back from the order lands on the emptied cart, which then points to this order.
      rememberLastOrder(result.value.id)
      navigate(`/orders/${result.value.id}`, { replace: true })
      return
    }
    await showRefusal(result ?? { reason: 'network' })
  }

  /** A stock refusal waits briefly for what is left, so the message is complete when it is read. */
  async function showRefusal(next: Refusal) {
    const ids = STOCK_REFUSALS.includes(next.reason) ? (next.productIds ?? []) : []
    const found = ids.length > 0 && cart ? await currentLimits(cart.eventSlug, ids) : null
    // The cart shows the new caps at once ("Only 1 left"), quantities untouched, for "Change cart".
    if (found) applyCaps(found)
    pendingFocus.current = 'error'
    setSubmitting(false)
    setLimits(found)
    setRefusal(next)
  }

  const refusedLines = (refusal?.productIds ?? [])
    .map((id) => cart.items.find((i) => i.productId === id))
    .filter((i): i is CartItem => i !== undefined)
  // A product no longer sold has no stock to look up, so its lines get limit 0 and are removed.
  const canAdjust =
    refusal !== null &&
    (STOCK_REFUSALS.includes(refusal.reason) || refusal.reason === 'product_not_found') &&
    refusedLines.length > 0
  // Without the current stock, the named lines are removed; with it, each drops to what is left.
  const capsAfter = (item: CartItem): ItemCaps => limits?.[item.productId] ?? NONE_LEFT
  const newLimit = (item: CartItem) => Math.min(capsAfter(item).maxPerOrder, capsAfter(item).stockQty)
  const removesAll = refusedLines.every((i) => newLimit(i) === 0)
  const adjustLabel =
    refusal?.reason === 'insufficient_stock'
      ? removesAll
        ? 'Remove sold-out items'
        : 'Change to what is left'
      : removesAll
        ? 'Remove these items'
        : 'Lower to the limit'

  /** One banner line per refused item, as in the design: "Hoodie: 1 left, 2 in your cart". */
  const describeRefused = (item: CartItem) => {
    if (refusal?.reason === 'product_not_found') return item.name
    const caps = limits?.[item.productId]
    const limit = caps === undefined ? undefined : Math.min(caps.maxPerOrder, caps.stockQty)
    const inCart = `${item.qty} in your cart`
    if (limit === undefined || limit >= item.qty) return `${item.name}: ${inCart}`
    if (limit === 0) return `${item.name}: sold out, ${inCart}`
    return refusal?.reason === 'insufficient_stock'
      ? `${item.name}: ${limit} left, ${inCart}`
      : `${item.name}: up to ${limit} per order, ${inCart}`
  }

  /** What the booth's refusal means for this cart, when the reason alone does not say. */
  const refusalDetail =
    refusal?.reason === 'ordering_paused'
      ? `${cart.vendorName} isn't taking orders right now. Try again later.`
      : refusal?.reason === 'booth_not_accepting_orders'
        ? `${cart.vendorName} doesn't take orders in the app. You can still buy at the booth.`
        : null
  const lines = refusedLines.map(describeRefused)
  // Over a list of items the reason is a title; standing alone it reads as a sentence.
  const title = refusal ? refusalLabels[refusal.reason] : ''
  const titleText = lines.length > 0 || /[.!?]$/.test(title) ? title : `${title}.`

  const adjustCart = () => {
    // Says what changed, line by line, since the banner that named the problem goes away.
    announceIn(
      cartAlertRef.current,
      refusedLines
        .map((i) => (newLimit(i) === 0 ? `Removed ${i.name}` : `${i.name}: ${Math.min(i.qty, newLimit(i))} in cart`))
        .join('. '),
    )
    capLines(Object.fromEntries(refusedLines.map((i) => [i.productId, capsAfter(i)])))
    setRefusal(null)
    setLimits(null)
    // The summary changed under the banner; the heading also becomes the empty-cart heading if nothing is left.
    pendingFocus.current = 'heading'
  }

  return (
    <>
      {cartAlert}
      <div className="cart checkout">
        {/* Focused when it appears, which reads it once; role="alert" as well would read it twice. */}
        {refusal && (
          <div className="cart__alert">
            <AlertIcon />
            <div className="cart__alert-body">
              {/* The message is focused as one block, which reads the title and its lines once. */}
              <div className="cart__alert-message" ref={errorRef} tabIndex={-1}>
                <p className="cart__alert-title">{titleText}</p>
                {lines.length > 0 && (
                  <ul className="cart__alert-lines" role="list">
                    {lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
                {refusalDetail && <p>{refusalDetail}</p>}
                {refusal.reason === 'network' && (
                  <p>
                    Not sure it went through? Check <Link to="/orders">your orders</Link> before trying again.
                  </p>
                )}
              </div>
              <div className="cart__alert-actions">
                {canAdjust && (
                  <button type="button" className="cart__alert-action" onClick={adjustCart}>
                    {adjustLabel}
                  </button>
                )}
                <Link className="cart__alert-action" to={`/e/${eventSlug}/cart`}>
                  Change cart
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* The order page's vendor row: logo slot, vendor name, booth code. */}
        <div className="order-vendor">
          {/* Carts saved before the logo was recorded have none, and show the code tile. */}
          <BoothLogo booth={{ code: cart.boothCode, logoUrl: cart.logoUrl ?? '' }} />
          <div className="order-vendor__text">
            <h1 className="order-vendor__name" ref={headingRef} tabIndex={-1}>
              {/* The space stays outside the hidden span, where every name computation keeps it. */}
              <span className="visually-hidden">{isPrepay ? 'Check out with' : 'Reserve from'}</span> {cart.vendorName}
            </h1>
            <p className="order-vendor__booth">Booth {cart.boothCode}</p>
          </div>
        </div>

        <section className="order-items checkout__summary" aria-labelledby="checkout-items-title">
          <h2 id="checkout-items-title">Items</h2>
          <ul role="list" {...itemsEntrance}>
            {cart.items.map((i) => (
              <li key={i.productId}>
                <span>
                  {i.qty} × {i.name}
                </span>
                <span className="price">{formatMoney(i.qty * i.priceCents, cart.currency)}</span>
              </li>
            ))}
          </ul>
          <p className="order-items__total">
            <span>Total</span>
            <span>{total}</span>
          </p>
        </section>

        {/* The hold's length is not part of the cart, so the prepay sentence does not name one. */}
        <p className="cart__payment">
          {isPrepay
            ? "You pay on Square's page. Your items are held while you pay."
            : `Pay ${total} at the booth when you pick up.`}
        </p>

        <form className="reserve-form" onSubmit={(e) => void submit(e)} noValidate>
          {/* The design system's outlined text field: the label sits in the outline's top edge. */}
          <div className={`text-field${showEmailError ? ' text-field--error' : ''}`}>
            <label className="text-field__label" htmlFor="email">
              Email
            </label>
            <input
              className="text-field__input"
              ref={emailRef}
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              aria-required="true"
              aria-invalid={showEmailError}
              aria-describedby={showEmailError ? 'email-error email-help' : 'email-help'}
            />
            {showEmailError && (
              <p id="email-error" className="text-field__support text-field__error">
                {emailEmpty ? 'Enter your email address' : 'Enter a full email address, like name@example.com.'}
              </p>
            )}
            <p id="email-help" className="text-field__support">
              Required. Your order link is sent here.
            </p>
          </div>
          {/* Kept mounted, so writing into it is announced. */}
          <p className="visually-hidden" aria-live="polite" ref={emailAlertRef} />
          {/* The one action, docked at the bottom like a native flow's. */}
          <div className="cart__dock">
            {/* aria-disabled instead of disabled, so focus stays on the button when the device goes offline; submit() refuses then. */}
            <button
              type="submit"
              className="order-button order-button--filled"
              aria-disabled={submitting || !online}
              aria-describedby={online ? undefined : 'cart-offline'}
            >
              {isPrepay ? (submitting ? 'Opening payment...' : 'Pay with Square') : submitting ? 'Reserving...' : 'Reserve'}
            </button>
            {!online && (
              <p id="cart-offline" className="reserve-form__note">
                {isPrepay ? "You're offline. Pay when you're back online." : "You're offline. Reserve when you're back online."}
              </p>
            )}
          </div>
        </form>
      </div>
    </>
  )
}
