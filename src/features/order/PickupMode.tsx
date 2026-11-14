import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { Order } from '../../shared/types'
import { orderStatusLabels } from '../../shared/ui/labels'
import { attendeeOrderLabels, FINAL_STATUSES, PICKUP_STATUSES } from './orderStatus'
import { OrderBoothLogo } from './OrderBoothLogo'
import { NameChevron, OrderPassStrip, PassNotch, PassStrip, StorefrontLink } from './PassParts'
import { PickupQr } from './PickupQr'
import { useWakeLock } from './useWakeLock'

/** A downward drag longer than this closes the view. */
export const SWIPE_CLOSE_PX = 100
/** A sideways drag longer than this moves to the next or previous order. */
export const SWIPE_PAGE_PX = 60
const SLIDE_OFFSET_PX = 40
const SLIDE_MS = 200
const BRIGHTNESS_HINT_KEY = 'pickup.brightnessHintShown'

export const READY_LINE = 'Your items are waiting at the table.'
export const BRIGHTNESS_HINT = 'Brighten your screen to scan'

export interface PickupSlide {
  id: string
  /** `null` once the order is no longer in the attendee's list. */
  order: Order | null
  /** A saved copy past its hold, whose code waits for the server (FR-26). */
  withheld: boolean
}

interface PickupModeProps {
  /** The orders to page through, fixed when the view opened so an order that ends keeps its place. */
  slides: PickupSlide[]
  initialIndex?: number
  /** The "saved copy" note, repeated here because the page behind is hidden. */
  note?: string | null
  /** Link each order to its page. The wallet's passes open this view, so it is their way there. */
  detailsLink?: boolean
  onClose: () => void
}

function hintAlreadyShown(): boolean {
  try {
    return sessionStorage.getItem(BRIGHTNESS_HINT_KEY) === '1'
  } catch {
    return false
  }
}

