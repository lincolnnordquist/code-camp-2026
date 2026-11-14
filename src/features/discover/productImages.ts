import type { Product } from '../../shared/types'

/** One photo of a product, with what it shows ("Back") and a plain photo to try if it fails, when the data says. */
export interface ProductPhoto {
  url: string
  label?: string
  fallback?: string
}

/**
 * Extra angles come from the product's optional `images` list: the shared API gives every photo's
 * URL there, the main one first. A host app may instead give `{ url, label, fallback }` entries.
 * Anything malformed is skipped.
 */
type WithImages = Product & { images?: unknown }

const asPhoto = (entry: unknown): ProductPhoto | null => {
  if (typeof entry === 'string') return entry.trim() ? { url: entry } : null
  if (typeof entry !== 'object' || entry === null) return null
  const { url, label, fallback } = entry as { url?: unknown; label?: unknown; fallback?: unknown }
  if (typeof url !== 'string' || url.trim() === '') return null
  return {
    url,
    ...(typeof label === 'string' && label.trim() && { label: label.trim() }),
    ...(typeof fallback === 'string' && fallback.trim() && { fallback }),
  }
}

/** Every photo of the product, the main `imageUrl` first, each address once. Empty when it has none. */
export function productImages(product: Product): ProductPhoto[] {
  const extra = (product as WithImages).images
  const candidates: ProductPhoto[] = []
  if (product.imageUrl) candidates.push({ url: product.imageUrl })
  if (Array.isArray(extra)) {
    for (const entry of extra) {
      const photo = asPhoto(entry)
      if (photo) candidates.push(photo)
    }
  }
  // A repeated address is one photo; a label given on the repeat (the main photo's "front") is kept.
  const byUrl = new Map<string, ProductPhoto>()
  for (const photo of candidates) {
    const first = byUrl.get(photo.url)
    if (!first) byUrl.set(photo.url, photo)
    else if (!first.label && photo.label) byUrl.set(photo.url, { ...first, label: photo.label })
  }
  return [...byUrl.values()]
}

/** The spoken name of one photo: "Image 2 of 3, Survey Corps Hoodie, back". */
export function photoLabel(product: Product, photos: readonly ProductPhoto[], index: number): string {
  const label = photos[index]?.label
  return `Image ${index + 1} of ${photos.length}, ${product.name}${label ? `, ${label}` : ''}`
}
