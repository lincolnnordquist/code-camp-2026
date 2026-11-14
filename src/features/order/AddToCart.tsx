import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { Booth, Event, Product } from '../../shared/types'
import { useOnlineStatus } from '../../shared/live'
import { addToCart, capsFor, cartCount, isOtherBooth, limitNote, maxQtyFor, setQty, useCart } from './cartStore'
import { StepIcon } from './StepIcon'

/** Where focus goes after the next render, because the control that had it was replaced. */
type FocusTarget = 'question' | 'opener' | 'cartLink' | 'plus'

const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])'

/**
 * FR-06 as a Material basic dialog over the page (design/app-mockups/project/CartReplace.dc.html).
 * The page behind is inert while it is open; Escape, the scrim and "Keep cart" close it.
 */
function ReplaceCartDialog({
  vendorName,
  titleRef,
  onReplace,
  onKeep,
}: {
  vendorName: string
  /** The question; focused when the dialog opens, so it is read first. */
  titleRef: RefObject<HTMLHeadingElement | null>
  onReplace: () => void
  onKeep: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const others = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== root && !el.hasAttribute('inert'),
    )
    others.forEach((el) => el.setAttribute('inert', ''))
    return () => others.forEach((el) => el.removeAttribute('inert'))
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onKeep()
      return
    }
    if (e.key !== 'Tab') return
    // Focus stays in the dialog, wrapping at the ends; from the title it goes to the first button.
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (items.length === 0) return
    e.preventDefault()
    const at = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1
    const next = at < 0 ? (e.shiftKey ? items.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + items.length) % items.length
    items[next].focus()
  }

  return createPortal(
    <div className="replace-dialog" ref={rootRef} onKeyDown={onKeyDown} data-no-pull="" data-no-swipe-back="">
      <div className="replace-dialog__scrim" aria-hidden="true" onClick={onKeep} />
      <section
        className="replace-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-title"
        aria-describedby="replace-text"
      >
        <h2 id="replace-title" ref={titleRef} tabIndex={-1}>
          Start a new cart?
        </h2>
        <p id="replace-text">
          Your cart has items from {vendorName}. A cart holds items from one booth, so adding this item clears it.
        </p>
        <div className="replace-dialog__buttons">
          <button type="button" className="replace-dialog__button" onClick={onKeep}>
            Keep cart
          </button>
          <button type="button" className="replace-dialog__button" onClick={onReplace}>
            Replace
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

function CardIcon({ kind }: { kind: 'add' | 'added' }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d={kind === 'add' ? 'M12 5v14M5 12h14' : 'M5 12.5l4.5 4.5L19 7.5'}
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
 * The order control for one product. On a storefront card ('card', design:
 * StorefrontReserve, StorefrontAdded) it is one compact button: "Add", then a
 * tonal "Added" that adds another, until the limit. In the product sheet
 * ('sheet') it is one full "Add to cart" button; once the product is in the
 * cart, a stepper for its line beside a filled "View cart (n)". Adding is local
 * to this device and immediate, so there is no "Adding" state to show.
 */
export function AddToCart({
  product,
  booth,
  event,
  variant = 'sheet',
}: {
  product: Product
  booth: Booth
  event: Event
  variant?: 'card' | 'sheet'
}) {
  const cart = useCart()
  const online = useOnlineStatus()
  const offlineReasonId = useId()
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const pendingFocus = useRef<FocusTarget | null>(null)
  const questionRef = useRef<HTMLHeadingElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)
  const cartLinkRef = useRef<HTMLAnchorElement>(null)
  const plusRef = useRef<HTMLButtonElement>(null)
  const limitNoteId = useId()
  const line = cart?.boothId === booth.id ? cart.items.find((i) => i.productId === product.id) : undefined
  const inCart = line?.qty ?? 0
  const atMax = inCart >= maxQtyFor(product)
  const unavailable = !online || atMax

  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    const el = { question: questionRef, opener: openerRef, cartLink: cartLinkRef, plus: plusRef }[target].current
    el?.focus()
  })

  const add = () => {
    // A replaced cart starts this product at one.
    const nextQty = isOtherBooth(cart, booth.id) ? 1 : Math.min(inCart + 1, maxQtyFor(product))
    addToCart({ eventSlug: event.slug, currency: event.currency, booth, product })
    setAnnouncement(`Added ${product.name}. ${nextQty} in cart.`)
  }

  const keepCart = () => {
    pendingFocus.current = 'opener'
    setConfirmReplace(false)
  }

  const status = (
    <p className="visually-hidden" role="status">
      {announcement}
    </p>
  )

  const onAdd = () => {
    // aria-disabled instead of disabled, so focus stays on the button when it reaches the limit.
    if (unavailable) return
    if (isOtherBooth(cart, booth.id)) {
      pendingFocus.current = 'question'
      setConfirmReplace(true)
    } else {
      add()
    }
  }

  const dialog = confirmReplace && cart && (
    <ReplaceCartDialog
      vendorName={cart.vendorName}
      titleRef={questionRef}
      onReplace={() => {
        add()
        // The card has no cart link; its own button stays the place to continue from.
        pendingFocus.current = variant === 'card' ? 'opener' : 'cartLink'
        setConfirmReplace(false)
      }}
      onKeep={keepCart}
    />
  )

  if (variant === 'card') {
    const added = inCart > 0 && !atMax
    return (
      <>
        {/* The button is the 48 px target; the 40 px pill inside it is what shows (NFR-06). */}
        {/* One label naming what a press does next, and starting with the visible word (WCAG 2.5.3):
            "Add Patch to cart", "Added, add another Patch, 1 in cart", "Limit reached for Patch, 2 in
            cart". An aria-label, because a hidden span's spacing differs between name computations. */}
        <button
          ref={openerRef}
          type="button"
          className={`add-card${added ? ' add-card--added' : ''}`}
          aria-label={
            atMax
              ? `Limit reached for ${product.name}, ${inCart} in cart`
              : added
                ? `Added, add another ${product.name}, ${inCart} in cart`
                : `Add ${product.name} to cart`
          }
          aria-disabled={unavailable}
          aria-describedby={online ? undefined : offlineReasonId}
          onClick={onAdd}
        >
          <span className="add-card__pill">
            {!atMax && <CardIcon kind={added ? 'added' : 'add'} />}
            {atMax ? 'Limit reached' : added ? 'Added' : 'Add'}
          </span>
        </button>
        {!online && (
          <span className="visually-hidden" id={offlineReasonId}>
            You're offline. Add when you're back online.
          </span>
        )}
        {dialog}
        {status}
      </>
    )
  }

  const offlineReason = !online && (
    <span className="visually-hidden" id={offlineReasonId}>
      You're offline. Add when you're back online.
    </span>
  )

  if (!line) {
    return (
      <>
        <button
          ref={openerRef}
          type="button"
          className="order-button order-button--filled"
          aria-disabled={!online}
          aria-describedby={online ? undefined : offlineReasonId}
          onClick={() => {
            if (!online) return
            // The button gives way to the stepper, so the next press is its plus.
            if (!isOtherBooth(cart, booth.id)) pendingFocus.current = 'plus'
            onAdd()
          }}
        >
          Add to cart
        </button>
        {offlineReason}
        {dialog}
        {status}
      </>
    )
  }

  // The reason the plus stops, from the product's current caps: stock can drop below what the line
  // saved when it was added, and the note must name the cap that stops the plus now.
  const note = atMax ? limitNote({ ...line, ...capsFor(product), maxQty: maxQtyFor(product) }) : null
  const plusReason = [online ? null : offlineReasonId, note ? limitNoteId : null].filter(Boolean).join(' ') || undefined
  const step = (qty: number) => {
    if (qty === 0) {
      pendingFocus.current = 'opener'
      setQty(product.id, 0)
      setAnnouncement(`Removed ${product.name}`)
      return
    }
    // One more goes through addToCart, which also takes the product's current limits.
    if (qty > inCart) addToCart({ eventSlug: event.slug, currency: event.currency, booth, product })
    else setQty(product.id, qty)
    setAnnouncement(`${product.name}: ${qty} in cart`)
  }

  return (
    <>
      <div className="sheet-cart">
        <span className="sheet-cart__stepper" role="group" aria-label={`Quantity of ${product.name}`}>
          <button
            type="button"
            className="stepper__btn"
            aria-label={inCart === 1 ? `Remove ${product.name}` : `One fewer ${product.name}`}
            onClick={() => step(inCart - 1)}
          >
            {/* At one, this button removes the product from the cart, so it shows the bin. */}
            <StepIcon kind={inCart === 1 ? 'remove' : 'minus'} />
          </button>
          <span className="stepper__qty">{inCart}</span>
          <button
            ref={plusRef}
            type="button"
            className="stepper__btn"
            aria-label={`One more ${product.name}`}
            // aria-disabled instead of disabled, so focus stays on the button when it reaches the limit.
            aria-disabled={unavailable}
            aria-describedby={plusReason}
            onClick={() => !unavailable && step(inCart + 1)}
          >
            <StepIcon kind="plus" />
          </button>
        </span>
        <Link ref={cartLinkRef} className="order-button order-button--filled sheet-cart__view" to={`/e/${event.slug}/cart`}>
          View cart ({cartCount(cart)})
        </Link>
      </div>
      {note && (
        <p className="sheet-cart__note" id={limitNoteId}>
          {note}
        </p>
      )}
      {offlineReason}
      {dialog}
      {status}
    </>
  )
}
