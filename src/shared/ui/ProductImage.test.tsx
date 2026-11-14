// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Product } from '../types'

const product = (imageUrl: string): Product => ({
  id: 'p-keychain',
  boothId: 'b-titan',
  name: 'Survey Corps Shaker Keychain',
  description: '',
  category: 'Accessories',
  priceCents: 900,
  availableQty: 5,
  maxPerOrder: 2,
  imageUrl,
})

afterEach(() => {
  cleanup()
  vi.resetModules()
})

// Fresh per test: the component remembers the photos shown on the page.
const load = async () => (await import('./ProductImage')).ProductImage

describe('ProductImage', () => {
  it('holds a thumbnail tile from the first frame and fades the photo in once it loads', async () => {
    const ProductImage = await load()
    const { container } = render(<ProductImage product={product('/p/keychain.webp')} size="small" eager />)
    const frame = container.firstElementChild!
    expect(frame.className).toBe('product-image product-image--small product-image--frame')
    const img = frame.querySelector('img')!
    expect(img.getAttribute('width')).toBe('88')
    expect(img.getAttribute('loading')).toBe('eager')
    expect(img.classList.contains('is-loaded')).toBe(false)
    fireEvent.load(img)
    expect(img.classList.contains('is-loaded')).toBe(true)
  })

  it('leaves a thumbnail lazy unless asked, and draws a photo shown before at once on the next screen', async () => {
    const ProductImage = await load()
    const first = render(<ProductImage product={product('/p/keychain.webp')} size="small" />)
    const img = first.container.querySelector('img')!
    expect(img.getAttribute('loading')).toBe('lazy')
    fireEvent.load(img)
    first.unmount()

    const again = render(<ProductImage product={product('/p/keychain.webp')} size="large" />)
    const shown = again.container.querySelector('img')!
    expect(shown.classList.contains('is-loaded')).toBe(true)
    expect(shown.getAttribute('loading')).toBe('eager')
  })
})
