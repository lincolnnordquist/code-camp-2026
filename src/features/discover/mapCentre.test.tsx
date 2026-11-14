// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codeCampCatalog } from './codeCampHall'

const api = vi.hoisted(() => ({
  getEventCatalog: vi.fn(),
  listMyOrders: vi.fn(),
}))

vi.mock('../../shared/api', () => api)
vi.mock('../../shared/live', () => ({
  subscribeToMyOrders: () => () => undefined,
  useOnlineStatus: () => true,
}))

const hall = codeCampCatalog()
const SLUG = hall.event.slug
const BOOTH = hall.booths.find((b) => b.id === 'b-figs')!

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  api.getEventCatalog.mockReset()
  api.getEventCatalog.mockResolvedValue({ ok: true, value: structuredClone(hall) })
  // jsdom has no matchMedia; reduced motion makes the zoom instant, so the commit is synchronous.
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  cleanup()
})

async function renderMapPage(entry: string) {
  const { MapPage } = await import('./MapPage')
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/e/:eventSlug/map" element={<MapPage />} />
      </Routes>
    </MemoryRouter>,
  )
  await act(async () => {})
}

const region = () => screen.getByRole('region', { name: /^Floor plan, zoomed to/ })
const canvas = () => region().querySelector<HTMLElement>('.floor-map__canvas')!
/** The layer that carries the zoomed width, with room around the plan while zoomed. */
const pan = () => region().querySelector<HTMLElement>('.floor-map__pan')!
describe('find on map: centre on booth', () => {
  it('opens at fit with the booth highlighted', async () => {
    await renderMapPage(`/e/${SLUG}/map?booth=${BOOTH.id}`)
    expect(region().getAttribute('aria-label')).toBe('Floor plan, zoomed to fit')
    expect(screen.getByRole('button', { name: new RegExp(`^Booth ${BOOTH.code},`) }).getAttribute('aria-current')).toBe('location')
  })

  it('"Show the whole room" is off at fit; zooming in turns it on, and it returns the map to fit with the booth still selected', async () => {
    await renderMapPage(`/e/${SLUG}/map?booth=${BOOTH.id}`)
    const whole = screen.getByRole('button', { name: 'Show the whole room' })
    expect(whole.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    await act(async () => {})
    expect(region().getAttribute('aria-label')).toBe('Floor plan, zoomed to 150%')
    expect(whole.getAttribute('aria-disabled')).toBe('false')
    fireEvent.click(whole)
    await act(async () => {})
    expect(region().getAttribute('aria-label')).toBe('Floor plan, zoomed to fit')
    expect(screen.getByRole('button', { name: new RegExp(`^Booth ${BOOTH.code},`) }).getAttribute('aria-current')).toBe('location')
  })

  it('a tap on a booth zooms to 2x around it where the card floats over the map, lays the canvas out at that width and says so', async () => {
    await renderMapPage(`/e/${SLUG}/map`)
    // jsdom applies no stylesheet, so the card's holder is made to float as it does on a phone.
    document.querySelector<HTMLElement>('.map-stage__card')!.style.position = 'absolute'
    const plate = screen.getByRole('button', { name: new RegExp(`^Booth ${BOOTH.code},`) })
    plate.focus()
    fireEvent.click(plate)
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    await act(async () => {})
    expect(region().getAttribute('aria-label')).toBe('Floor plan, zoomed to 200%')
    // Committed: the plan laid out at the real width, with the live transform and its layer hint cleared.
    expect(pan().style.width).toBe('200%')
    expect(canvas().style.transform).toBe('')
    expect(canvas().style.willChange).toBe('')
    const status = screen.getAllByRole('status').map((s) => s.textContent)
    expect(status).toContain(`Map zoomed to 200%, booth ${BOOTH.code} in the middle`)
    // Focus stays on the plate the person pressed; the announcement says what changed.
    expect(document.activeElement).toBe(plate)
    // Back to fit with the 0 key.
    fireEvent.keyDown(region(), { key: '0' })
    await act(async () => {})
    expect(region().getAttribute('aria-label')).toBe('Floor plan, zoomed to fit')
  })

  it('where the card sits beside or under the map, a tap selects the booth and the map keeps its zoom', async () => {
    await renderMapPage(`/e/${SLUG}/map`)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Booth ${BOOTH.code},`) }))
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    expect(region().getAttribute('aria-label')).toBe('Floor plan, zoomed to fit')
    expect(screen.getByRole('button', { name: new RegExp(`^Booth ${BOOTH.code},`) }).getAttribute('aria-current')).toBe('location')
  })

  it('a second tap on the selected booth deselects it', async () => {
    await renderMapPage(`/e/${SLUG}/map?booth=${BOOTH.id}`)
    const plate = screen.getByRole('button', { name: new RegExp(`^Booth ${BOOTH.code},`) })
    fireEvent.click(plate)
    await act(async () => {})
    expect(plate.getAttribute('aria-current')).toBeNull()
    expect(screen.getByText('Tap a booth to see who is there.')).toBeTruthy()
  })

  it('has no recentre button, legend, zoom tip or overview', async () => {
    await renderMapPage(`/e/${SLUG}/map?booth=${BOOTH.id}`)
    expect(screen.queryByRole('button', { name: 'Centre on booth' })).toBeNull()
    expect(document.querySelector('.floor-map__legend, .floor-map__hint, .floor-map__overview')).toBeNull()
  })
})
