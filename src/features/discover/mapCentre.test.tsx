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
const overview = () => document.querySelector('.floor-map__overview')

describe('find on map: centre on booth', () => {
  it('opens at fit with the booth highlighted and no overview', async () => {
    await renderMapPage(`/e/${SLUG}/map?booth=${BOOTH.id}`)
    expect(region().getAttribute('aria-label')).toBe('Floor plan, zoomed to fit')
    expect(screen.getByRole('button', { name: new RegExp(`^Booth ${BOOTH.code},`) }).getAttribute('aria-current')).toBe('location')
    expect(overview()).toBeNull()
  })

  it('zooms to 2x around the booth, lays the canvas out at that width and says so', async () => {
    await renderMapPage(`/e/${SLUG}/map?booth=${BOOTH.id}`)
    const centre = screen.getByRole('button', { name: 'Centre on booth' })
    centre.focus()
    fireEvent.click(centre)
    await act(async () => {})
    expect(region().getAttribute('aria-label')).toBe('Floor plan, zoomed to 200%')
    // Committed: the plan laid out at the real width, with the live transform and its layer hint cleared.
    expect(pan().style.width).toBe('200%')
    expect(canvas().style.transform).toBe('')
    expect(canvas().style.willChange).toBe('')
    const status = screen.getAllByRole('status').map((s) => s.textContent)
    expect(status).toContain(`Map zoomed to 200%, booth ${BOOTH.code} in the middle`)
    // Focus stays on the action the person pressed; the announcement says what changed.
    expect(document.activeElement).toBe(centre)
  })

  it('shows the overview while zoomed, hidden from assistive tech and out of the tab order', async () => {
    await renderMapPage(`/e/${SLUG}/map?booth=${BOOTH.id}`)
    fireEvent.click(screen.getByRole('button', { name: 'Centre on booth' }))
    await act(async () => {})
    const o = overview()!
    expect(o).not.toBeNull()
    expect(o.getAttribute('aria-hidden')).toBe('true')
    expect(o.hasAttribute('tabindex')).toBe(false)
    expect(o.querySelector('a, button, input, [tabindex]')).toBeNull()
    // Back to fit with the 0 key: the overview goes with the zoom.
    fireEvent.keyDown(region(), { key: '0' })
    await act(async () => {})
    expect(region().getAttribute('aria-label')).toBe('Floor plan, zoomed to fit')
    expect(overview()).toBeNull()
  })

  it('offers no centre action until a booth is selected', async () => {
    await renderMapPage(`/e/${SLUG}/map`)
    expect(screen.queryByRole('button', { name: 'Centre on booth' })).toBeNull()
  })
})
