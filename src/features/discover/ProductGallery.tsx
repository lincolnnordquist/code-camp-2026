import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Product } from '../../shared/types'
import { ProductImage } from '../../shared/ui/ProductImage'
import { photoLabel, type ProductPhoto } from './productImages'

/** Without scrollend, a scroll is taken as finished after this long without movement. */
const SCROLL_SETTLE_MS = 120

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A product's photos in the sheet: a native scroll-snap track (the browser's own momentum), and one
 * small group of chevrons and dots on the photo. Only for two or more photos; one photo is just shown.
 * Keyed by product in the sheet, so another product starts at its first photo.
 */
export function ProductGallery({ product, photos, onOpen }: { product: Product; photos: readonly ProductPhoto[]; onOpen?: (index: number, e?: MouseEvent) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  // Spoken only after the person moves, so opening the sheet reads the product, not "Image 1 of 3".
  const [announcement, setAnnouncement] = useState('')
  const last = photos.length - 1

  // The current photo changes once per move, never from a position mid-scroll: a swipe settles when
  // the scroll ends, and a chevron sets it at once and ignores its own smooth scroll until that ends.
  // Reading it mid-scroll made the dot jump back while a chevron's scroll was still near the old photo.
  const indexRef = useRef(0)

  const settle = useCallback(
    (next: number) => {
      if (next === indexRef.current) return
      indexRef.current = next
      setIndex(next)
      setAnnouncement(photoLabel(product, photos, next))
    },
    [product, photos],
  )

  const go = (next: number) => {
    const track = trackRef.current
    const target = Math.max(0, Math.min(last, next))
    if (!track || target === indexRef.current) return
    track.scrollTo?.({ left: target * track.clientWidth, behavior: reducedMotion() ? 'instant' : 'smooth' })
    settle(target)
  }

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const settled = () => {
      if (track.clientWidth === 0) return
      settle(Math.max(0, Math.min(last, Math.round(track.scrollLeft / track.clientWidth))))
    }
    if ('onscrollend' in window) {
      track.addEventListener('scrollend', settled)
      return () => track.removeEventListener('scrollend', settled)
    }
    let timer = 0
    const onScroll = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(settled, SCROLL_SETTLE_MS)
    }
    track.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(timer)
      track.removeEventListener('scroll', onScroll)
    }
  }, [last, settle])

  // Left and Right move between photos while the photo has focus. Handled here, so the sheet, which
  // skips keys already handled, does not also page to another product.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Enter on the photo opens it full screen, as a tap does.
    if (e.key === 'Enter' && onOpen) {
      e.preventDefault()
      onOpen(indexRef.current)
      return
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    go(indexRef.current + (e.key === 'ArrowRight' ? 1 : -1))
  }

  return (
    <div className="gallery" role="region" aria-label={`Photos of ${product.name}`}>
      <div className="gallery__track" ref={trackRef} tabIndex={0} onKeyDown={onKeyDown} onClick={(e) => onOpen?.(indexRef.current, e.nativeEvent)}>
        {photos.map((photo, i) => {
          // Each photo is drawn like the main one (cutout treatment), each with its own fallback photo.
          const shown: Product & { fallbackImageUrl?: string } = { ...product, imageUrl: photo.url }
          if (i > 0) shown.fallbackImageUrl = photo.fallback
          return (
            <div key={photo.url} className="gallery__slide" role="group" aria-roledescription="slide" aria-label={photoLabel(product, photos, i)}>
              <ProductImage product={shown} size="large" />
            </div>
          )
        })}
      </div>
      {/* One small group on the photo: ‹ dots ›. The chevrons switch photos only. */}
      <div className="gallery__controls">
        <button
          type="button"
          className="gallery__nav"
          aria-label="Previous image"
          aria-disabled={index === 0 ? true : undefined}
          onClick={() => go(index - 1)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <span className="gallery__dots" aria-hidden="true">
          {photos.map((photo, i) => (
            <span key={photo.url} className={`gallery__dot${i === index ? ' is-current' : ''}`} />
          ))}
        </span>
        <button
          type="button"
          className="gallery__nav"
          aria-label="Next image"
          aria-disabled={index === last ? true : undefined}
          onClick={() => go(index + 1)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </div>
  )
}
