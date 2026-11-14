import { useFirstEntrance } from '../../shell/useFirstEntrance'
import { useParams } from 'react-router-dom'
import { BoothListRow } from './BoothListRow'
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
          <BoothListRow key={b.id} booth={b} eventSlug={eventSlug} />
        ))}
      </ul>
    </div>
  )
}
