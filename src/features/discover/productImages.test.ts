import { describe, expect, it } from 'vitest'
import type { Product } from '../../shared/types'
import { photoLabel, productImages } from './productImages'

const hoodie = (extra: Record<string, unknown> = {}): Product =>
  ({
    id: 'p1',
    boothId: 'b',
    name: 'Survey Corps Hoodie',
    description: '',
    category: 'Apparel',
    priceCents: 5500,
    availableQty: 4,
    maxPerOrder: 2,
    imageUrl: '/p1.webp',
    ...extra,
  }) as Product

describe('productImages', () => {
  it('is the one contract image when there are no extras', () => {
    expect(productImages(hoodie())).toEqual([{ url: '/p1.webp' }])
  })

  it('puts the main image first, then the extras with their labels', () => {
    expect(productImages(hoodie({ images: ['/p1-2.webp', { url: '/p1-3.webp', label: 'back' }] }))).toEqual([
      { url: '/p1.webp' },
      { url: '/p1-2.webp' },
      { url: '/p1-3.webp', label: 'back' },
    ])
  })

  it('lists each address once, keeping a label given on a repeat of the main image', () => {
    expect(productImages(hoodie({ images: [{ url: '/p1.webp', label: 'front' }, '/p1-2.webp', '/p1-2.webp'] }))).toEqual([
      { url: '/p1.webp', label: 'front' },
      { url: '/p1-2.webp' },
    ])
  })

  it('skips malformed extras and survives a non-list', () => {
    expect(productImages(hoodie({ images: [null, 7, '', ' ', { label: 'no url' }, { url: 3 }, '/ok.webp'] }))).toEqual([
      { url: '/p1.webp' },
      { url: '/ok.webp' },
    ])
    expect(productImages(hoodie({ images: 'not a list' }))).toEqual([{ url: '/p1.webp' }])
  })

  it('keeps an extra photo fallback and ignores one that is not text', () => {
    expect(productImages(hoodie({ images: [{ url: '/b.webp', label: 'Back', fallback: '/b.jpg' }, { url: '/c.webp', fallback: 5 }] }))).toEqual([
      { url: '/p1.webp' },
      { url: '/b.webp', label: 'Back', fallback: '/b.jpg' },
      { url: '/c.webp' },
    ])
  })

  it('has no photos when the product has no image and no extras', () => {
    expect(productImages(hoodie({ imageUrl: '' }))).toEqual([])
  })

  it('names a photo by position, product and what it shows', () => {
    const photos = productImages(hoodie({ images: [{ url: '/b.webp', label: 'back' }] }))
    expect(photoLabel(hoodie(), photos, 1)).toBe('Image 2 of 2, Survey Corps Hoodie, back')
    expect(photoLabel(hoodie(), photos, 0)).toBe('Image 1 of 2, Survey Corps Hoodie')
  })
})
