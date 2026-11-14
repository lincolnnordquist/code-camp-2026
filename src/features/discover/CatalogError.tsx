import { Link } from 'react-router-dom'
import { refusalLabels } from '../../shared/ui/labels'
import type { CatalogRefusal } from './useCatalog'

/**
 * Why an event's catalog did not load, with the one action that can help: an event that does not
 * exist offers a way to the events, not a Try again that could never work; a network failure offers
 * Try again.
 */
export function CatalogError({ refusal, onRetry }: { refusal: CatalogRefusal; onRetry: () => void }) {
  if (refusal.reason === 'event_not_found') {
    return (
      <div className="screen-state">
        <h1 className="screen-state__message">{refusalLabels.event_not_found}</h1>
        <Link className="button" to="/">
          Browse events
        </Link>
      </div>
    )
  }
  return (
    <div className="screen-state">
      <h1 className="screen-state__message">{refusalLabels.network}</h1>
      <button type="button" className="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}
