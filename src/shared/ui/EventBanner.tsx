import { useEffect, useRef, type ReactNode } from 'react'
import './EventBanner.css'

/** Scroll distance over which the phone banner shrinks from 168 to 96 px. */
const COLLAPSE_PX = 72

/**
 * The event's banner over a tab: pinned to the top on a phone and shrinking as the page scrolls,
 * a rounded block at the top of the page on a wide screen. Events have no banner image yet, so it
 * is a solid block.
 */
export function EventBanner({
  name,
  venue,
  action,
  decorative = false,
}: {
  name: string
  venue: string
  action?: ReactNode
  /** The page names the event in its own heading, so screen readers skip the banner's copy. */
  decorative?: boolean
}) {
  const bannerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const progress = Math.min(1, Math.max(0, window.scrollY / COLLAPSE_PX))
      bannerRef.current?.style.setProperty('--collapse', String(progress))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
    }
  }, [])

  return (
    <>
      <div className="event-banner__space" aria-hidden="true" />
      <div className="event-banner" ref={bannerRef} aria-hidden={decorative || undefined}>
        <div className="event-banner__scrim" />
        <div className="event-banner__content">
          <div className="event-banner__text">
            <p className="event-banner__name">{name}</p>
            <p className="event-banner__venue">{venue}</p>
          </div>
          {action}
        </div>
      </div>
    </>
  )
}
