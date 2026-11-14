// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booth, BoothMode, EventCatalog, Product, Result } from '../../shared/types'

import { boothBadgeLabel, isPaused } from './boothLabel'

const api = vi.hoisted(() => ({
  getEventCatalog: vi.fn(),
  listMyOrders: vi.fn(),
}))

vi.mock('../../shared/api', () => api)
vi.mock('../../shared/live', () => ({
  subscribeToMyOrders: () => () => undefined,
  useOnlineStatus: () => true,
}))

const SLUG = 'ev'
const CACHE_KEY = `catalog.v4.${SLUG}`

const booth = (id: string, code: string, vendorName: string, mode: BoothMode, orderingPaused = false): Booth => ({
  id,
  code,
  vendorName,
  slogan: '',
  logoUrl: '',
  bannerUrl: '',
  mode,
  orderingPaused,
  pickupInstructions: '',
  mapX: 0.005, mapY: 0.005,
})

const product = (id: string, boothId: string, name: string, availableQty: number, description = '', category = 'Merch'): Product => ({
  id,
  boothId,
  name,
  description,
  category,
  priceCents: 1000,
  availableQty,
  maxPerOrder: 2,
  imageUrl: '',
})

const booths = {
  reservation: booth('b-res', 'A3', 'Wall Rose Goods', 'reservation'),
  prepay: booth('b-pre', 'B6', 'Pixel Forge Prints', 'prepay'),
  figures: booth('b-figs', 'E4', 'Scout Regiment Figures', 'reservation'),
  pausedReservation: booth('b-plush', 'D5', 'Soft Kaiju Plush', 'reservation', true),
  pausedPrepay: booth('b-dice', 'C2', 'Critical Hit Dice', 'prepay', true),
  discovery: booth('b-art', 'I7', 'Inkwell Artist Alley', 'discovery'),
}

function makeCatalog(eventName = 'Code Camp Con'): EventCatalog {
  return {
    event: {
      id: 'evt',
      slug: SLUG,
      name: eventName,
      venueName: 'Hall',
      currency: 'USD',
      floorPlanUrl: '/plan.svg',
      reservationHoldMinutes: 120,
    },
    booths: Object.values(booths),
    products: [
      product('p-hoodie', 'b-res', 'Attack on Titan Hoodie', 4, 'Embroidered wings.', 'Apparel'),
      product('p-tee', 'b-res', 'Attack on Titan Tee', 0, 'Screen printed.', 'Apparel'),
      product('p-mecha', 'b-res', 'Retro Mecha Tee', 3, 'Cotton tee.', 'Apparel'),
      product('p-poster', 'b-pre', 'Attack on Titan Poster', 6, 'Matte print.', 'Prints'),
      // Matched by "attack on titan" only through its description.
      product('p-levi', 'b-figs', 'Levi Ackerman Figure', 1, 'Limited 7 inch figure, Attack on Titan.', 'Figures'),
      product('p-plush', 'b-plush', 'Tiny Kaiju Plush', 10, 'Handmade.', 'Plush'),
      product('p-dice', 'b-dice', 'Obsidian Dice Set', 8, 'Seven pieces.', 'Tabletop'),
      product('p-sketch', 'b-art', 'Custom Sketch Card', 20, 'Ask at the booth.', 'Prints'),
    ],
  }
}

const ok = (catalog: EventCatalog): Result<EventCatalog, 'event_not_found'> => ({ ok: true, value: catalog })
const never = <T,>() => new Promise<T>(() => undefined)

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const saveCatalog = (catalog: EventCatalog) => localStorage.setItem(CACHE_KEY, JSON.stringify(catalog))

