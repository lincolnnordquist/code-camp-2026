// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booth, EventCatalog, Product } from '../../shared/types'
import { clampPan, dismisses, NO_ZOOM, swipeStep, toggleZoom, zoomAround, type Frame } from './photoZoom'

const api = vi.hoisted(() => ({ getEventCatalog: vi.fn(), listMyOrders: vi.fn() }))
vi.mock('../../shared/api', () => api)
vi.mock('../../shared/live', () => ({ subscribeToMyOrders: () => () => undefined, useOnlineStatus: () => true }))

const SLUG = 'ev'
const BOOTH: Booth = {
  id: 'b-res',
  code: 'A3',
  vendorName: 'Wall Rose Goods',
  slogan: '',
  logoUrl: '',
  bannerUrl: '',
  mode: 'reservation',
  orderingPaused: false,
  pickupInstructions: '',
  mapX: 0.5,
  mapY: 0.5,
}
const HOODIE = {
  id: 'p-hoodie',
  boothId: 'b-res',
  name: 'Titan Hoodie',
  description: 'Warm.',
  category: 'Apparel',
  priceCents: 1200,
  availableQty: 4,
  maxPerOrder: 2,
  imageUrl: '/front.png',
  images: ['/front.png', '/back.png', '/tag.png'],
} satisfies Product
const CATALOG: EventCatalog = {
  event: { id: 'e', slug: SLUG, name: 'Con', venueName: 'Hall', currency: 'USD', floorPlanUrl: '', reservationHoldMinutes: 120 },
  booths: [BOOTH],
  products: [HOODIE],
}

function HistoryProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <p data-testid="url">{location.pathname + location.search}</p>
      <button type="button" onClick={() => navigate(-1)}>
        Browser back
      </button>
    </>
  )
}

async function openSheet() {
  const { Storefront } = await import('./Storefront')
  render(
    <MemoryRouter initialEntries={[`/e/${SLUG}/booth/b-res`]}>
      <Routes>
        <Route path="/e/:eventSlug/booth/:boothId" element={<Storefront renderOrderControl={() => null} />} />
      </Routes>
      <HistoryProbe />
    </MemoryRouter>,
  )
  await act(async () => {})
  fireEvent.click(screen.getByRole('link', { name: /^Titan Hoodie/ }))
  return screen.getByRole('dialog', { name: 'Titan Hoodie' })
}

const viewer = () => screen.queryByRole('dialog', { name: 'Photos of Titan Hoodie' })
const browserBack = () => fireEvent.click(screen.getByRole('button', { name: 'Browser back', hidden: true }))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(`catalog.v4.${SLUG}`, JSON.stringify(CATALOG))
  api.getEventCatalog.mockReset().mockReturnValue(new Promise(() => undefined))
  api.listMyOrders.mockReset().mockResolvedValue([])
  vi.resetModules()
})
afterEach(cleanup)

