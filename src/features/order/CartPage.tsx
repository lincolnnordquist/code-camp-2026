import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { Link, useParams } from 'react-router-dom'
import { requestEventCatalog } from '../../shell/catalogRequest'
import { useOnlineStatus } from '../../shared/live'
import type { Product } from '../../shared/types'
import { ProductImage } from '../../shared/ui/ProductImage'
import { formatMoney } from '../../shared/ui/labels'
import { cartTotal, isOverLimit, lastOrderId, limitNote, setQty, useCart, type CartItem } from './cartStore'
import { useFirstEntrance } from '../../shell/useFirstEntrance'
import { announceIn } from './announce'
import { BoothIdentity } from './BoothIdentity'
import { StepIcon } from './StepIcon'

/**
 * Where focus goes after a line is removed, because its stepper is gone: the
 * next line's stepper, else the cart heading, else the empty-cart heading.
 */
type FocusTarget = { kind: 'line'; productId: string } | { kind: 'heading' }

/**
 * The cart and checkout steps with nothing in the cart. Right after an order, Back lands here, so
 * the order this device just placed comes first; otherwise the way back to the event.
 */
export function EmptyCart({ eventSlug, headingRef }: { eventSlug: string; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const lastOrder = lastOrderId()
  return (
    <div className="cart cart--empty">
      <h1 ref={headingRef} tabIndex={-1}>
        Your cart is empty
      </h1>
      <div className="cart__empty-actions">
        {lastOrder && (
          <Link className="order-button order-button--filled" to={`/orders/${lastOrder}`}>
            View your order
          </Link>
        )}
        <Link className={`order-button ${lastOrder ? 'order-button--outlined' : 'order-button--filled'}`} to={`/e/${eventSlug}`}>
          Browse the event
        </Link>
      </div>
    </div>
  )
}

/** The cart (design/app-mockups/project/Cart.dc.html): the lines and their quantities, the total, then Continue to checkout. */
export function CartPage() {
  const { eventSlug = '' } = useParams()
  const cart = useCart()
  const online = useOnlineStatus()
  // The lines' photos come from the event catalog; until it is read (or offline) the frames stay neutral.
  const [products, setProducts] = useState<Map<string, Product>>(() => new Map())
  const cartSlug = cart?.eventSlug ?? null
  useEffect(() => {
    if (!cartSlug) return
    let active = true
    requestEventCatalog(cartSlug)
      .then((r) => {
        if (active && r.ok) setProducts(new Map(r.value.products.map((p) => [p.id, p])))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [cartSlug])
  const pendingFocus = useRef<FocusTarget | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const linesRef = useRef<HTMLUListElement>(null)
  const announcerRef = useRef<HTMLParagraphElement>(null)
  const linesEntrance = useFirstEntrance('cart:lines', (cart?.items.length ?? 0) > 0)

  /** Says what a stepper press did ("Patch: 2 in cart", "Removed Patch"); cleared first, so a repeat is read. */
  const announce = (text: string) => announceIn(announcerRef.current, text)
  // Kept mounted in both the cart and the empty cart, so removing the last line is still announced.
  const announcer = <p className="visually-hidden" role="status" ref={announcerRef} />

  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    if (target.kind === 'heading') {
      headingRef.current?.focus()
      return
    }
    const line = Array.from(linesRef.current?.children ?? []).find(
      (li) => li instanceof HTMLElement && li.dataset.productId === target.productId,
    )
    line?.querySelector('button')?.focus()
  })

  if (!cart || cart.items.length === 0) {
    return (
      <>
        {announcer}
        <EmptyCart eventSlug={eventSlug} headingRef={headingRef} />
      </>
    )
  }

  const isPrepay = cart.boothMode === 'prepay'

  const removeLine = (index: number) => {
    const next = cart.items[index + 1]
    pendingFocus.current = next ? { kind: 'line', productId: next.productId } : { kind: 'heading' }
    announce(`Removed ${cart.items[index].name}`)
    setQty(cart.items[index].productId, 0)
  }

  const step = (item: CartItem, qty: number) => {
    setQty(item.productId, qty)
    announce(`${item.name}: ${qty} in cart`)
  }

  return (
    <>
      {announcer}
      <div className="cart">
        <BoothIdentity cart={cart} lead="Your cart from" headingRef={headingRef} />

        <div className="cart__columns">
          <ul className="cart__lines" role="list" ref={linesRef} {...linesEntrance}>
            {cart.items.map((item, index) => {
              const note = limitNote(item)
              const noteId = `limit-${item.productId}`
              return (
                <li
                  key={item.productId}
                  className={`cart__line${isOverLimit(item) ? ' cart__line--over' : ''}`}
                  data-product-id={item.productId}
                >
                  <span className="cart__photo" aria-hidden="true">
                    {products.has(item.productId) ? (
                      <ProductImage product={products.get(item.productId)!} size="small" />
                    ) : (
                      <span className="product-image product-image--small product-image--frame" />
                    )}
                  </span>
                  <span className="cart__line-body">
                    <span className="cart__line-text">
                      <span className="cart__name">{item.name}</span>
                      <span className="cart__each">
                        {formatMoney(item.priceCents, cart.currency)}
                        <span className="visually-hidden"> each</span>
                      </span>
                      {note && (
                        <span className="cart__limit" id={noteId}>
                          {note}
                        </span>
                      )}
                    </span>
                    <span className="cart__line-foot">
                      <span className="cart__line-controls">
                        <span className="stepper" role="group" aria-label={`Quantity of ${item.name}`}>
                          <button
                            type="button"
                            className="stepper__btn"
                            aria-label={item.qty === 1 ? `Remove ${item.name}` : `One fewer ${item.name}`}
                            onClick={() => (item.qty === 1 ? removeLine(index) : step(item, item.qty - 1))}
                          >
                            {/* At one, this button removes the line, so it shows the bin. */}
                            <StepIcon kind={item.qty === 1 ? 'remove' : 'minus'} />
                          </button>
                          <span className="stepper__qty">{item.qty}</span>
                          <button
                            type="button"
                            className="stepper__btn"
                            aria-label={`One more ${item.name}`}
                            // aria-disabled instead of disabled, so focus stays on the button when it reaches the limit.
                            aria-disabled={item.qty >= item.maxQty}
                            aria-describedby={note ? noteId : undefined}
                            onClick={() => item.qty < item.maxQty && step(item, item.qty + 1)}
                          >
                            <StepIcon kind="plus" />
                          </button>
                        </span>
                      </span>
                      <span className="cart__price">{formatMoney(item.qty * item.priceCents, cart.currency)}</span>
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>

          {/* A side panel on a wide screen; on a phone its parts follow the lines and the action docks. */}
          <div className="cart__summary">
            <h2 className="cart__summary-title">Summary</h2>
            <ul className="cart__summary-lines" role="list">
              {cart.items.map((i) => (
                <li key={i.productId}>
                  <span>
                    {i.qty} × {i.name}
                  </span>
                  <span className="price">{formatMoney(i.qty * i.priceCents, cart.currency)}</span>
                </li>
              ))}
            </ul>
            <p className="cart__total">
              <span>Total</span>
              <span>{formatMoney(cartTotal(cart), cart.currency)}</span>
            </p>
            {!isPrepay && <p className="cart__pay">Pay at the booth when you pick up.</p>}

            {/* The one action, docked at the bottom like a native flow's; the page's end clears it. */}
            <div className="cart__dock">
              {/* aria-disabled instead of removing the link, so focus stays on it when the device goes offline. */}
              <Link
                className="order-button order-button--filled"
                to={`/e/${eventSlug}/cart/checkout`}
                aria-disabled={!online}
                aria-describedby={online ? undefined : 'cart-offline'}
                onClick={(e: MouseEvent<HTMLAnchorElement>) => {
                  if (!online) e.preventDefault()
                }}
              >
                Continue
              </Link>
              {!online && (
                <p id="cart-offline" className="reserve-form__note">
                  {isPrepay ? "You're offline. Pay when you're back online." : "You're offline. Reserve when you're back online."}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
