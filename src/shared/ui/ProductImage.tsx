import { useState } from 'react'
import type { Product } from '../types'
import './ProductImage.css'

/** Intrinsic sizes for the width and height attributes, so the box is reserved before the photo arrives. */
const IMAGE_SIZE = { small: { width: 88, height: 88 }, large: { width: 800, height: 600 } } as const

/**
 * Optional image hints, not in the shared contract yet: `imageFit` "contain" marks a
 * cutout (a transparent product on its own margin), drawn whole on the tile with a soft shadow;
 * anything else is a photo that fills the tile. `fallbackImageUrl` is tried, as a photo, when the
 * main image fails.
 */
type ImageHints = { imageFit?: 'cover' | 'contain'; fallbackImageUrl?: string }

/**
 * Photos that have loaded on this page, so a screen shown again (Back to the home, the order page
 * after the wallet) draws them at once instead of fading them in a second time.
 */
const shownPhotos = new Set<string>()

/**
 * Seeded products may have no photo yet, and a photo that is not cached fails
 * offline; both show a labelled tile instead of a broken image.
 */
export function ProductImage({
  product,
  size,
  priority = false,
  eager = false,
}: {
  product: Product
  size: 'small' | 'large'
  priority?: boolean
  /** Load at once rather than when scrolled near: a few thumbnails at the top of a screen (an order's items). */
  eager?: boolean
}) {
  const { imageFit, fallbackImageUrl } = product as Product & ImageHints
  // Remembers which URLs failed and which loaded, so a product whose photo changes tries (and fades in) the new one.
  const [failedUrls, setFailedUrls] = useState<readonly string[]>([])
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  // An empty address (a product saved without a photo) shows the tile, like a photo that fails.
  const candidates = [product.imageUrl, fallbackImageUrl].filter((u): u is string => Boolean(u))
  const url = candidates.find((u) => !failedUrls.includes(u)) ?? null
  // The fallback is an ordinary photo, so it fills the tile whatever the main image was.
  const fit = url === product.imageUrl && imageFit === 'contain' ? 'contain' : 'cover'
  if (url) {
    const shown = priority || loadedUrl === url || shownPhotos.has(url)
    return (
      // The frame holds the box and the tile colour; the photo fades in over it.
      <span className={`product-image product-image--${size} product-image--frame`} data-fit={fit}>
        <img
          // A priority image (the screen's largest, first paint) loads at once and shows without the
          // fade, which would hold back its paint and the Largest Contentful Paint with it.
          className={`product-image__photo${shown ? ' is-loaded' : ''}`}
          src={url}
          alt=""
          {...IMAGE_SIZE[size]}
          // A photo shown before is in the browser's cache, so it loads at once wherever it sits.
          loading={priority || eager || shownPhotos.has(url) ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding={priority ? undefined : 'async'}
          // A photo already in the cache can finish before React attaches onLoad.
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0 && loadedUrl !== url) {
              shownPhotos.add(url)
              setLoadedUrl(url)
            }
          }}
          onLoad={() => {
            shownPhotos.add(url)
            setLoadedUrl(url)
          }}
          onError={() => setFailedUrls((f) => [...f, url])}
        />
      </span>
    )
  }
  return (
    <div className={`product-image product-image--${size} product-image--placeholder`} aria-hidden="true">
      {product.category}
    </div>
  )
}
