import { focusQuietly } from '../../shell/inputModality'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { bannerPreloadProps } from './bannerPreload'
import { formatMoney } from '../../shared/ui/labels'
import type { Booth, Event, EventCatalog, Product } from '../../shared/types'
import { boothBadgeClass, boothBadgeLabel, isPaused } from './boothLabel'
import { BoothLogo } from '../../shared/ui/BoothLogo'
import { ProductImage } from '../../shared/ui/ProductImage'
import { ProductGallery } from './ProductGallery'
import { productImages } from './productImages'
import { StockBadge } from './StockBadge'
import { PRODUCT_PARAM, withProduct, type SheetState } from './productSheetLink'
import './storefront.css'

export type RenderOrderControl = (args: { product: Product; booth: Booth; event: Event; variant?: 'card' | 'sheet' }) => ReactNode

/** Longer than the slide down (--nav-duration, 380 ms), so the sheet goes even if its animation never ends. */
const CLOSE_FALLBACK_MS = 600

/** A drag down past this many pixels closes the sheet. */
const CLOSE_DISTANCE_PX = 120
/** A flick down faster than this (px per ms) closes it from a shorter drag. */
const CLOSE_FLICK_SPEED = 0.6
/** A flick still has to travel this far, so a tap with a twitch is not a close. */
const FLICK_MIN_DISTANCE_PX = 24
/** Movement before a drag picks its axis, so a tap stays a tap. */
const DRAG_SLOP_PX = 8

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

interface HostProps {
  catalog: EventCatalog
  renderOrderControl?: RenderOrderControl
  /** The storefront the sheet sits on, so the vendor name is not a link back to the same page. */
  currentBoothId?: string
}

type Shown = { product: Product; booth: Booth }

/**
 * Renders the product sheet when the URL names a product in this catalog. Once the URL closes it
 * (Close, Escape, the scrim, a drag, Back), the same sheet stays mounted while it slides down, then
 * goes; the page behind is never snapshotted or redrawn.
 */
export function ProductSheetHost({ catalog, renderOrderControl, currentBoothId }: HostProps) {
  const [params] = useSearchParams()
  const productId = params.get(PRODUCT_PARAM)
  const product = productId ? catalog.products.find((p) => p.id === productId) : undefined
  const booth = product ? catalog.booths.find((b) => b.id === product.boothId) : undefined
  const [last, setLast] = useState<Shown | null>(null)
  const clear = useCallback(() => setLast(null), [])
  // Remembered during render, so the closing render already has it.
  if (product && booth && (last?.product !== product || last.booth !== booth)) setLast({ product, booth })
  const shown = product && booth ? { product, booth } : last
  if (!shown) return null
  return (
    <ProductSheet
      catalog={catalog}
      product={shown.product}
      booth={shown.booth}
      renderOrderControl={renderOrderControl}
      onStorefront={currentBoothId === shown.booth.id}
      closing={!product}
      onClosed={clear}
    />
  )
}

interface SheetProps {
  catalog: EventCatalog
  product: Product
  booth: Booth
  renderOrderControl?: RenderOrderControl
  onStorefront: boolean
  /** The URL has closed the sheet: it slides down, then calls onClosed. */
  closing: boolean
  onClosed: () => void
}

interface Drag {
  pointerId: number
  x0: number
  y0: number
  t0: number
  axis: 'y' | null
  dx: number
  dy: number
}