/** Lets pending promise callbacks and the React updates they cause settle inside act. */
const settle = () => act(async () => {})

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  Object.values(api).forEach((fn) => {
    fn.mockReset()
  })
  vi.resetModules()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useCatalog (FR-26)', () => {
  type Seen = Array<{ status: string; fromCache?: boolean; catalog?: EventCatalog; reason?: string }>

  async function renderProbe(seen: Seen) {
    const { useCatalog } = await import('./useCatalog')
    function Probe() {
      const { state } = useCatalog(SLUG)
      seen.push(
        state.status === 'ready'
          ? { status: 'ready', fromCache: state.fromCache, catalog: state.catalog }
          : state.status === 'error'
            ? { status: 'error', reason: state.refusal.reason }
            : { status: 'loading' },
      )
      return null
    }
    render(<Probe />)
  }

  it('opens ready from the saved copy on the first render, without the saved-info flag', async () => {
    const saved = makeCatalog('Saved')
    saveCatalog(saved)
    const refresh = deferred<Result<EventCatalog, 'event_not_found'>>()
    api.getEventCatalog.mockReturnValue(refresh.promise)
    const seen: Seen = []

    await renderProbe(seen)

    expect(seen[0]).toEqual({ status: 'ready', fromCache: false, catalog: saved })
    expect(api.getEventCatalog).toHaveBeenCalledWith(SLUG)

    // A normal successful refresh never shows the saved-info flag in between (no flash).
    refresh.resolve(ok(makeCatalog('Fresh')))
    await settle()
    expect(seen.at(-1)).toMatchObject({ status: 'ready', fromCache: false })
    expect(seen.at(-1)?.catalog?.event.name).toBe('Fresh')
    expect(seen.some((s) => s.status !== 'ready' || s.fromCache)).toBe(false)
  })

  it.each([
    ['the request throws', () => Promise.reject(new Error('offline'))],
    ['the server refuses', () => Promise.resolve({ ok: false, reason: 'event_not_found' } as Result<EventCatalog, 'event_not_found'>)],
  ])('keeps the saved catalog and sets fromCache when the refresh fails because %s', async (_label, fail) => {
    const saved = makeCatalog('Saved')
    saveCatalog(saved)
    api.getEventCatalog.mockImplementation(fail)
    const seen: Seen = []

    await renderProbe(seen)
    await settle()

    expect(seen.at(-1)).toEqual({ status: 'ready', fromCache: true, catalog: saved })
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toEqual(saved)
  })

  it('shows an error with reason network when there is no saved copy and the refresh fails', async () => {
    api.getEventCatalog.mockRejectedValue(new Error('offline'))
    const seen: Seen = []

    await renderProbe(seen)
    expect(seen[0]).toEqual({ status: 'loading' })
    await settle()

    expect(seen.at(-1)).toEqual({ status: 'error', reason: 'network' })
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
  })

  it('shows an error with the reason event_not_found when the server does not know the event', async () => {
    api.getEventCatalog.mockResolvedValue({ ok: false, reason: 'event_not_found' })
    const seen: Seen = []

    await renderProbe(seen)
    await settle()

    expect(seen.at(-1)).toEqual({ status: 'error', reason: 'event_not_found' })
  })

  it('treats an unreadable saved copy as no saved copy', async () => {
    localStorage.setItem(CACHE_KEY, '{not json')
    api.getEventCatalog.mockRejectedValue(new Error('offline'))
    const seen: Seen = []

    await renderProbe(seen)
    expect(seen[0]).toEqual({ status: 'loading' })
    await settle()

    expect(seen.at(-1)).toEqual({ status: 'error', reason: 'network' })
  })

  it.each(['42', '[]', '"text"', '{}', '{"event":{},"booths":"x","products":[]}'])(
    'treats a saved copy that is not shaped like a catalog (%s) as no saved copy',
    async (saved) => {
      localStorage.setItem(CACHE_KEY, saved)
      api.getEventCatalog.mockRejectedValue(new Error('offline'))
      const seen: Seen = []

      await renderProbe(seen)
      expect(seen[0]).toEqual({ status: 'loading' })
      await settle()

      expect(seen.at(-1)).toEqual({ status: 'error', reason: 'network' })
    },
  )

  it('replaces the saved copy for this event only after a successful refresh', async () => {
    saveCatalog(makeCatalog('Old'))
    const otherEvent = JSON.stringify(makeCatalog('Other event'))
    localStorage.setItem('catalog.v4.other', otherEvent)
    const fresh = makeCatalog('Fresh')
    api.getEventCatalog.mockResolvedValue(ok(fresh))
    const seen: Seen = []

    await renderProbe(seen)
    await settle()

    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toEqual(fresh)
    expect(localStorage.getItem('catalog.v4.other')).toBe(otherEvent)
    expect(seen.at(-1)).toEqual({ status: 'ready', fromCache: false, catalog: fresh })
  })

  it('refreshes again when the browser comes back online and clears the saved-info flag', async () => {
    saveCatalog(makeCatalog('Saved'))
    api.getEventCatalog.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ok(makeCatalog('Back online')))
    const seen: Seen = []

    await renderProbe(seen)
    await settle()
    expect(seen.at(-1)).toMatchObject({ status: 'ready', fromCache: true })

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    expect(api.getEventCatalog).toHaveBeenCalledTimes(2)
    expect(seen.at(-1)).toMatchObject({ status: 'ready', fromCache: false })
    expect(seen.at(-1)?.catalog?.event.name).toBe('Back online')
  })
})