function markHintShown() {
  try {
    sessionStorage.setItem(BRIGHTNESS_HINT_KEY, '1')
  } catch {
    // Without storage the hint may show again next time, which is harmless.
  }
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])'

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d={direction === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CloseIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Pickup mode: one order's code, QR and booth, full screen, to hand over at
 * the booth. It keeps the screen awake, follows live status changes, and stops
 * showing the code once the order has ended.
 */
export function PickupMode({ slides, initialIndex = 0, note = null, detailsLink = false, onClose }: PickupModeProps) {
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), slides.length - 1))
  const [hintWanted, setHintWanted] = useState(() => !hintAlreadyShown())
  const [scrolls, setScrolls] = useState(false)
  // Whether content has scrolled under the sticky bar, which then shows its divider.
  const [scrolledUnder, setScrolledUnder] = useState(false)
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const codeRef = useRef<HTMLHeadingElement>(null)
  const statusRef = useRef<HTMLHeadingElement>(null)
  const announcerRef = useRef<HTMLParagraphElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; fromTop: boolean } | null>(null)

  const slide = slides[index]
  const order = slide.order
  const showCode = order !== null && PICKUP_STATUSES.includes(order.status) && !slide.withheld
  const ended = order === null || FINAL_STATUSES.includes(order.status)
  const statusText = order ? orderStatusLabels[order.status] : 'No longer available'
  const payment = order ? (attendeeOrderLabels(order).paymentBadge?.label ?? null) : null
  const hintVisible = hintWanted && showCode

  useWakeLock(true)

  // The page behind is inert and still while the view is open; focus starts on the code. A layout
  // effect, so the page is live again in the commit that closes the view, before it takes focus back.
  useLayoutEffect(() => {
    const dialog = rootRef.current
    const others = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== dialog && !el.hasAttribute('inert'),
    )
    others.forEach((el) => el.setAttribute('inert', ''))
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Without scrolling: the view opens at its top, logo and status in sight; the code is focused below them.
    ;(codeRef.current ?? statusRef.current)?.focus({ preventScroll: true })
    return () => {
      others.forEach((el) => el.removeAttribute('inert'))
      document.body.style.overflow = overflow
    }
  }, [])

  useEffect(() => {
    if (hintVisible) markHintShown()
  }, [hintVisible])

  // A pushed change, or a move to another order, is read out once. If it removed the
  // focused code, focus goes to the status heading instead, which reads it.
  const announced = useRef({ id: slide.id, status: order?.status })
  useEffect(() => {
    const previous = announced.current
    announced.current = { id: slide.id, status: order?.status }
    if (previous.id === slide.id && previous.status === order?.status) return
    const active = document.activeElement
    if (!active || active === document.body || !rootRef.current?.contains(active)) {
      ;(codeRef.current ?? statusRef.current)?.focus()
      return
    }
    if (!announcerRef.current) return
    const parts =
      previous.id === slide.id
        ? [statusText, order?.status === 'ready' ? READY_LINE : null]
        : [`Order ${index + 1} of ${slides.length}`, order ? `${order.boothName}, Booth ${order.boothCode}` : null, statusText]
    announcerRef.current.textContent = parts.filter(Boolean).join('. ')
  }, [slide.id, order, statusText, index, slides.length])

  // Moving between orders slides the content in from the side it came from.
  const shownIndex = useRef(index)
  useEffect(() => {
    const from = shownIndex.current
    shownIndex.current = index
    const el = bodyRef.current
    if (from === index || !el || typeof el.animate !== 'function' || prefersReducedMotion()) return
    const offset = (index > from ? 1 : -1) * SLIDE_OFFSET_PX
    el.animate([{ transform: `translateX(${offset}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], {
      duration: SLIDE_MS,
      easing: 'ease-out',
    })
  }, [index])

  // Content that fits leaves vertical drags to the swipe-down; content that scrolls lets the
  // browser pan it, and the Close button and Escape still close.
  useLayoutEffect(() => {
    const check = () => {
      const el = rootRef.current
      if (el) setScrolls(el.scrollHeight > el.clientHeight + 1)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [index, showCode, hintVisible, note])

  const go = (delta: number) => {
    const next = Math.min(Math.max(index + delta, 0), slides.length - 1)
    if (next === index) return
    setIndex(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (slides.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      go(e.key === 'ArrowLeft' ? -1 : 1)
      return
    }
    if (e.key !== 'Tab') return
    // Focus stays inside the view and moves through its controls in order, wrapping at
    // the ends. Moved by hand, because Safari's default Tab skips buttons and would
    // leave the view; from the code heading it goes to the next control after it.
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (items.length === 0) return
    e.preventDefault()
    const active = document.activeElement
    const at = active instanceof HTMLElement ? items.indexOf(active) : -1
    let next: number
    if (at >= 0) next = (at + (e.shiftKey ? -1 : 1) + items.length) % items.length
    else {
      // Not on a control (the code heading, or the view itself): use document order.
      const after = items.findIndex((el) => active instanceof Node && active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      next = e.shiftKey ? (after <= 0 ? items.length - 1 : after - 1) : after < 0 ? 0 : after
    }
    items[next].focus()
  }

  const resetDrag = () => {
    drag.current = null
    if (sheetRef.current) sheetRef.current.style.transform = ''
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || e.button !== 0) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, fromTop: (rootRef.current?.scrollTop ?? 0) <= 0 }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId || !sheetRef.current) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    // The sheet follows a downward drag, so the attendee sees it is about to close.
    sheetRef.current.style.transform = d.fromTop && dy > 0 && dy > Math.abs(dx) ? `translateY(${dy}px)` : ''
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    resetDrag()
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (d.fromTop && dy > SWIPE_CLOSE_PX && dy > Math.abs(dx)) onClose()
    else if (slides.length > 1 && Math.abs(dx) > SWIPE_PAGE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1)
  }

  const dismissHint = () => {
    // The button is about to go, so focus moves to the code first.
    codeRef.current?.focus()
    setHintWanted(false)
  }

  return createPortal(
    <div
      ref={rootRef}
      className="pickup-mode"
      role="dialog"
      aria-modal="true"
      // The shell's pull-to-refresh and edge swipe-back stay out of the view's own gestures.
      data-no-pull=""
      data-no-swipe-back=""
      aria-labelledby={titleId}
      // Focusable, so a tap on empty space keeps focus (and Escape) inside the view.
      tabIndex={-1}
      data-scrolls={scrolls ? '' : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={resetDrag}
      // Set only when it flips, so scrolling does not re-render on every frame.
      onScroll={(e) => {
        const under = e.currentTarget.scrollTop > 0
        if (under !== scrolledUnder) setScrolledUnder(under)
      }}
    >
      <div className="pickup-mode__sheet" ref={sheetRef}>
        {/* Stays at the top while the content scrolls, so Close and the pager are always in reach. */}
        <div className="pickup-mode__bar" data-scrolled-under={scrolledUnder ? '' : undefined}>
          {slides.length > 1 && (
            <div className="pickup-mode__pager">
              <button
                type="button"
                className="pickup-mode__icon-button"
                aria-disabled={index === 0}
                onClick={() => go(-1)}
              >
                <Chevron direction="left" />
                <span className="visually-hidden">Previous order</span>
              </button>
              {/* Which pass of several, between the arrows that move through them, so it is on screen
                  whatever the height; named for a screen reader. */}
              <div className="pickup-pass__dots" role="img" aria-label={`Order ${index + 1} of ${slides.length}`}>
                {slides.map((s, i) => (
                  <span key={s.id} className={i === index ? 'is-current' : undefined} />
                ))}
              </div>
              <button
                type="button"
                className="pickup-mode__icon-button"
                aria-disabled={index === slides.length - 1}
                onClick={() => go(1)}
              >
                <Chevron direction="right" />
                <span className="visually-hidden">Next order</span>
              </button>
            </div>
          )}
          <button type="button" className="pickup-mode__icon-button pickup-mode__close" onClick={onClose}>
            <CloseIcon size={18} />
            <span className="visually-hidden">Close</span>
          </button>
        </div>

        <div className="pickup-mode__body" ref={bodyRef}>
          {note && <p className="pickup-mode__note">{note}</p>}
          {/* The order as a wallet pass: the vendor's strip and logo, the status, a perforation, then
              the code and its QR (README: PickupCodeCard). */}
          <div className="pickup-pass">
            {order ? <OrderPassStrip order={order} /> : <PassStrip />}
            <div className="pickup-pass__head">
              {/* The dialog's name comes from this paragraph, so the storefront link sits beside it. */}
              <div className="pass-identity">
                <p className="pickup-mode__booth" id={titleId}>
                  {order ? (
                    <>
                      <OrderBoothLogo order={order} className="pickup-mode__logo" size="lg" />
                      <span className="pickup-mode__vendor">
                        {order.boothName}
                        <NameChevron order={order} />
                      </span>
                      {/* The space stays outside the hidden span, where every name computation keeps it. */}
                      <span className="visually-hidden">,</span>{' '}
                      <span className="pickup-mode__booth-code">Booth {order.boothCode}</span>
                    </>
                  ) : (
                    <span className="pickup-mode__vendor">Order</span>
                  )}
                </p>
                {/* Pickup mode closes as the storefront opens. */}
                {order && <StorefrontLink order={order} onFollow={onClose} />}
              </div>

              <div className="pickup-mode__status">
                <h2 className={`wallet-badge wallet-badge--${order?.status ?? 'gone'}`} ref={statusRef} tabIndex={-1}>
                  {statusText}
                </h2>
                {order?.status === 'ready' && <p className="pickup-mode__ready-line">{READY_LINE}</p>}
                {payment && <p className="pickup-mode__payment">{payment}</p>}
              </div>
            </div>
            <PassNotch />
            {showCode ? (
              <div className="pickup-pass__code">
                <h2 className="pickup-mode__code" ref={codeRef} tabIndex={-1}>
                  <span className="visually-hidden">Pickup code: {order.pickupCode.split('').join(' ')}</span>
                  <span className="pickup-mode__code-label" aria-hidden="true">
                    Pickup code
                  </span>
                  <span className="pickup-mode__code-value" aria-hidden="true">
                    {order.pickupCode}
                  </span>
                </h2>
                <PickupQr code={order.pickupCode} className="pickup-mode__qr" />
              </div>
            ) : (
              <p className="pickup-mode__no-code">
                {ended
                  ? order
                    ? 'There is no pickup code to show for this order.'
                    : 'This order is no longer in your orders.'
                  : 'The hold time has passed. Checking the latest status.'}
              </p>
            )}
          </div>
          {showCode && hintVisible && (
            <div className="pickup-mode__hint">
              <p>{BRIGHTNESS_HINT}</p>
              <button type="button" className="pickup-mode__hint-dismiss" onClick={dismissHint}>
                <CloseIcon size={14} />
                <span className="visually-hidden">Dismiss</span>
              </button>
            </div>
          )}
          {detailsLink && order && (
            <Link className="order-button order-button--tonal pickup-mode__details" to={`/orders/${order.id}`}>
              Order details
              <span className="visually-hidden">: {order.boothName}</span>
            </Link>
          )}
        </div>
        {/* Kept mounted and written directly, so only real changes are read out. */}
        <p className="visually-hidden" aria-live="polite" ref={announcerRef} />
      </div>
    </div>,
    document.body,
  )
}