function ProductSheet({ catalog, product, booth, renderOrderControl, onStorefront, closing, onClosed }: SheetProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const titleId = useId()
  const layerRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const drag = useRef<Drag | null>(null)
  // The product shown last, so closing returns focus to its card even if a link changed it.
  const shownId = useRef(product.id)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Only a change to another product needs the scroll reset. On open the sheet has just mounted at
    // the top, and writing scrollTop forces a layout of the whole page while the sheet slides up.
    if (shownId.current !== product.id && scrollRef.current) scrollRef.current.scrollTop = 0
    shownId.current = product.id
  }, [product.id])

  // Closing ends when the slide down does. With no slide running (reduced motion, no animation
  // support) it ends at once; the timer covers a slide that never reports its end (a hidden tab).
  useEffect(() => {
    if (!closing) return
    const sheet = sheetRef.current
    const sliding = typeof sheet?.getAnimations === 'function' && sheet.getAnimations().length > 0
    if (!sliding) {
      onClosed()
      return
    }
    const id = setTimeout(onClosed, CLOSE_FALLBACK_MS)
    return () => clearTimeout(id)
  }, [closing, onClosed])

  // The sheet shows one product; a product with several photos pages through those, never to another product.
  const photos = productImages(product)
  const slug = catalog.event.slug
  const takesOrders = booth.mode !== 'discovery' && !isPaused(booth)
  const opened = (location.state as Partial<SheetState> | null)?.productSheet === true

  const close = () => {
    if (opened) navigate(-1)
    else navigate({ pathname: location.pathname, search: withProduct(location.search, null) }, { replace: true })
  }

  // Everything behind the sheet leaves the tab order and the accessibility tree, and the page stops scrolling.
  useLayoutEffect(() => {
    const layer = layerRef.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const openedOn = window.location.pathname
    const behind = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== layer && !el.inert,
    )
    behind.forEach((el) => {
      el.inert = true
    })
    const root = document.documentElement
    const overflow = root.style.overflow
    // Closing leaves the page exactly where it was when the sheet opened.
    const scrollY = window.scrollY
    root.style.overflow = 'hidden'
    return () => {
      behind.forEach((el) => {
        el.inert = false
      })
      root.style.overflow = overflow
      // Leaving the page ("Find on map") hands focus to that page's heading instead.
      if (window.location.pathname !== openedOn) return
      // Back to the card of the product shown last; one not in the current list falls back to the opener.
      const card =
        Array.from(document.querySelectorAll<HTMLElement>('[data-product-card]')).find(
          (el) => el.dataset.productCard === shownId.current,
        ) ?? null
      const target = card ?? (opener?.isConnected ? opener : null)
      // Focus always returns, without scrolling to it: the sheet never changes the product, so the card
      // is where it was. After a tap the ring stays hidden (iOS draws it for script focus).
      if (target) focusQuietly(target)
      // Anything else that moved the page meanwhile (the overflow lock, a Back that restores a
      // position) is undone, now and once more after the next paint.
      const keep = () => {
        if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: 'instant' })
      }
      keep()
      requestAnimationFrame(keep)
    }
  }, [])

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // A control inside (the order control's own prompt) that handled Escape keeps the sheet open.
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key !== 'Tab') return
    const focusable = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const setOffset = (dy: number, animate: boolean) => {
    const sheet = sheetRef.current
    if (!sheet) return
    sheet.classList.toggle('is-dragging', !animate)
    sheet.style.setProperty('--sheet-dy', `${Math.max(0, dy)}px`)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest('button, a')) return
    drag.current = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, axis: null, dx: 0, dy: 0 }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    d.dx = e.clientX - d.x0
    d.dy = e.clientY - d.y0
    if (d.axis === null) {
      if (Math.hypot(d.dx, d.dy) < DRAG_SLOP_PX) return
      // A sideways move is the photo gallery's (or nothing): products page only from the top bar.
      if (Math.abs(d.dx) > Math.abs(d.dy)) {
        drag.current = null
        return
      }
      d.axis = 'y'
      // Keeps the moves coming when the finger leaves the bar; absent in some test DOMs.
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId)
      } catch {
        // A pointer the browser no longer tracks cannot be captured (NotFoundError); the drag still works over the sheet.
      }
    }
    setOffset(d.dy, false)
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d || d.pointerId !== e.pointerId || d.axis === null) return
    const elapsed = Math.max(1, e.timeStamp - d.t0)
    setOffset(0, true)
    const flick = d.dy / elapsed > CLOSE_FLICK_SPEED && d.dy > FLICK_MIN_DISTANCE_PX
    if (d.dy > CLOSE_DISTANCE_PX || flick) close()
  }

  const onPointerCancel = () => {
    drag.current = null
    setOffset(0, true)
  }

  const gesture = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }

  const vendorRow = (
    <>
      <BoothLogo booth={booth} />
      <span className="sheet__vendor">
        <span className="sheet__vendor-name">
          <span className="visually-hidden">Booth {booth.code}, </span>
          {booth.vendorName}
        </span>
        <span className="visually-hidden">, </span>
        <span className={boothBadgeClass(booth)}>{boothBadgeLabel(booth)}</span>
      </span>
    </>
  )

  return createPortal(
    // While it slides away the sheet is out of reach: no taps, no focus.
    <div className={`sheet-layer${closing ? ' is-closing' : ''}`} ref={layerRef} inert={closing}>
      <div className="sheet-scrim" aria-hidden="true" onClick={close} />
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Takes focus when a click lands on plain content, so Escape still reaches the sheet.
        tabIndex={-1}
        onKeyDown={onKeyDown}
        // The sheet's own drags (close, the photo gallery) are not the shell's pull-to-refresh or edge swipe-back.
        data-no-pull=""
        data-no-swipe-back=""
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget && e.animationName === 'sheet-sink') onClosed()
        }}
      >
        <div className="sheet__bar" {...gesture}>
          <span className="sheet__handle" aria-hidden="true" />
          <button type="button" className="sheet__icon-button sheet__close" aria-label="Close" onClick={close}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="sheet__scroll" ref={scrollRef}>
          {/* Several photos make a gallery (a sideways swipe moves between them); one is just shown. */}
          <div className="sheet__photo">
            <div className={`sheet__media${photos.length > 1 ? ' sheet__media--gallery' : ''}`} {...gesture}>
              {photos.length > 1 ? (
                <ProductGallery key={product.id} product={product} photos={photos} />
              ) : (
                <ProductImage key={product.id} product={product} size="large" />
              )}
            </div>
          </div>
          <div className="sheet__body">
            <h2 id={titleId} ref={headingRef} tabIndex={-1} className="sheet__title">
              {product.name}
            </h2>
            <p className="sheet__price">
              {formatMoney(product.priceCents, catalog.event.currency)}
              <StockBadge qty={product.availableQty} />
            </p>
            {product.description && <p className="sheet__desc">{product.description}</p>}
            {/* Who sells it: the booths-list row, the whole row a link to the storefront (not on it already). */}
            {onStorefront ? (
              <div className="sheet__booth">{vendorRow}</div>
            ) : (
              <Link className="sheet__booth sheet__booth--link" to={`/e/${slug}/booth/${booth.id}`} {...bannerPreloadProps(booth)}>
                {vendorRow}
                <svg className="sheet__chevron" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            )}
            <Link className="sheet__map" to={`/e/${slug}/map?booth=${booth.id}`}>
              Find on map
            </Link>
          </div>
        </div>
        {/* The order control docks to the sheet's foot, always in reach, on a frosted bar. */}
        {takesOrders && product.availableQty > 0 && renderOrderControl && (
          <div className="sheet__dock">{renderOrderControl({ product, booth, event: catalog.event })}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}
