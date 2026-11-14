import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { EventCatalog } from '../../shared/types'
import { eventFloorLayout } from './catalogExtras'
import { drawnAspectRatio } from './mapGeometry'

// The map code is not needed for the home's first screen (the preview sits below the fold), so it
// loads as its own chunk when the preview comes near the screen.
const FloorMap = lazy(() => import('./FloorMap').then((m) => ({ default: m.FloorMap })))

/** How far below the screen the preview starts loading, so it is drawn before it scrolls in. */
const LOAD_AHEAD = '400px 0px'

/** The plan without a layout: FloorMap's own default until a floor-plan image reports its size. */
const IMAGE_ASPECT_RATIO = '1000 / 840'

/** The home's map preview: a same-size placeholder until the map code has loaded. */
export function HomeMapPreview({ catalog, venueName }: { catalog: EventCatalog; venueName: string }) {
  const holderRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  const layout = eventFloorLayout(catalog.event)

  useEffect(() => {
    const holder = holderRef.current
    if (near || !holder) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setNear(true)
        observer.disconnect()
      },
      { rootMargin: LOAD_AHEAD },
    )
    observer.observe(holder)
    return () => observer.disconnect()
  }, [near])

  const placeholder = (
    <div className="floor-map floor-map--placeholder" style={{ aspectRatio: layout ? drawnAspectRatio(layout) : IMAGE_ASPECT_RATIO }} />
  )
  return (
    <div ref={holderRef}>
      {near ? (
        <Suspense fallback={placeholder}>
          <FloorMap floorPlanUrl={catalog.event.floorPlanUrl} floorLayout={layout} venueName={venueName} booths={catalog.booths} />
        </Suspense>
      ) : (
        placeholder
      )}
    </div>
  )
}