describe('Storefront ordering rules (FR-05)', () => {
  const renderOrderControl = vi.fn(({ product: p }: { product: Product }) => (
    <button type="button">Order {p.name}</button>
  ))

  beforeEach(() => {
    renderOrderControl.mockClear()
  })

  async function renderStorefront(boothId: string) {
    const { Storefront } = await import('./Storefront')
    render(
      <MemoryRouter initialEntries={[`/e/${SLUG}/booth/${boothId}`]}>
        <Routes>
          <Route path="/e/:eventSlug/booth/:boothId" element={<Storefront renderOrderControl={renderOrderControl} />} />
        </Routes>
      </MemoryRouter>,
    )
    await settle()
  }

  // Ordering lives in the product sheet, opened from the product's card.
  const productItem = (name: string) => {
    fireEvent.click(screen.getByRole('link', { name: new RegExp(`^${name}`) }))
    return screen.getByRole('dialog', { name })
  }

  beforeEach(() => {
    saveCatalog(makeCatalog())
    api.getEventCatalog.mockResolvedValue(ok(makeCatalog()))
  })

  it('renders the order control for an in-stock product at a reservation booth', async () => {
    await renderStorefront('b-res')

    expect(screen.getByRole('heading', { level: 1, name: 'Wall Rose Goods' })).toBeTruthy()
    expect(within(productItem('Attack on Titan Hoodie')).getByRole('button', { name: 'Order Attack on Titan Hoodie' })).toBeTruthy()
    const call = renderOrderControl.mock.calls.find(([args]) => args.product.id === 'p-hoodie')
    expect(call).toBeDefined()
    expect(call![0]).toMatchObject({ booth: { id: 'b-res' }, event: { slug: SLUG } })
    expect(screen.getAllByText('Reserve').length).toBeGreaterThan(0)
  })

  it('does not render the order control for a sold-out product', async () => {
    await renderStorefront('b-res')

    const soldOut = productItem('Attack on Titan Tee')
    expect(within(soldOut).getByText('Sold out')).toBeTruthy()
    expect(within(soldOut).queryByRole('button', { name: /^Order / })).toBeNull()
    expect(renderOrderControl.mock.calls.some(([args]) => args.product.id === 'p-tee')).toBe(false)
  })

  it.each([
    ['a paused reservation booth', 'b-plush', 'Tiny Kaiju Plush'],
    ['a paused prepay booth', 'b-dice', 'Obsidian Dice Set'],
  ])('%s offers no online ordering and reads "Online orders paused"', async (_label, boothId, productName) => {
    await renderStorefront(boothId)

    const item = productItem(productName)
    // More than five left reads no stock state at all (FR-05).
    expect(within(item).queryByText(/left$/)).toBeNull()
    expect(within(item).queryByRole('button', { name: /^Order / })).toBeNull()
    expect(renderOrderControl).not.toHaveBeenCalled()
    expect(screen.getAllByText('Online orders paused').length).toBeGreaterThan(0)
    expect(screen.queryByText(/^(Reserve|Prepay)$/)).toBeNull()
  })

  it('does not render the order control at a discovery booth', async () => {
    await renderStorefront('b-art')

    const item = productItem('Custom Sketch Card')
    expect(within(item).queryByText(/left$/)).toBeNull()
    expect(within(item).queryByRole('button', { name: /^Order / })).toBeNull()
    expect(renderOrderControl).not.toHaveBeenCalled()
    expect(screen.getAllByText('Browse only').length).toBeGreaterThan(0)
  })

  it.each([
    [6, null],
    [5, 'Only 5 left'],
    [0, 'Sold out'],
  ])('with %i available the card and the sheet read %s (FR-05 stock state)', async (qty, label) => {
    const catalog = makeCatalog()
    catalog.products = [product('p-stock', 'b-res', 'Stock Probe', qty)]
    saveCatalog(catalog)
    api.getEventCatalog.mockResolvedValue(ok(catalog))
    await renderStorefront('b-res')

    const card = screen.getByRole('link', { name: /^Stock Probe/ })
    const sheet = productItem('Stock Probe')
    for (const scope of [card, sheet]) {
      if (label === null) {
        expect(within(scope).queryByText(/left$|Sold out/)).toBeNull()
      } else {
        expect(within(scope).getByText(label)).toBeTruthy()
      }
    }
    // Ordering only while stock is left, on the card and in the sheet.
    expect(renderOrderControl.mock.calls.length > 0).toBe(qty > 0)
  })

  it('puts the order control on each in-stock card at a booth that takes orders, outside the card link', async () => {
    await renderStorefront('b-res')

    const order = screen.getByRole('button', { name: 'Order Attack on Titan Hoodie' })
    expect(order.closest('a')).toBeNull()
    expect(order.closest('li')?.querySelector('[data-product-card="p-hoodie"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Order Attack on Titan Tee' })).toBeNull()
  })

  it('filters the shelf by category with the chips, keeping it in the URL', async () => {
    const catalog = makeCatalog()
    catalog.products.push(product('p-cap', 'b-res', 'Survey Corps Cap', 9, 'Cap.', 'Accessories'))
    saveCatalog(catalog)
    api.getEventCatalog.mockResolvedValue(ok(catalog))
    await renderStorefront('b-res')

    const chips = screen.getByRole('group', { name: 'Categories' })
    expect(within(chips).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(chips).getByRole('button', { name: 'Accessories' }))

    expect(within(chips).getByRole('button', { name: 'Accessories' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('link', { name: /^Survey Corps Cap/ })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Attack on Titan Hoodie/ })).toBeNull()

    fireEvent.click(within(chips).getByRole('button', { name: 'All' }))
    expect(screen.getByRole('link', { name: /^Attack on Titan Hoodie/ })).toBeTruthy()
  })

  it('keeps showing the saved shelf with the saved-copy note when the refresh fails', async () => {
    saveCatalog(makeCatalog())
    api.getEventCatalog.mockRejectedValue(new Error('offline'))
    await renderStorefront('b-res')

    expect(screen.getByRole('heading', { level: 1, name: 'Wall Rose Goods' })).toBeTruthy()
    expect(screen.getByText('Showing saved info. Stock may have changed.')).toBeTruthy()

    // Try again runs the same reload as pull to refresh; a good answer clears the note.
    const calls = api.getEventCatalog.mock.calls.length
    api.getEventCatalog.mockResolvedValue(ok(makeCatalog()))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await settle()
    expect(api.getEventCatalog.mock.calls.length).toBe(calls + 1)
    expect(screen.queryByText(/Showing saved info/)).toBeNull()
  })

  it('shows no saved-copy note after a good refresh', async () => {
    await renderStorefront('b-res')

    expect(screen.queryByText(/Showing saved info/)).toBeNull()
  })

  it('shows no category chips for a booth with one category', async () => {
    await renderStorefront('b-res')

    expect(screen.queryByRole('group', { name: 'Categories' })).toBeNull()
  })

  it('shows the not-found state for an unknown booth', async () => {
    await renderStorefront('b-missing')

    expect(screen.getByRole('heading', { level: 1, name: 'We could not find this booth.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to the event' }).getAttribute('href')).toBe(`/e/${SLUG}`)
    expect(renderOrderControl).not.toHaveBeenCalled()
  })

  it('recovers from a network error with Try again when nothing is saved', async () => {
    localStorage.clear()
    api.getEventCatalog.mockReset()
    api.getEventCatalog.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ok(makeCatalog()))
    await renderStorefront('b-res')

    expect(screen.getByRole('heading', { level: 1, name: /Could not reach the server/ })).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    })
    expect(screen.getByRole('heading', { level: 1, name: 'Wall Rose Goods' })).toBeTruthy()
  })
})

