// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Booth } from '../types'

const booth = (logoUrl: string): Booth => ({
  id: 'b-titan',
  vendorName: 'Wall Rose Goods',
  slogan: 'Anime apparel and patches',
  logoUrl,
  bannerUrl: '',
  code: 'A3',
  mode: 'reservation',
  orderingPaused: false,
  mapX: 0.1,
  mapY: 0.4,
  pickupInstructions: '',
})

afterEach(() => {
  cleanup()
  vi.resetModules()
})

// Fresh per test: the component remembers the logos shown on the page.
const load = async () => (await import('./BoothLogo')).BoothLogo

describe('BoothLogo', () => {
  it('shows the vendor logo as a decorative image beside the name', async () => {
    const BoothLogo = await load()
    const { container } = render(<BoothLogo booth={booth('/branding/b-titan-logo.svg')} size="lg" />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/branding/b-titan-logo.svg')
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('width')).toBe('64')
  })

  it('shows the booth code in the quiet tile when there is no logo', async () => {
    const BoothLogo = await load()
    const { container } = render(<BoothLogo booth={booth('')} />)
    expect(container.querySelector('img')).toBeNull()
    const tile = container.querySelector('.booth-logo--code')!
    expect(tile.textContent).toBe('A3')
    expect(tile.getAttribute('aria-hidden')).toBe('true')
  })

  it('falls back to the code tile when the logo fails to load', async () => {
    const BoothLogo = await load()
    const { container } = render(<BoothLogo booth={booth('/branding/missing.svg')} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.booth-logo--code')?.textContent).toBe('A3')
  })

  it('holds the final circle from the first frame and fades the logo in once it loads', async () => {
    const BoothLogo = await load()
    const { container } = render(<BoothLogo booth={booth('/branding/b-titan-logo.svg')} size="lg" className="storefront__logo" />)
    const frame = container.firstElementChild!
    // The circle (size class, placement class) is the frame, present before the image has loaded.
    expect(frame.tagName).toBe('SPAN')
    expect(frame.className).toBe('booth-logo booth-logo--lg booth-logo--frame storefront__logo')
    const img = frame.querySelector('img')!
    expect(img.classList.contains('is-loaded')).toBe(false)
    expect(img.getAttribute('loading')).toBe('lazy')
    fireEvent.load(img)
    expect(img.classList.contains('is-loaded')).toBe(true)
  })

  it('loads the storefront logo at once and first, and draws a logo shown before without fading it again', async () => {
    const BoothLogo = await load()
    const first = render(<BoothLogo booth={booth('/branding/b-titan-logo.svg')} size="lg" priority />)
    const img = first.container.querySelector('img')!
    expect(img.getAttribute('loading')).toBe('eager')
    expect(img.getAttribute('fetchpriority')).toBe('high')
    fireEvent.load(img)
    first.unmount()

    const again = render(<BoothLogo booth={booth('/branding/b-titan-logo.svg')} />)
    const shown = again.container.querySelector('img')!
    expect(shown.classList.contains('is-loaded')).toBe(true)
    expect(shown.getAttribute('loading')).toBe('eager')
  })
})
