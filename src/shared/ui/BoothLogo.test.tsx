// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Booth } from '../types'
import { BoothLogo } from './BoothLogo'

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

afterEach(cleanup)

describe('BoothLogo', () => {
  it('shows the vendor logo as a decorative image beside the name', () => {
    const { container } = render(<BoothLogo booth={booth('/branding/b-titan-logo.svg')} size="lg" />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/branding/b-titan-logo.svg')
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('width')).toBe('64')
  })

  it('shows the booth code in the quiet tile when there is no logo', () => {
    const { container } = render(<BoothLogo booth={booth('')} />)
    expect(container.querySelector('img')).toBeNull()
    const tile = container.querySelector('.booth-logo--code')!
    expect(tile.textContent).toBe('A3')
    expect(tile.getAttribute('aria-hidden')).toBe('true')
  })

  it('falls back to the code tile when the logo fails to load', () => {
    const { container } = render(<BoothLogo booth={booth('/branding/missing.svg')} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.booth-logo--code')?.textContent).toBe('A3')
  })
})
