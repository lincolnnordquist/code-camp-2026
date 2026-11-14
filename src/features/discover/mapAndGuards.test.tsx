// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booth, EventCatalog, Order, Result } from '../../shared/types'
import { eventFloorLayout, type FloorLayout } from './catalogExtras'
import { CODE_CAMP_LAYOUT, codeCampCatalog } from './codeCampHall'

const api = vi.hoisted(() => ({
  getEventCatalog: vi.fn(),
  listMyOrders: vi.fn(),
}))

vi.mock('../../shared/api', () => api)
vi.mock('../../shared/live', () => ({
  subscribeToMyOrders: () => () => undefined,
  useOnlineStatus: () => true,
}))

const sampleCatalog = codeCampCatalog()
const SLUG = sampleCatalog.event.slug
const CACHE_KEY = `catalog.v4.${SLUG}`
const LAYOUT = CODE_CAMP_LAYOUT

const clone = <T,>(v: T): T => structuredClone(v)
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

/** Lets pending promise callbacks and the React updates they cause settle inside act. */
const settle = () => act(async () => {})

const saveCatalog = (catalog: EventCatalog) => localStorage.setItem(CACHE_KEY, JSON.stringify(catalog))

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
})

async function renderMapPage(withProbe?: (catalog: EventCatalog | null) => void, entry = `/e/${SLUG}/map`) {
  const { MapPage } = await import('./MapPage')
  const { useCatalog } = await import('./useCatalog')
  function Probe() {
    const { state } = useCatalog(SLUG)
    withProbe?.(state.status === 'ready' ? state.catalog : null)
    return null
  }
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/e/:eventSlug/map"
          element={
            <>
              <MapPage />
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  await settle()
}

const mapRegion = () => screen.getByRole('region', { name: /^Floor plan, zoomed to/ })
const plate = (code: string) => within(mapRegion()).getByRole('button', { name: new RegExp(`^Booth ${code},`) })
const percent = (value: string) => {
  expect(value).toMatch(/%$/)
  return Number.parseFloat(value)
}

/**
 * The placement contract, written out independently of FloorMap: a booth "D5"
 * sits in column D, row 5 of the layout (columns lettered left to right, rows
 * numbered from the back: row 1 is the bottom row by the kitchen, row 7 the top
 * row by the stage), and the drawn box is the layout plus a gutter of
 * `gutter` plan units on each side (read from the rendered viewBox): the row
 * numbers on the left, a matching margin on the right so the hall is centred.
 */
function expectedFromTable(layout: FloorLayout, code: string, gutter: number) {
  const [, column, row] = /^([A-Z]+)(\d+)$/.exec(code)!
  const x = layout.firstTable.x + layout.columns.indexOf(column) * layout.pitch.x
  const y = layout.firstTable.y + (layout.rows - Number(row)) * layout.pitch.y
  const drawnWidth = layout.width + 2 * gutter
  return {
    plan: { x, y },
    left: ((x + gutter) / drawnWidth) * 100,
    top: (y / layout.height) * 100,
    width: (layout.tableSize.width / drawnWidth) * 100,
    height: (layout.tableSize.height / layout.height) * 100,
  }
}

function drawnBox() {
  const svg = mapRegion().querySelector('svg.plan')!
  const [minX, minY, width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number)
  return { minX, minY, width, height, gutter: -minX }
}

/**
 * jsdom serialises inline style numbers to 6 significant digits, so 3 decimal
 * places of a percentage is the finest it can show; one table pitch is about 8.8%.
 */
const STYLE_PRECISION = 3

function expectPlateAt(code: string, exp: { left: number; top: number; width: number; height: number }) {
  const style = plate(code).style
  expect(percent(style.left)).toBeCloseTo(exp.left, STYLE_PRECISION)
  expect(percent(style.top)).toBeCloseTo(exp.top, STYLE_PRECISION)
  expect(percent(style.width)).toBeCloseTo(exp.width, STYLE_PRECISION)
  expect(percent(style.height)).toBeCloseTo(exp.height, STYLE_PRECISION)
}

describe('map placement from the floor layout (M4, FR-02)', () => {
  const unparsable: Booth[] = [
    ['b-food', 'Food Court', 0.125, 0.23],
    ['b-z', 'Z99', 0.32, 0.425],
    ['b-over', 'A11', 0.515, 0.62],
  ].map(([id, code, mapX, mapY]) => ({
    ...sampleCatalog.booths[0],
    id: id as string,
    code: code as string,
    vendorName: `Vendor ${code}`,
    mapX: mapX as number,
    mapY: mapY as number,
  }))

  beforeEach(() => {
    const catalog = clone(sampleCatalog)
    catalog.booths.push(...unparsable)
    api.getEventCatalog.mockResolvedValue(ok(catalog))
  })

  it('draws the layout with a gutter for the row letters and a matching one on the right, so the hall is centred', async () => {
    await renderMapPage()
    const box = drawnBox()
    expect(box.minY).toBe(0)
    expect(box.gutter).toBeGreaterThan(0)
    expect(box.width).toBe(LAYOUT.width + 2 * box.gutter)
    expect(box.height).toBe(LAYOUT.height)
  })

  it.each(['D5', 'I7'])('places the %s plate over its table from the layout grid', async (code) => {
    await renderMapPage()
    const { gutter } = drawnBox()
    const exp = expectedFromTable(LAYOUT, code, gutter)
    // Sanity on the hand computation for the sample layout.
    // I7 is front right, in the top row by the stage; D5 two rows behind it.
    if (code === 'D5') expect(exp.plan).toEqual({ x: 360, y: 318 })
    if (code === 'I7') expect(exp.plan).toEqual({ x: 860, y: 170 })

    expectPlateAt(code, exp)

    // The drawn table for that code is at the same plan point, so plate and table coincide.
    const table = mapRegion().querySelector(`.plan__table[data-code="${code}"]`)
    const rect = table!.querySelector('rect')!
    expect(Number(rect.getAttribute('x'))).toBe(exp.plan.x)
    expect(Number(rect.getAttribute('y'))).toBe(exp.plan.y)
  })

  it.each(unparsable.map((b) => [b.code, b] as const))(
    'falls back to a table-sized plate around the map point for a booth whose code "%s" is not a table',
    async (_code, booth) => {
      await renderMapPage()
      const { gutter } = drawnBox()
      const drawnWidth = LAYOUT.width + 2 * gutter
      // The map point is a fraction of the layout; the plate is one table, centred on it, moved into the drawn box.
      const x = booth.mapX * LAYOUT.width - LAYOUT.tableSize.width / 2
      const y = booth.mapY * LAYOUT.height - LAYOUT.tableSize.height / 2
      expectPlateAt(booth.code, {
        left: ((x + gutter) / drawnWidth) * 100,
        top: (y / LAYOUT.height) * 100,
        width: (LAYOUT.tableSize.width / drawnWidth) * 100,
        height: (LAYOUT.tableSize.height / LAYOUT.height) * 100,
      })
    },
  )

  it('draws all 63 tables, and only the vendor tables are buttons', async () => {
    await renderMapPage()
    const tables = [...mapRegion().querySelectorAll('.plan__table')]
    const codes = tables.map((t) => t.getAttribute('data-code'))
    const expected = Array.from({ length: LAYOUT.rows }, (_, r) => LAYOUT.columns.map((c) => `${c}${r + 1}`)).flat()
    expect(expected).toHaveLength(63)
    expect(codes.sort()).toEqual([...expected].sort())
    // An empty table carries no code; only a vendor's plate is lettered.
    for (const t of tables) expect(t.querySelector('text')).toBeNull()

    const buttons = within(mapRegion()).getAllByRole('button')
    const boothCount = sampleCatalog.booths.length + unparsable.length
    expect(buttons).toHaveLength(boothCount)
    const boothCodes = buttons.map((b) => /^Booth ([^,]+),/.exec(b.getAttribute('aria-label') ?? '')?.[1])
    expect(boothCodes.sort()).toEqual([...sampleCatalog.booths, ...unparsable].map((b) => b.code).sort())
    // No drawn table is itself interactive.
    for (const table of mapRegion().querySelectorAll('.plan__table')) {
      expect(table.closest('button')).toBeNull()
    }
  })
})

describe('the team table and the row order (hall layout)', () => {
  beforeEach(() => {
    api.getEventCatalog.mockResolvedValue(ok(clone(sampleCatalog)))
  })

  it('rows run 1 at the bottom by the kitchen to 7 at the top by the stage, and the description says so', async () => {
    await renderMapPage()
    const plan = screen.getByRole('img', { name: /^Floor plan of Vasion Headquarters: / })
    expect(plan.getAttribute('aria-label')).toBe(
      'Floor plan of Vasion Headquarters: stage at the front, kitchen at the back, tables in columns A to I, rows 1 to 7 from the kitchen to the stage.',
    )
    const top = (code: string) => Number(mapRegion().querySelector(`.plan__table[data-code="${code}"] rect`)!.getAttribute('y'))
    const stage = LAYOUT.areas.find((a) => a.kind === 'stage')!
    const kitchen = LAYOUT.areas.find((a) => a.kind === 'kitchen')!
    expect(top('A7')).toBeGreaterThan(stage.y + stage.height)
    expect(top('A1') + LAYOUT.tableSize.height).toBeLessThan(kitchen.y)
    expect(top('A1')).toBeGreaterThan(top('A2'))
    // The side numbers read 7 at the top down to 1 at the bottom.
    const sideNumbers = [...mapRegion().querySelectorAll('text.plan__row')]
      .filter((t) => /^\d+$/.test(t.textContent ?? ''))
      .sort((a, b) => Number(a.getAttribute('y')) - Number(b.getAttribute('y')))
      .map((t) => t.textContent)
    expect(sideNumbers).toEqual(['7', '6', '5', '4', '3', '2', '1'])
  })

  it('the selected plate stays pinned until deselected: Escape, or a single tap on empty map, but not a double-tap', async () => {
    const highlighted = () => mapRegion().querySelector('.floor-map__booth.is-highlighted')?.getAttribute('data-code') ?? null
    await renderMapPage(undefined, `/e/${SLUG}/map?booth=b-plush`)
    expect(highlighted()).toBe('D5')
    await act(() => new Promise((r) => setTimeout(r, 50)))
    expect(highlighted()).toBe('D5')

    fireEvent.keyDown(mapRegion(), { key: 'Escape' })
    expect(highlighted()).toBeNull()
    expect(screen.getByText('Select a booth to see who is there.')).toBeTruthy()

    fireEvent.click(within(mapRegion()).getByRole('button', { name: /^Booth D5,/ }))
    expect(highlighted()).toBe('D5')
    // Two quick taps on empty map are a double-tap zoom: the booth stays selected.
    const tap = (x: number) => {
      fireEvent.pointerDown(mapRegion(), { pointerId: 1, button: 0, clientX: x, clientY: 5 })
      fireEvent.pointerUp(mapRegion(), { pointerId: 1, button: 0, clientX: x, clientY: 5 })
    }
    tap(5)
    tap(6)
    await act(() => new Promise((r) => setTimeout(r, 350)))
    expect(highlighted()).toBe('D5')
    // One tap on empty map deselects, once a second tap can no longer follow.
    await act(() => new Promise((r) => setTimeout(r, 350)))
    tap(5)
    expect(highlighted()).toBe('D5')
    await act(() => new Promise((r) => setTimeout(r, 350)))
    expect(highlighted()).toBeNull()
  })

  it('a link to a booth this event does not have says so, and a known one selects it', async () => {
    await renderMapPage(undefined, `/e/${SLUG}/map?booth=b-gone`)
    expect(screen.getByText("That booth isn't on this map.")).toBeTruthy()
    expect(screen.queryByText('Select a booth to see who is there.')).toBeNull()
    cleanup()
    await renderMapPage()
    expect(screen.getByText('Select a booth to see who is there.')).toBeTruthy()
  })

  it("H6, second row from the stage, is the team's booth Snag: a plate like any booth, its card names it and offers no storefront", async () => {
    await renderMapPage()
    const { gutter } = drawnBox()
    expectPlateAt('H6', expectedFromTable(LAYOUT, 'H6', gutter))
    expect(plate('H6').textContent).toBe('H6')
    fireEvent.click(within(mapRegion()).getByRole('button', { name: /^Booth H6, Snag,/ }))
    const card = await screen.findByRole('heading', { name: 'Snag' })
    const section = card.closest('section')!
    expect(within(section).getByText('The team behind this app')).toBeTruthy()
    expect(section.querySelector('.ec-booth-plate')?.textContent).toBe('Booth H6')
    expect(within(section).getByText('Browse only')).toBeTruthy()
    expect(within(section).queryByRole('button', { name: 'Centre on booth' })).toBeNull()
    expect(within(section).queryByRole('link', { name: 'Open storefront' })).toBeNull()
  })

  it('a booth that lists products keeps Open storefront on its card', async () => {
    const catalog = clone(sampleCatalog)
    catalog.products.push({ id: 'p1', boothId: 'b-titan', name: 'Hoodie', category: 'Apparel', description: '', imageUrl: '', priceCents: 5500, availableQty: 4, maxPerOrder: 2 })
    api.getEventCatalog.mockResolvedValue(ok(catalog))
    await renderMapPage()
    fireEvent.click(within(mapRegion()).getByRole('button', { name: /^Booth A3,/ }))
    const section = (await screen.findByRole('heading', { name: 'Wall Rose Goods' })).closest('section')!
    expect(within(section).getByRole('link', { name: 'Open storefront' })).toBeTruthy()
  })
})

describe('floor layout guard (eventFloorLayout)', () => {
  const malformed: Array<[string, (l: FloorLayout) => unknown]> = [
    ['missing areas', (l) => ({ ...l, areas: undefined })],
    ['NaN pitch', (l) => ({ ...l, pitch: { x: Number.NaN, y: l.pitch.y } })],
    ['no columns', (l) => ({ ...l, columns: [] })],
    ['fractional rows', (l) => ({ ...l, rows: 6.5 })],
    ['fewer than 3 walls', (l) => ({ ...l, walls: l.walls.slice(0, 2) })],
  ]
  const withLayout = (layout: unknown): EventCatalog => {
    const catalog = clone(sampleCatalog)
    ;(catalog.event as { floorLayout?: unknown }).floorLayout = layout
    return catalog
  }

  it('with neither a layout nor a floor plan image, the note sits above the plan, never among the plates', async () => {
    const catalog = withLayout(undefined)
    catalog.event.floorPlanUrl = ''
    api.getEventCatalog.mockResolvedValue(ok(catalog))
    await renderMapPage()
    const note = screen.getByText('Floor plan unavailable. Booth spots are still shown.')
    expect(note.closest('.floor-map__canvas')).toBeNull()
    expect(note.closest('.floor-map__frame')).toBeNull()
    expect(within(mapRegion()).getAllByRole('button').length).toBeGreaterThan(0)
  })

  function expectImageFallback() {
    expect(mapRegion().querySelector('svg.plan')).toBeNull()
    const image = screen.getByRole('img', { name: /^Floor plan of Vasion Headquarters\. Booths are listed as buttons/ })
    expect(image.tagName).toBe('IMG')
    expect(image.getAttribute('src')).toBe(sampleCatalog.event.floorPlanUrl)
  }

  function expectDrawnPlan() {
    const plan = screen.getByRole('img', { name: /^Floor plan of Vasion Headquarters: stage at the front/ })
    expect(plan.tagName.toLowerCase()).toBe('svg')
  }

  describe.each(malformed)('a layout with %s', (_label, breakIt) => {
    it('from a fresh fetch: loads, ignores the layout, also in the saved copy, and the map shows the image', async () => {
      api.getEventCatalog.mockResolvedValue(ok(withLayout(breakIt(clone(LAYOUT)))))
      let seen: EventCatalog | null = null
      await renderMapPage((c) => {
        seen = c
      })

      expect(seen).not.toBeNull()
      expect(eventFloorLayout(seen!.event)).toBeUndefined()
      expect(eventFloorLayout(JSON.parse(localStorage.getItem(CACHE_KEY)!).event)).toBeUndefined()
      expect(seen!.booths).toHaveLength(sampleCatalog.booths.length)
      expectImageFallback()
    })

    it('from a saved copy: opens without the layout and the map shows the image', async () => {
      saveCatalog(withLayout(breakIt(clone(LAYOUT))))
      api.getEventCatalog.mockReturnValue(never())
      const first: Array<EventCatalog | null> = []
      await renderMapPage((c) => {
        first.push(c)
      })

      expect(first[0]).not.toBeNull()
      expect(eventFloorLayout(first[0]!.event)).toBeUndefined()
      expectImageFallback()
    })
  })

  it('keeps a valid layout from a fresh fetch, and the map draws it', async () => {
    api.getEventCatalog.mockResolvedValue(ok(clone(sampleCatalog)))
    let seen: EventCatalog | null = null
    await renderMapPage((c) => {
      seen = c
    })
    expect(eventFloorLayout(seen!.event)).toEqual(LAYOUT)
    expect(eventFloorLayout(JSON.parse(localStorage.getItem(CACHE_KEY)!).event)).toEqual(LAYOUT)
    expectDrawnPlan()
  })

  it('keeps a valid layout from a saved copy, and the map draws it', async () => {
    saveCatalog(clone(sampleCatalog))
    api.getEventCatalog.mockReturnValue(never())
    let seen: EventCatalog | null = null
    await renderMapPage((c) => {
      seen = c
    })
    expect(eventFloorLayout(seen!.event)).toEqual(LAYOUT)
    expectDrawnPlan()
  })
})

describe('useCatalog request guard', () => {
  const named = (name: string) => {
    const c = clone(sampleCatalog)
    c.event.name = name
    return c
  }

  async function renderProbe(slug: string, seen: Array<{ name?: string; fromCache?: boolean; status: string }>) {
    const { useCatalog } = await import('./useCatalog')
    function Probe({ s }: { s: string }) {
      const { state } = useCatalog(s)
      seen.push(state.status === 'ready' ? { status: 'ready', name: state.catalog.event.name, fromCache: state.fromCache } : { status: state.status })
      return null
    }
    const view = render(<Probe s={slug} />)
    return (next: string) => view.rerender(<Probe s={next} />)
  }

  it('a slow earlier response arriving after a newer one does not overwrite it', async () => {
    const first = deferred<Result<EventCatalog, 'event_not_found'>>()
    const second = deferred<Result<EventCatalog, 'event_not_found'>>()
    api.getEventCatalog.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const seen: Array<{ name?: string; fromCache?: boolean; status: string }> = []
    await renderProbe(SLUG, seen)

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(api.getEventCatalog).toHaveBeenCalledTimes(2)

    second.resolve(ok(named('Newer')))
    await settle()
    expect(seen.at(-1)).toEqual({ status: 'ready', name: 'Newer', fromCache: false })

    first.resolve(ok(named('Older')))
    await settle()
    expect(seen.at(-1)).toEqual({ status: 'ready', name: 'Newer', fromCache: false })
    expect(seen.some((s) => s.name === 'Older')).toBe(false)
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!).event.name).toBe('Newer')
  })

  it('a slow earlier failure arriving after a newer success does not mark the catalog as saved info', async () => {
    const first = deferred<Result<EventCatalog, 'event_not_found'>>()
    api.getEventCatalog.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok(named('Newer')))
    const seen: Array<{ name?: string; fromCache?: boolean; status: string }> = []
    await renderProbe(SLUG, seen)

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(seen.at(-1)).toEqual({ status: 'ready', name: 'Newer', fromCache: false })

    first.reject(new Error('offline'))
    await settle()
    expect(seen.at(-1)).toEqual({ status: 'ready', name: 'Newer', fromCache: false })
  })

  it('a slow response for an event the screen has left does not overwrite the current event', async () => {
    const left = deferred<Result<EventCatalog, 'event_not_found'>>()
    api.getEventCatalog.mockImplementation((slug: string) =>
      slug === SLUG ? left.promise : Promise.resolve(ok({ ...named('Current event'), event: { ...named('Current event').event, slug } })),
    )
    const seen: Array<{ name?: string; fromCache?: boolean; status: string }> = []
    const switchTo = await renderProbe(SLUG, seen)

    switchTo('other-event')
    await settle()
    expect(seen.at(-1)).toMatchObject({ status: 'ready', name: 'Current event' })

    left.resolve(ok(named('Left event')))
    await settle()
    expect(seen.at(-1)).toMatchObject({ status: 'ready', name: 'Current event' })
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
  })
})

