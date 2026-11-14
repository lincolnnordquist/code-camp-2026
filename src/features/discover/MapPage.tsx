import { MapSkeleton } from './DiscoverSkeletons'
import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { EventBanner } from '../../shared/ui/EventBanner'
import { eventFloorLayout } from './catalogExtras'
import { FloorMap, type FloorMapHandle } from './FloorMap'
import { MapBoothCard } from './MapBoothCard'
import { SavedCopyNote } from './SavedCopyNote'
import { CatalogError } from './CatalogError'
import { useCatalog } from './useCatalog'

/** Room kept between the selected booth and the card floating over the map. */
const CARD_CLEARANCE_PX = 24

/**
 * Full-screen map. `?booth=<id>` highlights one booth, so search results and
 * the order page can link straight to where the attendee needs to go.
 */
export function MapPage() {
  const { eventSlug = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { state, reload } = useCatalog(eventSlug)
  const selectedId = params.get('booth')
  const [announcement, setAnnouncement] = useState('')
  const mapRef = useRef<FloorMapHandle>(null)
  const cardRef = useRef<HTMLElement>(null)
  const ready = state.status === 'ready'

  // On a phone the card floats over the map's bottom edge, so the picked booth is zoomed to and
  // brought to the middle of what stays visible above it. Where the card sits beside or under the
  // map, the map keeps its zoom. Two frames, so the card has its height before it is measured.
  useEffect(() => {
    if (!selectedId || !ready) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const card = cardRef.current
        if (!card || getComputedStyle(card.parentElement!).position !== 'absolute') return
        mapRef.current?.centreOnBooth(selectedId, card.offsetHeight + CARD_CLEARANCE_PX)
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedId, ready])

  if (state.status === 'loading') return <MapSkeleton />
  if (state.status === 'error') return <CatalogError refusal={state.refusal} onRetry={() => void reload()} />

  const { catalog } = state
  const selected = catalog.booths.find((b) => b.id === selectedId) ?? null

  const clearSelection = () => {
    const next = new URLSearchParams(params)
    next.delete('booth')
    setParams(next, { replace: true })
    setAnnouncement('No booth selected')
  }

  return (
    <div className="map-page">
      <EventBanner name={catalog.event.name} venue={catalog.event.venueName} />
      <h1 className="visually-hidden">{selected ? `Booth ${selected.code}` : 'Event map'}</h1>
      {/* The shell's pull-to-refresh stays out: the page does not scroll on a phone, and the map and card own their drags. */}
      <div className="map-stage" data-no-pull="">
        <SavedCopyNote show={state.fromCache} onRetry={() => void reload()} />
        <div className="map-stage__map">
          <FloorMap
            ref={mapRef}
            floorPlanUrl={catalog.event.floorPlanUrl}
            floorLayout={eventFloorLayout(catalog.event)}
            venueName={catalog.event.venueName || catalog.event.name}
            booths={catalog.booths}
            highlightedBoothId={selected?.id}
            onSelectBooth={(b) => {
              setParams({ booth: b.id }, { replace: true })
              // Focus stays on the plate, so the details below the map are pointed to rather than moved to.
              setAnnouncement(`Booth ${b.code} selected, details below the map`)
            }}
            onClearSelection={clearSelection}
          />
          {/* Always mounted, so each selection is announced. */}
          <p className="visually-hidden" role="status">
            {announcement}
          </p>
          <div className="map-stage__card">
            {selected ? (
              <MapBoothCard
                ref={cardRef}
                booth={selected}
                products={catalog.products.filter((p) => p.boothId === selected.id)}
                eventSlug={eventSlug}
                currency={catalog.event.currency}
                onClose={clearSelection}
              />
            ) : (
              <div className="map-card map-card--empty">
                <h2 className="map-card__name">Event map</h2>
                {/* A link to a booth this event does not have (an old or mistyped one) says so instead of selecting nothing. */}
                {selectedId ? (
                  <p>That booth isn't on this map.</p>
                ) : (
                  <p>
                    <span className="map-card__hint-touch">Tap a booth to see who is there.</span>
                    <span className="map-card__hint-wide">Select a booth to see who is there.</span>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
