// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refusalLabels } from '../../shared/ui/labels'

const api = vi.hoisted(() => ({
  getEventCatalog: vi.fn(),
  listMyOrders: vi.fn(),
}))

vi.mock('../../shared/api', () => api)
vi.mock('../../shared/live', () => ({
  subscribeToMyOrders: () => () => undefined,
  useOnlineStatus: () => true,
}))

const SLUG = 'no-such-event'

beforeEach(() => {
  localStorage.clear()
  api.getEventCatalog.mockReset()
  api.listMyOrders.mockReset().mockResolvedValue([])
  vi.resetModules()
})

afterEach(() => cleanup())

const screens: Array<[string, string, () => Promise<ReactElement>]> = [
  [
    'event home',
    `/e/${SLUG}`,
    async () => {
      const { EventHome } = await import('./EventHome')
      return <EventHome />
    },
  ],
  [
    'map',
    `/e/${SLUG}/map`,
    async () => {
      const { MapPage } = await import('./MapPage')
      return <MapPage />
    },
  ],
  [
    'booths',
    `/e/${SLUG}/booths`,
    async () => {
      const { BoothsPage } = await import('./BoothsPage')
      return <BoothsPage />
    },
  ],
  [
    'storefront',
    `/e/${SLUG}/booth/b-1`,
    async () => {
      const { Storefront } = await import('./Storefront')
      return <Storefront renderOrderControl={() => null} />
    },
  ],
]

async function renderRoute(entry: string, element: ReactElement) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<h1>Events</h1>} />
        <Route path="/e/:eventSlug" element={element} />
        <Route path="/e/:eventSlug/map" element={element} />
        <Route path="/e/:eventSlug/booths" element={element} />
        <Route path="/e/:eventSlug/booth/:boothId" element={element} />
      </Routes>
    </MemoryRouter>,
  )
  await act(async () => {})
}

describe('catalog errors on every discover route (QA D3)', () => {
  it.each(screens)('%s: an unknown event says so and offers a way to the events, not a Try again', async (_label, entry, make) => {
    api.getEventCatalog.mockResolvedValue({ ok: false, reason: 'event_not_found' })
    await renderRoute(entry, await make())
    expect(screen.getByRole('heading', { level: 1, name: refusalLabels.event_not_found })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Browse events' }).getAttribute('href')).toBe('/')
  })

  it.each(screens)('%s: a network failure keeps the connection message and Try again', async (_label, entry, make) => {
    api.getEventCatalog.mockRejectedValue(new Error('offline'))
    await renderRoute(entry, await make())
    expect(screen.getByRole('heading', { level: 1, name: refusalLabels.network })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Browse events' })).toBeNull()
  })
})