describe('ActiveOrders pickup codes', () => {
  const order = (overrides: Partial<Order> = {}): Order => ({
    id: 'o1',
    type: 'reservation',
    status: 'confirmed',
    totalCents: 800,
    currency: 'USD',
    pickupCode: 'ABC234',
    holdEndsAt: null,
    cancelReason: null,
    refundStatus: 'none',
    refundedCents: 0,
    createdAt: '2026-11-13T10:00:00Z',
    boothId: 'b',
    eventId: 'ev',
    boothCode: 'A1',
    boothName: 'Wall Rose Goods',
    collectedAt: null,
    items: [{ productId: 'p', name: 'Patch', quantity: 1, unitPriceCents: 800 }],
    ...overrides,
  })
  const at = (code: string, boothName: string) => ({ boothId: code, boothCode: code, boothName })

  async function mountTwice(secondLoad: () => Promise<Order[]>) {
    const { ActiveOrders } = await import('./ActiveOrders')
    const strip = () => (
      <MemoryRouter>
        <ActiveOrders eventId="ev" />
      </MemoryRouter>
    )
    // A first visit fills the remembered strip.
    api.listMyOrders.mockResolvedValueOnce([order()])
    const firstVisit = render(strip())
    await settle()
    expect(within(screen.getByRole('region', { name: 'Your open orders' })).getByText('ABC234')).toBeTruthy()
    firstVisit.unmount()

    api.listMyOrders.mockImplementationOnce(secondLoad)
    render(strip())
  }

  const openOrders = () => screen.getByRole('region', { name: 'Your open orders' })

  it('shows the remembered strip without pickup codes until this visit loads, then shows them', async () => {
    const refresh = deferred<Order[]>()
    await mountTwice(() => refresh.promise)

    expect(within(openOrders()).getByText('Wall Rose Goods')).toBeTruthy()
    expect(within(openOrders()).queryByText('ABC234')).toBeNull()

    refresh.resolve([order()])
    await settle()
    expect(within(openOrders()).getByText('ABC234')).toBeTruthy()
  })

  it('keeps pickup codes hidden when this visit refresh fails (the request throws)', async () => {
    await mountTwice(() => Promise.reject(new Error('offline')))
    await settle()

    expect(api.listMyOrders).toHaveBeenCalledTimes(2)
    expect(within(openOrders()).getByText('Wall Rose Goods')).toBeTruthy()
    expect(within(openOrders()).queryByText('ABC234')).toBeNull()
  })

  // Each test below uses its own event, since the remembered strip is kept per event for the module's life.

  it('puts a ready order first and opens the wallet from every pass', async () => {
    const { ActiveOrders } = await import('./ActiveOrders')
    api.listMyOrders.mockResolvedValueOnce([
      order({ id: 'c', eventId: 'ev-two', ...at('C2', 'Critical Hit Dice'), pickupCode: 'CCC222' }),
      order({ id: 'r', eventId: 'ev-two', status: 'ready', ...at('A3', 'Wall Rose Goods'), pickupCode: 'RRR333' }),
      // An order at another event is not this event's.
      order({ id: 'elsewhere', eventId: 'other-event', ...at('Z9', 'Elsewhere'), pickupCode: 'XXX999' }),
    ])
    render(
      <MemoryRouter>
        <ActiveOrders eventId="ev-two" />
      </MemoryRouter>,
    )
    await settle()

    const passes = within(openOrders()).getAllByRole('link')
    expect(passes.map((a) => a.textContent)).toEqual([
      expect.stringContaining('Wall Rose Goods'),
      expect.stringContaining('Critical Hit Dice'),
    ])
    expect(within(passes[0]).getByText('Ready')).toBeTruthy()
    expect(within(passes[0]).getByText('RRR333')).toBeTruthy()
    expect(passes.every((a) => a.getAttribute('href') === '/orders')).toBe(true)
  })

  it('folds three or more open orders into one card that names the ready booth and shows no codes', async () => {
    const { ActiveOrders } = await import('./ActiveOrders')
    api.listMyOrders.mockResolvedValueOnce([
      order({ id: 'c', eventId: 'ev-three', ...at('C2', 'Critical Hit Dice'), pickupCode: 'CCC222' }),
      order({ id: 'e', eventId: 'ev-three', ...at('E5', 'Scout Regiment Figures'), pickupCode: 'EEE555' }),
      order({ id: 'r', eventId: 'ev-three', status: 'ready', ...at('A3', 'Wall Rose Goods'), pickupCode: 'RRR333' }),
      order({ id: 'gone', eventId: 'ev-three', status: 'collected', ...at('B7', 'Pixel Forge Prints') }),
    ])
    render(
      <MemoryRouter>
        <ActiveOrders eventId="ev-three" />
      </MemoryRouter>,
    )
    await settle()

    const card = within(openOrders()).getByRole('link')
    expect(card.getAttribute('href')).toBe('/orders')
    expect(within(card).getByText('3 open orders')).toBeTruthy()
    expect(within(card).getByText(/1 ready for pickup: Wall Rose Goods/)).toBeTruthy()
    expect(within(card).queryByText(/RRR333|CCC222|EEE555/)).toBeNull()
  })
})
