import { useFirstEntrance } from '../../shell/useFirstEntrance'
import { Link, useParams } from 'react-router-dom'
import { BoothLogo } from '../../shared/ui/BoothLogo'
import { boothBadgeClass, boothBadgeLabel } from './boothLabel'
import { BoothsSkeleton } from './DiscoverSkeletons'
import { SavedCopyNote } from './SavedCopyNote'
import { CatalogError } from './CatalogError'
import { useCatalog } from './useCatalog'

/** The Booths tab: every vendor at the event, like the exhibitor list in a printed guide. */
export function BoothsPage() {
  const { eventSlug = '' } = useParams()
  const { state, reload } = useCatalog(eventSlug)
  // The list rises in once per session, the first time it renders (shell, index.css).
  const listEntrance = useFirstEntrance(`booths:${eventSlug}`, state.status === 'ready')

  if (state.status === 'loading') return <BoothsSkeleton />
  if (state.status === 'error') return <CatalogError refusal={state.refusal} onRetry={() => void reload()} />

  return (
    <div className="booths-page">
      <h1>Booths</h1>
      <SavedCopyNote show={state.fromCache} onRetry={() => void reload()} />
      <ul className="directory" role="list" {...listEntrance}>
        {state.catalog.booths.map((b) => (
          <li key={b.id}>
            <Link className="directory__row" to={`/e/${eventSlug}/booth/${b.id}`}>
              <BoothLogo booth={b} />
              <span className="directory__text">
                <span className="directory__name">
                  <span className="visually-hidden">Booth {b.code}, </span>
                  {b.vendorName}
                </span>
                {b.slogan && (
                  <span className="directory__meta">
                    <span className="visually-hidden">, </span>
                    {b.slogan}
                  </span>
                )}
                <span className="directory__badges">
                  {/* Already spoken first in the link's name, so shown here only to the eye. */}
                  <span className="directory__code" aria-hidden="true">
                    {b.code}
                  </span>
                  <span className="visually-hidden">, </span>
                  <span className={boothBadgeClass(b)}>{boothBadgeLabel(b)}</span>
                </span>
              </span>
              <svg className="directory__chevron" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