describe('full-screen photo viewer', () => {
  it('opens from the expand button on the same URL, with focus on Close, and Back closes only the viewer', async () => {
    const sheet = await openSheet()
    const url = screen.getByTestId('url').textContent
    const expand = within(sheet).getByRole('button', { name: 'View photos full screen' })
    expand.focus()
    fireEvent.click(expand)
    expect(viewer()).not.toBeNull()
    expect(screen.getByTestId('url').textContent).toBe(url)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close photos' }))
    // The sheet behind is out of reach while the viewer is up.
    expect(sheet.closest<HTMLElement>('.sheet-layer')?.inert).toBe(true)

    browserBack()
    expect(viewer()).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Titan Hoodie' })).toBeTruthy()
    expect(screen.getByTestId('url').textContent).toBe(url)
    expect(document.activeElement).toBe(expand)
    expect(sheet.closest<HTMLElement>('.sheet-layer')?.inert).toBe(false)
  })

  it('a tap on the photo opens it; Escape and Close each close the viewer and leave the sheet open', async () => {
    const sheet = await openSheet()
    fireEvent.click(sheet.querySelector('.gallery__track')!)
    expect(viewer()).not.toBeNull()
    fireEvent.keyDown(viewer()!, { key: 'Escape' })
    expect(viewer()).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Titan Hoodie' })).toBeTruthy()

    fireEvent.click(within(sheet).getByRole('button', { name: 'View photos full screen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close photos' }))
    expect(viewer()).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Titan Hoodie' })).toBeTruthy()
  })

  it('arrow keys and the arrows move between the same photos, stopping at the ends', async () => {
    const sheet = await openSheet()
    fireEvent.click(within(sheet).getByRole('button', { name: 'View photos full screen' }))
    const v = viewer()!
    expect(v.querySelectorAll('img')).toHaveLength(3)
    expect(within(v).getByText('1 of 3')).toBeTruthy()
    expect(within(v).getByRole('button', { name: 'Previous image' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.keyDown(v, { key: 'ArrowRight' })
    expect(within(v).getByText('2 of 3')).toBeTruthy()
    expect(within(v).getByRole('status').textContent).toBe('Image 2 of 3, Titan Hoodie')
    fireEvent.click(within(v).getByRole('button', { name: 'Next image' }))
    fireEvent.keyDown(v, { key: 'ArrowRight' })
    expect(within(v).getByText('3 of 3')).toBeTruthy()
    fireEvent.keyDown(v, { key: 'ArrowLeft' })
    expect(within(v).getByText('2 of 3')).toBeTruthy()
  })

  it('keeps Tab inside the viewer', async () => {
    const sheet = await openSheet()
    fireEvent.click(within(sheet).getByRole('button', { name: 'View photos full screen' }))
    const v = viewer()!
    const close = within(v).getByRole('button', { name: 'Close photos' })
    const next = within(v).getByRole('button', { name: 'Next image' })
    next.focus()
    fireEvent.keyDown(next, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(next)
  })
})

describe('photo zoom arithmetic', () => {
  const frame: Frame = { stageW: 400, stageH: 800, photoW: 400, photoH: 400 }

  it('zooms around the pointer, keeping the photo point under it in place', () => {
    const z = zoomAround(NO_ZOOM, 2, { x: 100, y: 0 }, frame)
    expect(z).toEqual({ s: 2, tx: -100, ty: 0 })
    // The photo point that was at x = 100 is still at x = 100: tx + s * 100 = 100.
    expect(z.tx + z.s * 100).toBe(100)
  })

  it('never pans past the photo edges, nor on an axis the zoomed photo still fits', () => {
    expect(clampPan({ s: 2, tx: 900, ty: 900 }, frame)).toEqual({ s: 2, tx: 200, ty: 0 })
  })

  it('stays within 1x to 4x, and back at 1x is exactly the whole photo', () => {
    expect(zoomAround(NO_ZOOM, 9, { x: 0, y: 0 }, frame).s).toBe(4)
    expect(zoomAround({ s: 2, tx: -50, ty: 0 }, 0.5, { x: 0, y: 0 }, frame)).toEqual(NO_ZOOM)
  })

  it('double tap zooms in around the tap, and again back out', () => {
    const z = toggleZoom(NO_ZOOM, { x: 0, y: 0 }, frame)
    expect(z.s).toBe(2.5)
    expect(toggleZoom(z, { x: 0, y: 0 }, frame)).toEqual(NO_ZOOM)
  })

  it('a swipe pages past a fifth of the stage or on a flick; a swipe down closes past 120 px or on a flick', () => {
    expect(swipeStep(-50, 500, 400)).toBe(0)
    expect(swipeStep(-90, 500, 400)).toBe(1)
    expect(swipeStep(90, 500, 400)).toBe(-1)
    expect(swipeStep(-40, 50, 400)).toBe(1)
    expect(dismisses(100, 600)).toBe(false)
    expect(dismisses(130, 600)).toBe(true)
    expect(dismisses(60, 60)).toBe(true)
  })
})
