import { useRef, useState, type PointerEvent, type Ref } from 'react'
import { Link } from 'react-router-dom'
import type { Booth, Product } from '../../shared/types'
import { BoothLogo } from '../../shared/ui/BoothLogo'
import { BoothPlate } from '../../shared/ui/BoothPlate'
import { Icon, type IconName } from '../../shared/ui/Icon'
import { formatMoney, pausedBoothBadge, shopTypeLabels } from '../../shared/ui/labels'
import { bannerPreloadProps } from './bannerPreload'
import { isPaused } from './boothLabel'

/** A swipe down on the card further than this closes it. */
const CLOSE_SWIPE_PX = 60

const SHOP_TYPE_ICONS: Record<Booth['mode'], IconName> = {
  reservation: 'event_available',
  prepay: 'credit_card',
  discovery: 'visibility',
}

/**
 * The selected booth on the map: its banner with the booth plate, logo, name, slogan and how it
 * takes orders, up to three products, and the way into its storefront when it has one.
 */
export function MapBoothCard({
  ref,
  booth,
  products,
  eventSlug,
  currency,
  onClose,
}: {
  ref?: Ref<HTMLElement>
  booth: Booth
  products: Product[]
  eventSlug: string
  currency: string
  onClose: () => void
}) {
  const drag = useRef<{ pointerId: number; startY: number } | null>(null)
  const [dragY, setDragY] = useState<number | null>(null)
  const tiles = products.slice(0, 3)
  const paused = isPaused(booth)

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    // A mouse has no swipe, and a press on the link is the link's.
    if (e.pointerType === 'mouse' || (e.target as Element).closest('a, button')) return
    drag.current = { pointerId: e.pointerId, startY: e.clientY }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (d?.pointerId === e.pointerId) setDragY(Math.max(0, e.clientY - d.startY))
  }
  const onPointerEnd = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (d?.pointerId !== e.pointerId) return
    drag.current = null
    setDragY(null)
    if (e.type === 'pointerup' && e.clientY - d.startY > CLOSE_SWIPE_PX) onClose()
  }

  return (
    <section
      ref={ref}
      className={`map-card${dragY === null ? '' : ' is-dragging'}`}
      style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
      // The card's own swipe is not the shell's pull-to-refresh.
      data-no-pull=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <span className="map-card__handle" aria-hidden="true" />
      <div className="map-card__banner">
        {booth.bannerUrl && <img src={booth.bannerUrl} alt="" decoding="async" />}
        <BoothPlate code={booth.code} className="map-card__plate" />
      </div>
      <BoothLogo booth={booth} size="lg" className="map-card__logo" />
      <div className="map-card__text">
        <h2 className="map-card__name">{booth.vendorName}</h2>
        {booth.slogan && <p className="map-card__slogan">{booth.slogan}</p>}
        {/* How the booth takes orders, in the label module's words; a paused booth never reads as taking them (FR-05). */}
        <p className={`map-card__type${paused ? ' map-card__type--paused' : ''}`}>
          <Icon name={paused ? 'pause_circle' : SHOP_TYPE_ICONS[booth.mode]} size={16} />
          {paused ? pausedBoothBadge.label : shopTypeLabels[booth.mode].label}
        </p>
      </div>
      {tiles.length > 0 && (
        <ul className={`map-card__tiles map-card__tiles--${tiles.length >= 3 ? 3 : 2}`} role="list">
          {tiles.map((p) => (
            <li key={p.id}>
              <span className="map-card__photo">
                <img src={p.imageUrl} alt={p.name} loading="lazy" decoding="async" />
              </span>
              <span className="map-card__price">{formatMoney(p.priceCents, currency)}</span>
            </li>
          ))}
        </ul>
      )}
      {/* A booth that lists nothing (the team's own table) has no storefront to open. */}
      {products.length > 0 && (
        <Link className="button map-card__open" to={`/e/${eventSlug}/booth/${booth.id}`} {...bannerPreloadProps(booth)}>
          Open storefront
        </Link>
      )}
    </section>
  )
}