describe('boothLabel helpers (FR-05)', () => {
  it.each<[BoothMode, boolean, boolean, string]>([
    ['reservation', false, false, 'Reserve'],
    ['prepay', false, false, 'Prepay'],
    ['discovery', false, false, 'Browse only'],
    ['reservation', true, true, 'Online orders paused'],
    ['prepay', true, true, 'Online orders paused'],
    // A discovery booth takes no online orders, so pausing them changes nothing it shows.
    ['discovery', true, false, 'Browse only'],
  ])('mode %s with orderingPaused %s: isPaused %s, badge "%s"', (mode, paused, expectedPaused, expectedLabel) => {
    const b = booth('b', 'A1', 'Vendor', mode, paused)
    expect(isPaused(b)).toBe(expectedPaused)
    expect(boothBadgeLabel(b)).toBe(expectedLabel)
  })
})

describe('BoothsPage', () => {
  async function renderBoothsPage() {
    const { BoothsPage } = await import('./BoothsPage')
    render(
      <MemoryRouter initialEntries={[`/e/${SLUG}/booths`]}>
        <Routes>
          <Route path="/e/:eventSlug/booths" element={<BoothsPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await settle()
  }

  const expectedBadge: Record<string, string> = {
    'b-res': 'Reserve',
    'b-pre': 'Prepay',
    'b-figs': 'Reserve',
    'b-plush': 'Online orders paused',
    'b-dice': 'Online orders paused',
    'b-art': 'Browse only',
  }

  it('lists every booth with its code and vendor name, and paused booths read as paused', async () => {
    saveCatalog(makeCatalog())
    api.getEventCatalog.mockResolvedValue(ok(makeCatalog()))
    await renderBoothsPage()

    const rows = within(screen.getByRole('list')).getAllByRole('link')
    expect(rows).toHaveLength(Object.keys(booths).length)
    for (const b of Object.values(booths)) {
      // jsdom has no layout, so its accessible name drops the space after the comma that a browser keeps.
      const row = screen.getByRole('link', { name: new RegExp(`^Booth ${b.code},\\s*${b.vendorName}`) })
      expect(row.getAttribute('href')).toBe(`/e/${SLUG}/booth/${b.id}`)
      expect(within(row).getByText(expectedBadge[b.id])).toBeTruthy()
      if (b.orderingPaused && b.mode !== 'discovery') {
        expect(within(row).queryByText(/^(Reserve|Prepay)$/)).toBeNull()
      } else {
        expect(within(row).queryByText(/paused/i)).toBeNull()
      }
    }
    expect(screen.queryByText(/Showing saved info/)).toBeNull()
  })

  it('keeps listing the saved booths with a saved-info note when the refresh fails', async () => {
    saveCatalog(makeCatalog())
    api.getEventCatalog.mockRejectedValue(new Error('offline'))
    await renderBoothsPage()

    expect(screen.getByText('Showing saved info. Stock may have changed.')).toBeTruthy()
    expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(Object.keys(booths).length)
  })
})

describe('map saved copy (FR-26)', () => {
  async function renderMap() {
    const { MapPage } = await import('./MapPage')
    render(
      <MemoryRouter initialEntries={[`/e/${SLUG}/map`]}>
        <Routes>
          <Route path="/e/:eventSlug/map" element={<MapPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await settle()
  }

  it('keeps showing the saved map with the saved-copy note when the refresh fails', async () => {
    saveCatalog(makeCatalog())
    api.getEventCatalog.mockRejectedValue(new Error('offline'))
    await renderMap()

    expect(screen.getByRole('heading', { level: 1, name: 'Event map' })).toBeTruthy()
    expect(screen.getByText('Showing saved info. Stock may have changed.')).toBeTruthy()
  })

  it('shows no saved-copy note after a good refresh', async () => {
    saveCatalog(makeCatalog())
    api.getEventCatalog.mockResolvedValue(ok(makeCatalog()))
    await renderMap()

    expect(screen.getByRole('heading', { level: 1, name: 'Event map' })).toBeTruthy()
    expect(screen.queryByText(/Showing saved info/)).toBeNull()
  })
})

describe('search through the event home (FR-04)', () => {
  async function renderEventHome() {
    const { EventHome } = await import('./EventHome')
    render(
      <MemoryRouter initialEntries={[`/e/${SLUG}`]}>
        <Routes>
          <Route path="/e/:eventSlug" element={<EventHome />} />
        </Routes>
      </MemoryRouter>,
    )
    // The home shows once this device's orders have been read (none here).
    await act(async () => {})
  }

  beforeEach(() => {
    saveCatalog(makeCatalog())
    // The catalog request never settles, so the saved catalog is what the page shows; there are no orders.
    api.getEventCatalog.mockReturnValue(never())
    api.listMyOrders.mockResolvedValue([])
  })

  const typeQuery = (value: string) => {
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search products, booths or vendors' }), { target: { value } })
  }

  it('browses by category and products only: Booths and Map live in their own tabs', async () => {
    await renderEventHome()
    const sections = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(sections).toEqual(['Browse by category', 'All products'])
    expect(screen.queryByRole('link', { name: /see all/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /map of the hall/i })).toBeNull()
    expect(screen.getByRole('searchbox', { name: 'Search products, booths or vendors' })).toBeTruthy()
  })

  it('Enter moves focus to the result count, and Escape on an empty field keeps focus in the field', async () => {
    await renderEventHome()
    const field = screen.getByRole('searchbox', { name: 'Search products, booths or vendors' })
    field.focus()
    typeQuery('titan')
    fireEvent.submit(field.closest('form')!)
    expect(document.activeElement).toBe(screen.getByText(/^\d+ results?$/))

    field.focus()
    typeQuery('')
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(document.activeElement).toBe(field)
  })

  it('names each result link with separators between name, vendor, price and stock', async () => {
    await renderEventHome()
    typeQuery('levi')
    // The accessible name, as a screen reader reads it; jsdom drops the space a browser keeps after each hidden comma.
    const results = screen.getByRole('region', { name: 'Search results' })
    expect(within(results).getByRole('link', { name: /^Levi Ackerman Figure,\s*Scout Regiment Figures,\s*\$10\.00,\s*Only 1 left$/ })).toBeTruthy()
  })

  it('shows why a description-only match matched, with the words marked, and no snippet for a name match', async () => {
    await renderEventHome()
    typeQuery('titan')

    const results = screen.getByRole('region', { name: 'Search results' })
    const levi = within(results).getByRole('link', { name: /^Levi Ackerman Figure/ })
    const snippet = levi.querySelector('.result__snippet')
    expect(snippet?.textContent).toContain('Attack on Titan')
    expect(snippet?.querySelector('mark')?.textContent).toBe('Titan')
    const hoodie = within(results).getByRole('link', { name: /^Attack on Titan Hoodie/ })
    expect(hoodie.querySelector('.result__snippet')).toBeNull()
  })

  it('keeps the field focused when a result chip is pressed, so the phone keyboard stays up', async () => {
    await renderEventHome()
    typeQuery('titan')

    const chips = screen.getByRole('group', { name: 'Filter by category' })
    // fireEvent returns false when the handler cancelled the default (moving focus to the chip).
    expect(fireEvent.mouseDown(within(chips).getByRole('button', { name: 'Apparel' }))).toBe(false)
  })

  it('saves a search with results to Recent searches, but not one that found nothing', async () => {
    const { readRecentSearches } = await import('./recentSearches')
    await renderEventHome()
    const field = screen.getByRole('searchbox', { name: 'Search products, booths or vendors' })

    typeQuery('zzqx')
    fireEvent.submit(field.closest('form')!)
    expect(readRecentSearches(SLUG)).toEqual([])

    typeQuery('titan')
    fireEvent.submit(field.closest('form')!)
    expect(readRecentSearches(SLUG)).toEqual(['titan'])
  })

  it('finds "attack on titan" across several vendors, including a product matched only by its description', async () => {
    await renderEventHome()
    typeQuery('attack on titan')

    const results = screen.getByRole('region', { name: 'Search results' })
    const items = within(results).getAllByRole('listitem')
    const names = items.map((li) => within(li).getAllByRole('link')[0].textContent ?? '')
    expect(names).toHaveLength(4)
    for (const expected of ['Attack on Titan Hoodie', 'Attack on Titan Tee', 'Attack on Titan Poster', 'Levi Ackerman Figure']) {
      expect(names.filter((n) => n.includes(expected))).toHaveLength(1)
    }
    // Wall Rose Goods has two hits, so every result sits under its booth's heading and sign.
    const vendors = within(results)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent)
    expect(vendors.sort()).toEqual(['Pixel Forge Prints', 'Scout Regiment Figures', 'Wall Rose Goods'])
    const scout = within(results).getByRole('region', { name: 'Scout Regiment Figures' })
    expect(within(scout).getByText('Levi Ackerman Figure')).toBeTruthy()
    expect(within(scout).getByRole('link', { name: /^Booth\s*E4\s*on the map$/ }).getAttribute('href')).toBe(`/e/${SLUG}/map?booth=b-figs`)
    expect(within(results).getByText('4 results')).toBeTruthy()
  })

  // The filter is in the URL, so the browser's Back undoes it instead of leaving the event.
  async function renderEventHomeWithHistory(entry = `/e/${SLUG}`) {
    const { EventHome } = await import('./EventHome')
    const { useLocation, useNavigate } = await import('react-router-dom')
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
    render(
      <MemoryRouter initialEntries={['/before', entry]} initialIndex={1}>
        <main>
          <Routes>
            <Route path="/before" element={<h1>Before the event</h1>} />
            <Route path="/e/:eventSlug" element={<EventHome />} />
          </Routes>
        </main>
        <HistoryProbe />
      </MemoryRouter>,
    )
    await act(async () => {})
  }
  const url = () => screen.getByTestId('url').textContent
  const browserBack = () => fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))

  it('a category tile pushes ?category=, and Back returns to the unfiltered home', async () => {
    await renderEventHomeWithHistory()
    const tiles = within(screen.getByRole('region', { name: 'Browse by category' })).getAllByRole('button')
    const first = tiles[0].querySelector('.category-tile__name')?.textContent ?? ''
    fireEvent.click(tiles[0])
    expect(url()).toBe(`/e/${SLUG}?category=${encodeURIComponent(first).replace(/%20/g, '+')}`)
    expect(screen.getByRole('region', { name: 'Search results' })).toBeTruthy()

    browserBack()
    expect(url()).toBe(`/e/${SLUG}`)
    expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Browse by category' })).toBeTruthy()
  })

  it('Back that removes the focused chip focuses the home h1 without scrolling, so the restored position holds', async () => {
    await renderEventHomeWithHistory()
    const tiles = within(screen.getByRole('region', { name: 'Browse by category' })).getAllByRole('button')
    fireEvent.click(tiles[0])
    expect(document.activeElement?.classList.contains('chip')).toBe(true)

    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    try {
      browserBack()
      const h1 = screen.getByRole('heading', { level: 1 })
      expect(document.activeElement).toBe(h1)
      const call = focus.mock.contexts.findIndex((el) => el === h1)
      expect(focus.mock.calls[call]).toEqual([{ preventScroll: true }])
    } finally {
      focus.mockRestore()
    }
  })

  it('typing pushes one history entry, not one per keystroke', async () => {
    await renderEventHomeWithHistory()
    for (const value of ['a', 'at', 'att', 'atta', 'attack']) typeQuery(value)
    expect(url()).toBe(`/e/${SLUG}?q=attack`)

    browserBack()
    expect(url()).toBe(`/e/${SLUG}`)
    expect((screen.getByRole('searchbox', { name: 'Search products, booths or vendors' }) as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull()
  })

  it('Clear search goes to the clean event home', async () => {
    await renderEventHomeWithHistory(`/e/${SLUG}?q=attack+on+titan`)
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(url()).toBe(`/e/${SLUG}`)
    expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull()
  })

  it('a reload with ?q= restores the query and its results', async () => {
    await renderEventHomeWithHistory(`/e/${SLUG}?q=attack+on+titan`)
    expect((screen.getByRole('searchbox', { name: 'Search products, booths or vendors' }) as HTMLInputElement).value).toBe('attack on titan')
    const results = screen.getByRole('region', { name: 'Search results' })
    expect(within(results).getByText('4 results')).toBeTruthy()
  })

  it('announces the result count once, only after typing pauses', async () => {
    vi.useFakeTimers()
    await renderEventHome()
    const status = screen.getByRole('search').parentElement!.nextElementSibling as HTMLElement
    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('aria-live')).not.toBe('assertive')

    const spoken: string[] = []
    const observer = new MutationObserver(() => spoken.push(status.textContent ?? ''))
    observer.observe(status, { childList: true, characterData: true, subtree: true })

    typeQuery('a')
    const results = screen.getByRole('region', { name: 'Search results' })
    // Precondition: the first keystroke has a different count, so its announcement would be distinguishable.
    expect(within(results).getByText(/^\d+ results?$/).textContent).not.toBe('4 results')
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(status.textContent).toBe('')

    typeQuery('attack on titan')
    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(status.textContent).toBe('')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(status.textContent).toBe('4 results')

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    await Promise.resolve()
    observer.disconnect()
    expect(status.textContent).toBe('4 results')
    expect(spoken.filter((t) => t !== '')).toEqual(['4 results'])
  })
})

describe('returning to the event home', () => {
  async function mountHome() {
    const { EventHome } = await import('./EventHome')
    return render(
      <MemoryRouter initialEntries={[`/e/${SLUG}`]}>
        <Routes>
          <Route path="/e/:eventSlug" element={<EventHome />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('shows the skeleton only on the first visit; a return shows the catalog on its first render and refreshes it', async () => {
    api.getEventCatalog.mockResolvedValue(ok(makeCatalog()))
    api.listMyOrders.mockResolvedValue([])
    const first = await mountHome()
    expect(screen.getByText('Loading the event...')).toBeTruthy()
    await settle()
    expect(screen.getByRole('heading', { level: 1, name: 'Code Camp Con' })).toBeTruthy()
    first.unmount()

    // Storage blocked or cleared: the copy held this page life still stands in.
    localStorage.clear()
    api.getEventCatalog.mockClear()
    const refresh = deferred<Result<EventCatalog, 'event_not_found'>>()
    api.getEventCatalog.mockReturnValue(refresh.promise)
    // Minutes later: the shared request (catalogRequest) has let the first answer go.
    const later = Date.now() + 5 * 60_000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    await mountHome()
    // The first render, before any promise settles.
    expect(screen.queryByText('Loading the event...')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Code Camp Con' })).toBeTruthy()
    expect(screen.getAllByText('Attack on Titan Hoodie').length).toBeGreaterThan(0)
    // The quiet refresh goes out, and its answer replaces the shown copy without the skeleton.
    expect(api.getEventCatalog).toHaveBeenCalledTimes(1)
    await act(async () => refresh.resolve(ok(makeCatalog('Code Camp Con Live'))))
    expect(screen.getByRole('heading', { level: 1, name: 'Code Camp Con Live' })).toBeTruthy()
    expect(screen.queryByText('Loading the event...')).toBeNull()
    vi.restoreAllMocks()
  })
})
