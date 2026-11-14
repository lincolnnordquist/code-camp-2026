// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { Booth, Product } from '../../shared/types'
import { HomeHero } from './HomeHero'

const product = (id: string, name: string, priceCents: number): Product => ({
  id,
  boothId: 'b1',
  name,
  category: 'Figures',
  description: '',
  imageUrl: `https://example.test/${id}.png`,
  priceCents,
  availableQty: 3,
  maxPerOrder: 2,
})

const booths = new Map([['b1', { id: 'b1', vendorName: 'Scout Regiment Figures' } as Booth]])

afterEach(cleanup)

const renderHero = (products: Product[]) =>
  render(
    <MemoryRouter>
      <HomeHero products={products} boothsById={booths} currency="USD" />
    </MemoryRouter>,
  )

describe('featured hero', () => {
  it('names each slide by its product, price and vendor, with the price and vendor as separate parts', () => {
    renderHero([product('p1', 'Wing Gundam Zero Model Kit', 8900), product('p2', 'Survey Corps Hoodie', 5500)])
    const link = screen.getByRole('link', { name: /Wing Gundam Zero Model Kit/ })
    expect(link.textContent).toContain('$89.00')
    expect(link.querySelector('.hero__price')?.textContent).toBe('$89.00')
    expect(link.querySelector('.hero__vendor')?.textContent).toContain('Scout Regiment Figures')
    expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['1 of 2', '2 of 2'])
  })

  it('has a Pause toggle that stops the slides advancing (WCAG 2.2.2)', () => {
    const { container } = renderHero([product('p1', 'A', 100), product('p2', 'B', 200)])
    const pause = screen.getByRole('button', { name: 'Pause featured slides' })
    expect(pause.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('.hero')?.getAttribute('data-playing')).toBe('true')
    fireEvent.click(pause)
    expect(pause.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('.hero')?.getAttribute('data-playing')).toBe('false')
  })

  it('shows no controls for a single slide and nothing without products', () => {
    const { container, unmount } = renderHero([product('p1', 'A', 100)])
    expect(screen.queryByRole('button', { name: 'Pause featured slides' })).toBeNull()
    unmount()
    expect(renderHero([]).container.querySelector('.hero')).toBeNull()
    expect(container.querySelector('.hero')).toBeNull()
  })
})
