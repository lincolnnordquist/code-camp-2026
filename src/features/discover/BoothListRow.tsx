import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Booth } from '../../shared/types'
import { BoothLogo } from '../../shared/ui/BoothLogo'
import { bannerPreloadProps } from './bannerPreload'
import { boothBadgeClass, boothBadgeLabel } from './boothLabel'

/**
 * One booth in a list (the Booths tab, booths found by a search): logo, name, slogan, code and mode,
 * the whole row a link to the storefront. `name` lets a search mark the matched words.
 */
export function BoothListRow({ booth, eventSlug, name }: { booth: Booth; eventSlug: string; name?: ReactNode }) {
  return (
    <li>
      <Link className="directory__row" to={`/e/${eventSlug}/booth/${booth.id}`} {...bannerPreloadProps(booth)}>
        <BoothLogo booth={booth} />
        <span className="directory__text">
          <span className="directory__name">
            <span className="visually-hidden">Booth {booth.code}, </span>
            {name ?? booth.vendorName}
          </span>
          {booth.slogan && (
            <span className="directory__meta">
              <span className="visually-hidden">, </span>
              {booth.slogan}
            </span>
          )}
          <span className="directory__badges">
            {/* Already spoken first in the link's name, so shown here only to the eye. */}
            <span className="directory__code" aria-hidden="true">
              {booth.code}
            </span>
            <span className="visually-hidden">, </span>
            <span className={boothBadgeClass(booth)}>{boothBadgeLabel(booth)}</span>
          </span>
        </span>
        <svg className="directory__chevron" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </li>
  )
}
