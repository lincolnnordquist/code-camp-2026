import { MapSkeleton } from './DiscoverSkeletons'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { bannerPreloadProps } from './bannerPreload'
import { BoothLogo } from '../../shared/ui/BoothLogo'
import { EventBanner } from '../../shared/ui/EventBanner'
import { boothBadgeClass, boothBadgeLabel } from './boothLabel'
import { eventFloorLayout } from './catalogExtras'
import { FloorMap, type FloorMapHandle } from './FloorMap'
import { SavedCopyNote } from './SavedCopyNote'
import { CatalogError } from './CatalogError'
import { useCatalog } from './useCatalog'

/** Room kept between the booth card and the tab bar, and between the selected plate and the app header. */
const CARD_CLEARANCE_PX = 8
/** Room kept around the map's middle when centring, for half a zoomed plate. */
const CENTRED_PLATE_ROOM_PX = 48
/** Where scrollend is missing, the map's centring starts after this long. */
const PAGE_SCROLL_FALLBACK_MS = 450

/**
 * The visible bottom of the app header where it stays over the page (sticky or fixed): on a tab screen
 * the bar is a positioned child of a zero-height header. On a short landscape screen the header scrolls
 * away with the page and covers nothing, so it counts as 0 there.
 */
function headerBottom() {
  const header = document.querySelector('.app-header')
  if (!header || !['sticky', 'fixed'].includes(getComputedStyle(header).position)) return 0
  return Math.max(0, ...[header, ...header.children].map((el) => el.getBoundingClientRect().bottom))
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * "Centre on booth" puts the plate in the middle of the map, but on a short screen scrolled down to the
 * card that middle can sit under the sticky header. The page first scrolls just enough that the map's
 * middle, where the plate will land, is clear of the header and of the bottom bars.
 */
function revealMapMiddle(scroller: Element | null, then: () => void) {
  if (!scroller) return then()
  const rect = scroller.getBoundingClientRect()
  const middle = rect.top + rect.height / 2
  const top = headerBottom() + CARD_CLEARANCE_PX + CENTRED_PLATE_ROOM_PX
  const bottom = (document.querySelector('.bottom-bars')?.getBoundingClientRect().top ?? window.innerHeight) - CARD_CLEARANCE_PX - CENTRED_PLATE_ROOM_PX
  const by = middle < top ? middle - top : middle > bottom ? middle - bottom : 0
  if (by === 0 || reducedMotion()) {
    if (by !== 0) window.scrollBy({ top: by, behavior: 'auto' })
    return then()
  }
  // The map's own centring starts once the page has moved: WebKit drops a smooth page scroll when
  // another scroller starts moving during it (seen at 320 by 568).
  let started = false
  const start = () => {
    if (started) return
    started = true
    window.removeEventListener('scrollend', start)
    then()
  }
  window.addEventListener('scrollend', start)
  window.setTimeout(start, PAGE_SCROLL_FALLBACK_MS)
  window.scrollBy({ top: by, behavior: 'smooth' })
}

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
  // Set by a tap on a plate, so only a booth the person just picked brings its card into view.
  const revealCard = useRef(false)
  // The page opened on a selected booth, which no tap revealed.
  const openedWithSelection = useRef(Boolean(selectedId))
  const ready = state.status === 'ready'

  // The card opens below the map, often under the tab bar. The page scrolls up only as far as shows
  // it, and never so far that the selected plate (keyboard focus stays on it) goes under the sticky
  // app header (WCAG 2.4.11): the plate wins when both cannot fit.
  useEffect(() => {
    if (!revealCard.current) return
    revealCard.current = false
    const frame = requestAnimationFrame(() => {
      const card = cardRef.current
      const plate = document.querySelector('.floor-map__booth.is-highlighted')
      if (!card) return
      const barsTop = document.querySelector('.bottom-bars')?.getBoundingClientRect().top ?? window.innerHeight
      const toShowCard = card.getBoundingClientRect().bottom + CARD_CLEARANCE_PX - barsTop
      const plateRoom = plate ? plate.getBoundingClientRect().top - (headerBottom() + CARD_CLEARANCE_PX) : Infinity
      const by = Math.min(toShowCard, plateRoom)
      if (by <= 0) return
      window.scrollBy({ top: by, behavior: reducedMotion() ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedId])

  // Rotating the phone (or any resize) can leave the selected plate under the bottom bars or the header;
  // the page moves just enough to bring it back, once the map has settled at its new size.
  useEffect(() => {
    if (!selectedId) return
    let frame = 0
    const keepPlateVisible = () => {
      const plate = document.querySelector('.floor-map__booth.is-highlighted')?.getBoundingClientRect()
      if (!plate) return
      const top = headerBottom() + CARD_CLEARANCE_PX
      const bottom = (document.querySelector('.bottom-bars')?.getBoundingClientRect().top ?? window.innerHeight) - CARD_CLEARANCE_PX
      const by = plate.top < top ? plate.top - top : plate.bottom > bottom ? Math.min(plate.bottom - bottom, plate.top - top) : 0
      if (by !== 0) window.scrollBy({ top: by, behavior: 'auto' })
    }
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(keepPlateVisible)
      })
    }
    window.addEventListener('resize', onResize)
    // Opened with a booth already selected (Find booth, a shared link): the plate may start under the
    // tab bar, so it is brought into view once the map has laid out. A tap has its own reveal above.
    if (openedWithSelection.current && ready) {
      openedWithSelection.current = false
      onResize()
    }
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [selectedId, ready])

  if (state.status === 'loading') return <MapSkeleton />
  if (state.status === 'error') return <CatalogError refusal={state.refusal} onRetry={() => void reload()} />

  const { catalog } = state
  const selected = catalog.booths.find((b) => b.id === selectedId) ?? null
  // A booth that lists nothing (the team's own table) has no storefront to open.
  const selectedHasStorefront = selected !== null && catalog.products.some((p) => p.boothId === selected.id)

  return (
    <div className="map-page">
      <EventBanner name={catalog.event.name} venue={catalog.event.venueName} />
      <h1>{selected ? `Booth ${selected.code}` : 'Event map'}</h1>
      <SavedCopyNote show={state.fromCache} onRetry={() => void reload()} />
      <FloorMap
        ref={mapRef}
        floorPlanUrl={catalog.event.floorPlanUrl}
        floorLayout={eventFloorLayout(catalog.event)}
        venueName={catalog.event.venueName || catalog.event.name}
        booths={catalog.booths}
        highlightedBoothId={selected?.id}
        onSelectBooth={(b) => {
          revealCard.current = true
          setParams({ booth: b.id }, { replace: true })
          // Focus stays on the plate, so the details below the map are pointed to rather than moved to.
          setAnnouncement(`Booth ${b.code} selected, details below the map`)
        }}
        onClearSelection={() => {
          const next = new URLSearchParams(params)
          next.delete('booth')
          setParams(next, { replace: true })
          setAnnouncement('No booth selected')
        }}
      />
      {/* Always mounted, so each selection is announced. */}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      {selected ? (
        <section className="booth-card" ref={cardRef}>
          <div className="booth-card__head">
            <BoothLogo booth={selected} />
            <div className="booth-card__text">
              <h2>{selected.vendorName}</h2>
              {selected.slogan && <p>{selected.slogan}</p>}
              <span className={boothBadgeClass(selected)}>{boothBadgeLabel(selected)}</span>
            </div>
          </div>
          <div className="booth-card__buttons">
            <button
              type="button"
              className="button button--outlined"
              onClick={() => {
                const id = selected.id
                revealMapMiddle(document.querySelector('.map-page .floor-map__scroller'), () => mapRef.current?.centreOnBooth(id))
              }}
            >
              Centre on booth
            </button>
            {selectedHasStorefront && (
              <Link className="button" to={`/e/${eventSlug}/booth/${selected.id}`} {...bannerPreloadProps(selected)}>
                Open storefront
              </Link>
            )}
          </div>
        </section>
      ) : (
        // A link to a booth this event does not have (an old or mistyped one) says so instead of selecting nothing.
        <p className="note">{selectedId ? "That booth isn't on this map." : 'Select a booth to see who is there.'}</p>
      )}
    </div>
  )
}
