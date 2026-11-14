import { Link } from 'react-router-dom'
import type { Booth, Product } from '../../shared/types'
import { BoothLogo } from '../../shared/ui/BoothLogo'
import { Icon } from '../../shared/ui/Icon'
import { formatMoney, pausedBoothBadge } from '../../shared/ui/labels'
import { isPaused } from './boothLabel'
import { productRowLayout } from './shopTypes'

export function StoreCard({ booth, products, eventSlug, currency }: { booth: Booth; products: Product[]; eventSlug: string; currency: string }) {
  const layout = productRowLayout(products.length)
  return (
    <li>
      <Link
        className="store-card"
        to={`/e/${eventSlug}/booth/${booth.id}`}
        aria-label={[booth.vendorName, `Booth ${booth.code}`, booth.slogan, isPaused(booth) ? pausedBoothBadge.label : null].filter(Boolean).join(', ')}
      >
        <span className="store-card__banner">
          {booth.bannerUrl && <img src={booth.bannerUrl} alt="" loading="lazy" decoding="async" />}
          <span className="store-card__plate">
            <span className="label-small">Booth</span>
            <span className="button-medium">{booth.code}</span>
          </span>
        </span>
        <BoothLogo booth={booth} size="lg" className="store-card__logo" />
        <span className="store-card__text">
          <span className="title-medium">{booth.vendorName}</span>
          <span className="body-medium store-card__slogan">{booth.slogan}</span>
          {isPaused(booth) && (
            <span className="label-medium store-card__paused">
              <Icon name="pause_circle" size={16} />
              {pausedBoothBadge.label}
            </span>
          )}
        </span>
        <span className={`store-card__products store-card__products--${layout.columns}`}>
          {products.slice(0, layout.shown).map((p) => (
            <span key={p.id} className="store-card__tile">
              <span className="store-card__photo">
                <img src={p.imageUrl} alt="" loading="lazy" decoding="async" />
              </span>
              <span className="label-large store-card__price">{formatMoney(p.priceCents, currency)}</span>
            </span>
          ))}
          {layout.seeBooth && (
            <span className="store-card__tile">
              <span className="store-card__see" aria-hidden="true">
                <Icon name="arrow_forward" size={20} />
                <span className="button-small">See booth</span>
              </span>
              <span className="store-card__spacer" />
            </span>
          )}
        </span>
      </Link>
    </li>
  )
}
