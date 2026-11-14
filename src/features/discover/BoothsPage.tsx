import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import type { Booth } from '../../shared/types'
import { EventBanner } from '../../shared/ui/EventBanner'
import { shopTypeLabels } from '../../shared/ui/labels'
import { useFirstEntrance } from '../../shell/useFirstEntrance'
import { CatalogError } from './CatalogError'
import { BoothsSkeleton } from './DiscoverSkeletons'
import { SavedCopyNote } from './SavedCopyNote'
import { boothsOfType, cycleShopType, isShopType, SHOP_TYPES, stepShopType, type ShopType } from './shopTypes'
import { StoreCard } from './StoreCard'
import { useCatalog } from './useCatalog'

const TYPE_PARAM = 'type'
/** The row's side padding, so the selected word glides to the content edge, not the screen edge. */
const SWITCHER_INSET_PX = 16
const GLIDE_MS = 260
/** A touch that starts this close to either edge of the list belongs to the browser's swipe-back. */
const EDGE_PX = 24
const AXIS_LOCK_PX = 8
const SWIPE_PX = 60
const DRAG_RESISTANCE = 0.4

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const typeLabel = (type: ShopType) => (type === 'all' ? 'All' : shopTypeLabels[type].label)

/**
 * Glides the switcher row so the selected word sits at its left edge. Animated by hand, since a
 * smooth scrollTo stops part-way when a re-render interrupts it.
 */
function useGlideToSelected(type: ShopType, ready: boolean): RefObject<HTMLDivElement | null> {
  const row = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const first = useRef(true)
  useEffect(() => {
    const el = row.current
    const tab = el?.querySelector<HTMLElement>(`[data-type="${type}"]`)
    if (!el || !tab) return
    const target = Math.min(Math.max(0, tab.offsetLeft - SWITCHER_INSET_PX), el.scrollWidth - el.clientWidth)
    cancelAnimationFrame(frame.current)
    if (first.current || reducedMotion()) {
      first.current = false
      el.scrollLeft = target
      return
    }
    const from = el.scrollLeft
    const start = performance.now()
    const step = (time: number) => {
      const p = Math.min(1, (time - start) / GLIDE_MS)
      el.scrollLeft = from + (target - from) * (1 - (1 - p) ** 3)
      if (p < 1) frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
  }, [type, ready])
  return row
}

/** Sideways swipes on the card list move to the next or previous shop type; vertical scrolling stays native. */
function useSwipeTypes(type: ShopType, select: (t: ShopType) => void) {
  const drag = useRef<{ startX: number; startY: number; pointerId: number; axis: 'x' | 'y' | null } | null>(null)
  const swiped = useRef(false)
  const [dragX, setDragX] = useState(0)
  const [settling, setSettling] = useState(false)

  const end = (e: PointerEvent<HTMLElement>, commit: boolean) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    if (d.axis !== 'x') return
    const dx = e.clientX - d.startX
    swiped.current = true
    if (commit && Math.abs(dx) > SWIPE_PX) select(stepShopType(type, dx < 0 ? 1 : -1))
    setSettling(true)
    setDragX(0)
  }

  return {
    style: {
      transform: dragX ? `translateX(${dragX}px)` : undefined,
      transition: settling ? 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      swiped.current = false
      if (e.pointerType === 'mouse') return
      const rect = e.currentTarget.getBoundingClientRect()
      if (e.clientX - rect.left < EDGE_PX || rect.right - e.clientX < EDGE_PX) return
      drag.current = { startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, axis: null }
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d || d.pointerId !== e.pointerId) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      if (d.axis === null) {
        if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return
        d.axis = Math.abs(dx) > 1.5 * Math.abs(dy) ? 'x' : 'y'
        if (d.axis === 'x') e.currentTarget.setPointerCapture(e.pointerId)
      }
      if (d.axis === 'x') {
        setSettling(false)
        setDragX(dx * DRAG_RESISTANCE)
      }
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => end(e, true),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, false),
    // A sideways swipe ends over a card; its click must not open the storefront.
    onClickCapture: (e: MouseEvent) => {
      if (!swiped.current) return
      swiped.current = false
      e.preventDefault()
    },
  }
}

/** The Booths tab: every vendor at the event, grouped by how they take orders. */
export function BoothsPage() {
  const { eventSlug = '' } = useParams()
  const { state, reload } = useCatalog(eventSlug)
  const [params, setParams] = useSearchParams()
  const param = params.get(TYPE_PARAM)
  const type: ShopType = isShopType(param) ? param : 'all'
  // The cards rise in once per session, the first time they render (shell, index.css).
  const listEntrance = useFirstEntrance(`booths:${eventSlug}`, state.status === 'ready')

  const select = (next: ShopType) => {
    if (next === type) return
    const nextParams = new URLSearchParams(params)
    if (next === 'all') nextParams.delete(TYPE_PARAM)
    else nextParams.set(TYPE_PARAM, next)
    setParams(nextParams, { replace: true })
  }
  const row = useGlideToSelected(type, state.status === 'ready')
  const swipe = useSwipeTypes(type, select)

  if (state.status === 'loading') return <BoothsSkeleton />
  if (state.status === 'error') return <CatalogError refusal={state.refusal} onRetry={() => void reload()} />

  const { catalog } = state
  const booths = boothsOfType(catalog.booths, type)
  const count = (t: ShopType) => boothsOfType(catalog.booths, t).length
  const productsOf = (b: Booth) => catalog.products.filter((p) => p.boothId === b.id)

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = cycleShopType(type, e.key === 'ArrowRight' ? 1 : -1)
    select(next)
    row.current?.querySelector<HTMLElement>(`[data-type="${next}"]`)?.focus()
  }

  return (
    <div className="booths-page">
      <EventBanner name={catalog.event.name} venue={catalog.event.venueName} />
      <h1 className="visually-hidden">Booths</h1>
      <SavedCopyNote show={state.fromCache} onRetry={() => void reload()} />
      <div className="shop-switcher" role="tablist" aria-label="Shop type" ref={row}>
        {SHOP_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`shop-tab-${t}`}
            data-type={t}
            className="shop-switcher__tab"
            aria-selected={t === type}
            aria-controls="shop-panel"
            aria-label={`${typeLabel(t)}, ${count(t)} ${count(t) === 1 ? 'booth' : 'booths'}`}
            tabIndex={t === type ? 0 : -1}
            onClick={() => select(t)}
            onKeyDown={onKey}
          >
            <span className="headline-medium shop-switcher__word">{typeLabel(t)}</span>
            <span className="label-large shop-switcher__count">{count(t)}</span>
          </button>
        ))}
      </div>
      {type !== 'all' && <p className="body-medium shop-subtitle">{shopTypeLabels[type].subtitle}</p>}
      <div id="shop-panel" role="tabpanel" aria-labelledby={`shop-tab-${type}`} className="shop-panel">
        {booths.length === 0 ? (
          <p className="body-large shop-panel__empty">No booths here yet.</p>
        ) : (
          <ul className="store-cards" role="list" {...listEntrance} {...swipe}>
            {booths.map((b) => (
              <StoreCard key={b.id} booth={b} products={productsOf(b)} eventSlug={eventSlug} currency={catalog.event.currency} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
