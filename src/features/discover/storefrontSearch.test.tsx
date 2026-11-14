// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booth, BoothMode, EventCatalog, Order, Product } from '../../shared/types'

import { addRecentSearch, readRecentSearches, removeRecentSearch, RECENT_SEARCH_LIMIT } from './recentSearches'
import { groupHitsByBooth, highlightParts, searchCatalog, topCategories } from './search'

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

const booth = (id: string, code: string, vendorName: string, mode: BoothMode): Booth => ({
  id,
  code,
  vendorName,
  slogan: '',
  logoUrl: '',
  bannerUrl: '',
  mode,
  orderingPaused: false,
  pickupInstructions: '',
  mapX: 0.005, mapY: 0.005,
})

const product = (id: string, boothId: string, name: string, availableQty: number, category = 'Merch'): Product => ({
  id,
  boothId,
  name,
  description: `${name} description.`,
  category,
  priceCents: 1200,
  availableQty,
  maxPerOrder: 2,
  imageUrl: '',
})

function makeCatalog(): EventCatalog {
  return {
    event: {
      id: 'evt',
      slug: SLUG,
      name: 'Code Camp Con',
      venueName: 'Hall',
      currency: 'USD',
      floorPlanUrl: '/plan.svg',
      reservationHoldMinutes: 120,
    },
    booths: [
      booth('b-res', 'A3', 'Wall Rose Goods', 'reservation'),
      booth('b-pre', 'B6', 'Pixel Forge Prints', 'prepay'),
      booth('b-art', 'I7', 'Inkwell Artist Alley', 'discovery'),
    ],
    products: [
      product('p-hoodie', 'b-res', 'Titan Hoodie', 4, 'Apparel'),
      product('p-tee', 'b-res', 'Titan Tee', 0, 'Apparel'),
      product('p-cap', 'b-res', 'Scout Cap', 2, 'Apparel'),
      product('p-poster', 'b-pre', 'Titan Poster', 6, 'Prints'),
      product('p-sketch', 'b-art', 'Custom Sketch Card', 20, 'Prints'),
      product('p-pin', 'b-art', 'Enamel Pin', 9, 'Pins'),
    ],
  }
}

const settle = () => act(async () => {})
const never = <T,>() => new Promise<T>(() => undefined)

function HistoryProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <p data-testid="url">{location.pathname + location.search}</p>
      <p data-testid="history">{(window.history.state as { idx?: number } | null)?.idx ?? 'n/a'}</p>
      <button type="button" onClick={() => navigate(-1)}>
        Browser back
      </button>
    </>
  )
}

const url = () => screen.getByTestId('url').textContent
const orderControl = vi.fn(({ product: p }: { product: Product }) => (
  <button type="button">Order {p.name}</button>
))

async function renderAt(entry: string) {
  const { Storefront } = await import('./Storefront')
  const { EventHome } = await import('./EventHome')
  render(
    <MemoryRouter initialEntries={['/before', entry]} initialIndex={1}>
      <Routes>
        <Route path="/before" element={<h1>Before</h1>} />
        <Route path="/e/:eventSlug" element={<EventHome renderOrderControl={orderControl} />} />
        <Route path="/e/:eventSlug/booth/:boothId" element={<Storefront renderOrderControl={orderControl} />} />
        <Route path="/e/:eventSlug/map" element={<h1>Map</h1>} />
      </Routes>
      <HistoryProbe />
    </MemoryRouter>,
  )
  await settle()
}

const card = (name: string) => screen.getByRole('link', { name: new RegExp(`^${name}`) })

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(`catalog.v4.${SLUG}`, JSON.stringify(makeCatalog()))
  api.getEventCatalog.mockReset().mockReturnValue(never())
  api.listMyOrders.mockReset().mockResolvedValue([])
  orderControl.mockClear()
  vi.resetModules()
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('product sheet', () => {
  it('opens over the storefront from a card, sets ?product, and starts focus on the product name', async () => {
    await renderAt(`/e/${SLUG}/booth/b-res`)
    const hoodie = card('Titan Hoodie')
    hoodie.focus()
    fireEvent.click(hoodie)

    expect(url()).toBe(`/e/${SLUG}/booth/b-res?product=p-hoodie`)
    const dialog = screen.getByRole('dialog', { name: 'Titan Hoodie' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(within(dialog).getByRole('heading', { level: 2, name: 'Titan Hoodie' }))
    expect(within(dialog).getByText('Only 4 left')).toBeTruthy()
    expect(within(dialog).getByText('$12.00')).toBeTruthy()
    expect(within(dialog).getByText('Titan Hoodie description.')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Find on map' }).getAttribute('href')).toBe(`/e/${SLUG}/map?booth=b-res`)
    // The page behind leaves the tab order while the sheet is open.
    expect(hoodie.closest('body > div')).toHaveProperty('inert', true)
  })

  it('Escape closes the sheet, goes back in history, and returns focus to the card', async () => {
    await renderAt(`/e/${SLUG}/booth/b-res`)
    fireEvent.click(card('Titan Hoodie'))
    const dialog = screen.getByRole('dialog')

    fireEvent.keyDown(within(dialog).getByRole('heading', { level: 2 }), { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(url()).toBe(`/e/${SLUG}/booth/b-res`)
    expect(document.activeElement).toBe(card('Titan Hoodie'))
    expect(card('Titan Hoodie').closest('body > div')).toHaveProperty('inert', false)
    // Closing went Back rather than pushing: one more Back leaves the storefront.
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(url()).toBe('/before')
  })

  it.each(['Escape', 'Close', 'Back'])('closing by %s returns focus without scrolling and keeps the page where it was', async (how) => {
    await renderAt(`/e/${SLUG}/booth/b-res`)
    // The page was scrolled to 640 when the sheet opened; something moves it while it is open.
    let y = 640
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(((arg: ScrollToOptions) => {
      y = arg.top ?? y
    }) as typeof window.scrollTo)
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    try {
      fireEvent.click(card('Titan Hoodie'))
      const dialog = screen.getByRole('dialog')
      y = 0
      focus.mockClear()
      if (how === 'Escape') fireEvent.keyDown(within(dialog).getByRole('heading', { level: 2 }), { key: 'Escape' })
      else if (how === 'Close') fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
      else fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
      await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(card('Titan Hoodie'))
      expect(focus.mock.calls.every(([options]) => (options as FocusOptions | undefined)?.preventScroll === true)).toBe(true)
      expect(y).toBe(640)
    } finally {
      scrollTo.mockRestore()
      focus.mockRestore()
      Reflect.deleteProperty(window, 'scrollY')
    }
  })

  it('Back closes the sheet and returns focus to the card', async () => {
    await renderAt(`/e/${SLUG}/booth/b-res`)
    fireEvent.click(card('Titan Tee'))
    expect(screen.getByRole('dialog', { name: 'Titan Tee' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(card('Titan Tee'))
  })

  it('a link with ?product reopens the sheet, and closing it replaces the entry instead of leaving', async () => {
    await renderAt(`/e/${SLUG}/booth/b-res?product=p-cap`)
    const dialog = screen.getByRole('dialog', { name: 'Scout Cap' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(url()).toBe(`/e/${SLUG}/booth/b-res`)
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(url()).toBe('/before')
  })

  it('a drag down past the threshold closes the sheet', async () => {
    await renderAt(`/e/${SLUG}/booth/b-res`)
    fireEvent.click(card('Titan Hoodie'))
    const bar = screen.getByRole('dialog').querySelector('.sheet__bar')!

    fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 102, clientY: 260 })
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 102, clientY: 260 })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each([
    ['a storefront', `/e/${SLUG}/booth/b-res`, () => card('Titan Hoodie')],
    ['search results', `/e/${SLUG}?q=titan`, () => screen.getByRole('link', { name: /^Titan Hoodie/ })],
  ])('on %s the sheet never pages to another product: no controls, keys or swipe', async (_label, entry, opener) => {
    await renderAt(entry)
    fireEvent.click(opener())
    const dialog = screen.getByRole('dialog', { name: 'Titan Hoodie' })
    expect(within(dialog).queryByRole('button', { name: /product$/ })).toBeNull()
    expect(within(dialog).queryByText(/^Product \d+ of/)).toBeNull()
    const before = url()
    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    const media = dialog.querySelector('.sheet__media')!
    fireEvent.pointerDown(media, { pointerId: 1, button: 0, clientX: 300, clientY: 100 })
    fireEvent.pointerMove(media, { pointerId: 1, clientX: 60, clientY: 104 })
    fireEvent.pointerUp(media, { pointerId: 1, clientX: 40, clientY: 104 })
    expect(url()).toBe(before)
    expect(screen.getByRole('dialog', { name: 'Titan Hoodie' })).toBeTruthy()
  })

  it('renders the order control inside the sheet only when the booth takes orders and the product is in stock', async () => {
    await renderAt(`/e/${SLUG}/booth/b-res`)
    fireEvent.click(card('Titan Hoodie'))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Order Titan Hoodie' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    fireEvent.click(card('Titan Tee'))
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /^Order / })).toBeNull()
    expect(within(screen.getByRole('dialog')).getByText('Sold out')).toBeTruthy()
    cleanup()

    orderControl.mockClear()
    await renderAt(`/e/${SLUG}/booth/b-art?product=p-sketch`)
    const discovery = screen.getByRole('dialog', { name: 'Custom Sketch Card' })
    expect(within(discovery).queryByRole('button', { name: /^Order / })).toBeNull()
    expect(within(discovery).getByText('Browse only')).toBeTruthy()
    expect(orderControl).not.toHaveBeenCalled()
  })

  it('opens from a home grid card with the order control the route passes, and links to the storefront', async () => {
    await renderAt(`/e/${SLUG}`)
    const grid = screen.getByRole('region', { name: 'All products' })
    fireEvent.click(within(grid).getByRole('link', { name: /^Titan Poster/ }))

    expect(url()).toBe(`/e/${SLUG}?product=p-poster`)
    const dialog = screen.getByRole('dialog', { name: 'Titan Poster' })
    expect(within(dialog).getByRole('button', { name: 'Order Titan Poster' })).toBeTruthy()
    // The vendor row is the link; jsdom drops the space after each hidden comma.
    expect(within(dialog).getByRole('link', { name: /^Booth B6,\s*Pixel Forge Prints,/ }).getAttribute('href')).toBe(`/e/${SLUG}/booth/b-pre`)
  })

  it('keeps the search in the URL when a result opens the sheet', async () => {
    await renderAt(`/e/${SLUG}?q=poster`)
    fireEvent.click(within(screen.getByRole('region', { name: 'Search results' })).getByRole('link', { name: /^Titan Poster/ }))
    expect(url()).toBe(`/e/${SLUG}?q=poster&product=p-poster`)
  })
})

describe('card to sheet, without a view transition', () => {
  const startViewTransition = vi.fn((update: () => void) => {
    update()
    const settled = Promise.resolve()
    return { ready: settled, finished: settled, updateCallbackDone: settled }
  })
  const motion = (reduce: boolean) => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  }
  // Nothing is snapshotted: the sheet slides over the live page, so no element carries a transition name.
  const namedElements = () =>
    Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) => el.style.viewTransitionName !== '')

  beforeEach(() => {
    startViewTransition.mockClear()
    Object.defineProperty(document, 'startViewTransition', { value: startViewTransition, configurable: true })
  })
  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition')
  })

  it('a card click opens the sheet with no view transition, and Close goes Back to the card', async () => {
    motion(false)
    await renderAt(`/e/${SLUG}/booth/b-res`)
    const hoodie = card('Titan Hoodie')
    hoodie.focus()
    fireEvent.click(hoodie)
    await settle()

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(url()).toBe(`/e/${SLUG}/booth/b-res?product=p-hoodie`)
    const sheet = screen.getByRole('dialog')
    // Back is not handed to the shell's morph; the sheet slides down by itself.
    expect(sheet.hasAttribute('data-morph-on-back')).toBe(false)
    expect(sheet.hasAttribute('data-no-pull')).toBe(true)
    expect(sheet.hasAttribute('data-no-swipe-back')).toBe(true)
    expect(namedElements()).toHaveLength(0)

    // The pushed entry kept the sheet state, so Close goes Back instead of adding an entry.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    await settle()
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(url()).toBe(`/e/${SLUG}/booth/b-res`)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(card('Titan Hoodie'))
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(url()).toBe('/before')
  })

  it('while it slides down the closing sheet stays mounted but out of reach, then goes', async () => {
    motion(false)
    await renderAt(`/e/${SLUG}/booth/b-res`)
    fireEvent.click(card('Titan Hoodie'))
    await settle()
    // jsdom runs no CSS animations; a running slide is what keeps the sheet mounted.
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', { value: () => [{}], configurable: true })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
      const layer = document.querySelector<HTMLElement>('.sheet-layer')!
      expect(layer.classList.contains('is-closing')).toBe(true)
      expect(layer.hasAttribute('inert')).toBe(true)
      // jsdom delivers no animation events, so this takes the fallback for a slide that never
      // reports its end; in a browser animationend ends it sooner.
      act(() => {
        vi.advanceTimersByTime(650)
      })
      expect(document.querySelector('.sheet-layer')).toBeNull()
    } finally {
      vi.useRealTimers()
      Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
    }
  })

  it('keeps the search filters when it opens from the event home', async () => {
    motion(false)
    await renderAt(`/e/${SLUG}?category=Apparel`)
    fireEvent.click(screen.getByRole('link', { name: /^Titan Hoodie/ }))
    await settle()
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(url()).toBe(`/e/${SLUG}?category=Apparel&product=p-hoodie`)
  })

  it('a modifier click is left to the browser', async () => {
    motion(false)
    await renderAt(`/e/${SLUG}/booth/b-res`)
    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
      fireEvent.click(card('Titan Hoodie'), { [modifier]: true })
    }
    await settle()
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(url()).toBe(`/e/${SLUG}/booth/b-res`)
  })

  it('reduced motion opens the sheet as a plain link', async () => {
    motion(true)
    await renderAt(`/e/${SLUG}/booth/b-res`)
    fireEvent.click(card('Titan Hoodie'))
    await settle()
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(url()).toBe(`/e/${SLUG}/booth/b-res?product=p-hoodie`)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('without view transitions the sheet opens as a plain link', async () => {
    motion(false)
    Reflect.deleteProperty(document, 'startViewTransition')
    await renderAt(`/e/${SLUG}/booth/b-res`)
    fireEvent.click(card('Titan Hoodie'))
    await settle()
    expect(url()).toBe(`/e/${SLUG}/booth/b-res?product=p-hoodie`)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('storefront #product links', () => {
  const scrollIntoView = vi.fn()
  beforeEach(() => {
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  })

  async function renderEntries(entries: string[], index = entries.length - 1) {
    const { Storefront } = await import('./Storefront')
    const { Link } = await import('react-router-dom')
    render(
      <MemoryRouter initialEntries={entries} initialIndex={index}>
        <Routes>
          <Route path="/before" element={<Link to={`/e/${SLUG}/booth/b-res#p-cap`}>Scout Cap at Wall Rose</Link>} />
          <Route path="/e/:eventSlug/booth/:boothId" element={<Storefront renderOrderControl={orderControl} />} />
        </Routes>
      </MemoryRouter>,
    )
    await settle()
  }

  it('centres the linked card when the link is followed in the app', async () => {
    await renderEntries(['/before'])
    fireEvent.click(screen.getByRole('link', { name: 'Scout Cap at Wall Rose' }))
    await settle()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('p-cap'))
  })

  it('centres it when the link opens a fresh tab, which has no entry to restore', async () => {
    await renderEntries([`/e/${SLUG}/booth/b-res#p-cap`])
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('Back or Forward to it keeps the position the shell restored', async () => {
    await renderEntries(['/before', `/e/${SLUG}/booth/b-res#p-cap`])
    expect(screen.getByRole('heading', { level: 1, name: 'Wall Rose Goods' })).toBeTruthy()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('search results', () => {
  it('groups results under booth headings when one booth has several, else lists them flat', async () => {
    await renderAt(`/e/${SLUG}?q=titan`)
    let results = screen.getByRole('region', { name: 'Search results' })
    const headings = within(results).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Wall Rose Goods', 'Pixel Forge Prints'])
    const wallRose = within(results).getByRole('region', { name: 'Wall Rose Goods' })
    expect(within(wallRose).getAllByRole('listitem')).toHaveLength(2)
    cleanup()

    await renderAt(`/e/${SLUG}?q=poster`)
    results = screen.getByRole('region', { name: 'Search results' })
    expect(within(results).queryByRole('heading')).toBeNull()
    expect(within(results).getByText('Pixel Forge Prints')).toBeTruthy()
  })

  it('marks the matched words in result names', async () => {
    await renderAt(`/e/${SLUG}?q=tit+hood`)
    const marks = Array.from(screen.getByRole('region', { name: 'Search results' }).querySelectorAll('mark'))
    expect(marks.map((m) => m.textContent)).toEqual(['Tit', 'Hood'])
  })

  it('shows the empty message with the two biggest categories as suggestions', async () => {
    await renderAt(`/e/${SLUG}?q=zzz`)
    const results = screen.getByRole('region', { name: 'Search results' })
    expect(within(results).getByText('Nothing matched your search. Even the mimic checked twice.')).toBeTruthy()
    const suggestions = within(results).getByRole('group', { name: 'Try a category' })
    expect(within(suggestions).getAllByRole('button').map((b) => b.textContent)).toEqual(['Apparel', 'Prints'])

    fireEvent.click(within(suggestions).getByRole('button', { name: 'Prints' }))
    expect(url()).toBe(`/e/${SLUG}?category=Prints`)
  })

  it('Enter blurs the field and remembers the term', async () => {
    await renderAt(`/e/${SLUG}`)
    const field = screen.getByRole('searchbox', { name: 'Search products, booths or vendors' })
    expect(field.getAttribute('enterkeyhint')).toBe('search')
    field.focus()
    fireEvent.change(field, { target: { value: 'titan' } })
    fireEvent.submit(field.closest('form')!)
    expect(document.activeElement).not.toBe(field)
    expect(readRecentSearches(SLUG)).toEqual(['titan'])
  })
})

describe('recent searches', () => {
  it('keeps up to five terms, newest first, one per spelling', () => {
    for (const t of ['pins', 'dice', 'Pins', 'tee', 'plush', 'cap', 'poster']) addRecentSearch(SLUG, t)
    expect(readRecentSearches(SLUG)).toEqual(['poster', 'cap', 'plush', 'tee', 'Pins'])
    expect(readRecentSearches(SLUG)).toHaveLength(RECENT_SEARCH_LIMIT)
    // The stored copy is trimmed too, not only the read.
    expect(JSON.parse(localStorage.getItem(`discover.recentSearches.${SLUG}`)!)).toHaveLength(RECENT_SEARCH_LIMIT)
    expect(removeRecentSearch(SLUG, 'plush')).toEqual(['poster', 'cap', 'tee', 'Pins'])
    expect(readRecentSearches('other-event')).toEqual([])
  })

  it('ignores a damaged stored list', () => {
    localStorage.setItem(`discover.recentSearches.${SLUG}`, '{"not":"a list"}')
    expect(readRecentSearches(SLUG)).toEqual([])
    localStorage.setItem(`discover.recentSearches.${SLUG}`, '[1, "ok", null]')
    expect(readRecentSearches(SLUG)).toEqual(['ok'])
  })

  it('on a phone, the focused empty field shows recent searches, and each can be removed', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    addRecentSearch(SLUG, 'poster')
    addRecentSearch(SLUG, 'titan')
    await renderAt(`/e/${SLUG}`)
    expect(screen.queryByRole('region', { name: 'Recent' })).toBeNull()

    fireEvent.focus(screen.getByRole('searchbox', { name: 'Search products, booths or vendors' }))
    const recents = screen.getByRole('region', { name: 'Recent' })
    expect(within(recents).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['titan', 'poster'])

    fireEvent.click(within(recents).getByRole('button', { name: 'Remove titan from recent searches' }))
    expect(within(recents).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['poster'])
    expect(readRecentSearches(SLUG)).toEqual(['poster'])
    expect(document.activeElement).toBe(within(recents).getByRole('button', { name: 'Remove poster from recent searches' }))

    fireEvent.click(within(recents).getByRole('button', { name: 'poster' }))
    expect(url()).toBe(`/e/${SLUG}?q=poster`)
  })
})

describe('phone search view', () => {
  const phone = () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  }
  const field = () => screen.getByRole('searchbox', { name: 'Search products, booths or vendors' })
  const view = () => document.querySelector('.discover')!

  it('opens on focus with Cancel and categories, and a tap on empty space (blur) keeps it open', async () => {
    phone()
    await renderAt(`/e/${SLUG}`)
    fireEvent.focus(field())
    expect(view().classList.contains('discover--docked')).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Browse a category' })).toBeTruthy()

    fireEvent.blur(field())
    expect(view().classList.contains('discover--docked')).toBe(true)
    // The bottom bars step aside while the view is open (home.css), and come back when it closes.
    expect(document.documentElement.hasAttribute('data-search-view')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await settle()
    expect(document.documentElement.hasAttribute('data-search-view')).toBe(false)
  })

  it('removes the bottom-bar mark when the screen goes away with the view open', async () => {
    phone()
    await renderAt(`/e/${SLUG}`)
    fireEvent.focus(field())
    expect(document.documentElement.hasAttribute('data-search-view')).toBe(true)
    cleanup()
    expect(document.documentElement.hasAttribute('data-search-view')).toBe(false)
  })

  it('a category chip filters and stays in the search view', async () => {
    phone()
    await renderAt(`/e/${SLUG}`)
    fireEvent.focus(field())
    const chip = within(screen.getByRole('group', { name: 'Browse a category' })).getByRole('button', { name: 'Apparel' })
    expect(fireEvent.mouseDown(chip)).toBe(false)
    fireEvent.click(chip)
    expect(url()).toBe(`/e/${SLUG}?category=Apparel`)
    expect(view().classList.contains('discover--docked')).toBe(true)
  })

  it('Cancel clears the search, leaves the view, focuses the page heading and swallows the rest of the tap', async () => {
    phone()
    await renderAt(`/e/${SLUG}`)
    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: 'titan' } })
    expect(url()).toBe(`/e/${SLUG}?q=titan`)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await settle()
    expect(view().classList.contains('discover--docked')).toBe(false)
    expect(url()).toBe(`/e/${SLUG}`)
    expect((field() as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
    // The same finger lifting must not open what reappeared under it.
    expect(fireEvent.click(card('Titan Hoodie'))).toBe(false)
    expect(url()).toBe(`/e/${SLUG}`)
  })

  it('Escape leaves the view and keeps focus in the field', async () => {
    phone()
    await renderAt(`/e/${SLUG}`)
    field().focus()
    fireEvent.focus(field())
    fireEvent.keyDown(field(), { key: 'Escape' })
    await settle()
    expect(view().classList.contains('discover--docked')).toBe(false)
    expect(document.activeElement).toBe(field())
  })
})

describe('search helpers', () => {
  it('highlightParts merges overlapping words, and words only a space apart, keeping the original case', () => {
    expect(highlightParts('Attack on Titan', 'tit titan on')).toEqual([
      { text: 'Attack ', match: false },
      { text: 'on Titan', match: true },
    ])
    expect(highlightParts('Dice', '')).toEqual([{ text: 'Dice', match: false }])
  })

  it('groupHitsByBooth is null when every booth has one hit', () => {
    const catalog = makeCatalog()
    expect(groupHitsByBooth(searchCatalog(catalog, 'poster', null))).toBeNull()
    const groups = groupHitsByBooth(searchCatalog(catalog, 'titan', null))!
    expect(groups.map((g) => [g.booth.code, g.hits.length])).toEqual([
      ['A3', 2],
      ['B6', 1],
    ])
  })

  it('topCategories ranks by product count and skips the active one', () => {
    expect(topCategories(makeCatalog(), 2)).toEqual(['Apparel', 'Prints'])
    expect(topCategories(makeCatalog(), 2, 'Apparel')).toEqual(['Prints', 'Pins'])
  })
})

describe('home first paint (speed pass)', () => {
  it('the category photos and the first product photo load eagerly with high priority, the rest lazily', async () => {
    const catalog = makeCatalog()
    for (const p of catalog.products) p.imageUrl = `/${p.id}.webp`
    localStorage.setItem(`catalog.v4.${SLUG}`, JSON.stringify(catalog))
    await renderAt(`/e/${SLUG}`)
    const tiles = [...document.querySelectorAll('.category-tile img')]
    const cards = [...document.querySelectorAll('.product-grid .product-card img')]
    const mode = (img: Element) => `${img.getAttribute('loading')}/${img.getAttribute('fetchpriority') ?? '-'}`
    expect(tiles.length).toBeGreaterThan(1)
    expect(tiles.map(mode)).toEqual(tiles.map(() => 'eager/high'))
    expect(cards.map(mode)).toEqual(['eager/high', ...cards.slice(1).map(() => 'lazy/-')])
  })

  it('waits for the orders before showing the home, so the strip arrives with the sections, not after them', async () => {
    let resolve: (orders: Order[]) => void = () => undefined
    api.listMyOrders.mockReturnValue(new Promise((r) => (resolve = r)))
    await renderAt(`/e/${SLUG}`)
    expect(screen.queryByRole('heading', { name: 'Browse by category' })).toBeNull()
    const open = {
      id: 'o1', type: 'reservation', status: 'ready', totalCents: 800, currency: 'USD', pickupCode: 'ABC234', holdEndsAt: null,
      cancelReason: null, refundStatus: 'none', createdAt: '2026-11-13T10:00:00Z', boothId: 'b-res', eventId: 'evt', boothCode: 'A3',
      boothName: 'Wall Rose Goods', collectedAt: null, items: [{ productId: 'p-hoodie', name: 'Titan Hoodie', quantity: 1, unitPriceCents: 800 }],
    } as Order
    await act(async () => resolve([open]))
    // Both in the first render of the home: the strip above, the sections under it.
    expect(screen.getByRole('heading', { name: 'Browse by category' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Your open orders' })).toBeTruthy()
  })

  it('holds the open-orders strip at its last height while orders load, then forgets it when there are none', async () => {
    localStorage.setItem('discover.activeOrdersHeight.evt', '124')
    let resolve: (orders: Order[]) => void = () => undefined
    api.listMyOrders.mockReturnValue(new Promise((r) => (resolve = r)))
    await renderAt(`/e/${SLUG}`)
    // The home waits a moment for the orders, then shows with the strip's place held.
    await act(() => new Promise((r) => setTimeout(r, 350)))
    const held = document.querySelector<HTMLElement>('.active-orders--loading')!
    expect(held.style.blockSize).toBe('124px')
    expect(held.getAttribute('aria-hidden')).toBe('true')
    await act(async () => resolve([]))
    expect(document.querySelector('.active-orders--loading')).toBeNull()
    expect(localStorage.getItem('discover.activeOrdersHeight.evt')).toBeNull()
  })
})

describe('search finds booths (QA D6)', () => {
  const withTeamBooth = () => {
    const catalog = makeCatalog()
    catalog.booths.push(booth('b-team', 'H6', 'DibSpot', 'discovery'))
    localStorage.setItem(`catalog.v4.${SLUG}`, JSON.stringify(catalog))
  }

  it.each(['dibspot', 'h6'])('"%s" lists the booth with no products, linking to its storefront', async (q) => {
    withTeamBooth()
    await renderAt(`/e/${SLUG}?q=${q}`)
    const booths = screen.getByRole('region', { name: 'Booths' })
    const link = within(booths).getByRole('link', { name: /^Booth\s*H6,\s*DibSpot/ })
    expect(link.getAttribute('href')).toBe(`/e/${SLUG}/booth/b-team`)
    expect(screen.getByText('1 result', { selector: '.result-count' })).toBeTruthy()
  })

  it('a vendor name lists the booth and its products together', async () => {
    await renderAt(`/e/${SLUG}?q=wall rose`)
    expect(within(screen.getByRole('region', { name: 'Booths' })).getAllByRole('link')).toHaveLength(1)
    expect(screen.getByText('4 results', { selector: '.result-count' })).toBeTruthy()
  })

  it('a category is about products, so it lists no booths', async () => {
    withTeamBooth()
    await renderAt(`/e/${SLUG}?q=h6&category=Apparel`)
    expect(screen.queryByRole('region', { name: 'Booths' })).toBeNull()
  })
})

describe('storefront banner', () => {
  it('the banner is requested first and eagerly, and fades in only once it has loaded', async () => {
    const catalog = makeCatalog()
    catalog.booths[0].bannerUrl = '/banner.png'
    localStorage.setItem(`catalog.v4.${SLUG}`, JSON.stringify(catalog))
    await renderAt(`/e/${SLUG}/booth/b-res`)
    const img = document.querySelector('.storefront__banner img')!
    expect([img.getAttribute('loading'), img.getAttribute('fetchpriority')]).toEqual(['eager', 'high'])
    expect(img.classList.contains('is-loaded')).toBe(false)
    fireEvent.load(img)
    expect(document.querySelector('.storefront__banner img')!.classList.contains('is-loaded')).toBe(true)
  })

  it('a banner that fails to load leaves the plain band, not a broken image', async () => {
    const catalog = makeCatalog()
    catalog.booths[0].bannerUrl = '/missing-banner.svg'
    localStorage.setItem(`catalog.v4.${SLUG}`, JSON.stringify(catalog))
    await renderAt(`/e/${SLUG}/booth/b-res`)
    const banner = document.querySelector('.storefront__banner')!
    const img = banner.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/missing-banner.svg')
    fireEvent.error(img)
    expect(banner.querySelector('img')).toBeNull()
  })
})

describe('product photo gallery', () => {
  const withAngles = () => {
    const catalog = makeCatalog()
    const hoodie = catalog.products.find((p) => p.id === 'p-hoodie')! as Omit<Product, 'images'> & { images?: unknown }
    hoodie.imageUrl = '/hoodie.webp'
    hoodie.images = [{ url: '/hoodie-back.webp', label: 'back' }, '/hoodie-detail.webp']
    localStorage.setItem(`catalog.v4.${SLUG}`, JSON.stringify(catalog))
  }

  it('shows several photos as a gallery with one dot each and spoken positions; one photo has none', async () => {
    withAngles()
    await renderAt(`/e/${SLUG}/booth/b-res`)
    fireEvent.click(card('Titan Hoodie'))
    const dialog = screen.getByRole('dialog', { name: 'Titan Hoodie' })
    const gallery = within(dialog).getByRole('region', { name: 'Photos of Titan Hoodie' })
    expect(within(gallery).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual([
      'Image 1 of 3, Titan Hoodie',
      'Image 2 of 3, Titan Hoodie, back',
      'Image 3 of 3, Titan Hoodie',
    ])
    expect(gallery.querySelectorAll('.gallery__dot')).toHaveLength(3)
    expect(gallery.querySelector('.gallery__dot.is-current')).toBe(gallery.querySelector('.gallery__dot'))

    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(card('Titan Tee'))
    const tee = screen.getByRole('dialog', { name: 'Titan Tee' })
    expect(within(tee).queryByRole('region', { name: /^Photos of/ })).toBeNull()
    expect(tee.querySelector('.gallery__dot, .gallery__nav')).toBeNull()
  })

  it('the image controls and keys move between photos and never change the product', async () => {
    withAngles()
    await renderAt(`/e/${SLUG}/booth/b-res`)
    fireEvent.click(card('Titan Hoodie'))
    const dialog = screen.getByRole('dialog', { name: 'Titan Hoodie' })
    const productUrl = url()
    const status = () => within(within(dialog).getByRole('region', { name: 'Photos of Titan Hoodie' })).getByRole('status').textContent

    fireEvent.click(within(dialog).getByRole('button', { name: 'Next image' }))
    expect(status()).toBe('Image 2 of 3, Titan Hoodie, back')
    const track = dialog.querySelector('.gallery__track')!
    fireEvent.keyDown(track, { key: 'ArrowRight' })
    expect(status()).toBe('Image 3 of 3, Titan Hoodie')
    expect(url()).toBe(productUrl)
    expect(within(dialog).getByRole('button', { name: 'Next image' }).getAttribute('aria-disabled')).toBe('true')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Next image' }))
    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(url()).toBe(productUrl)
  })

  it('a swipe changes the current photo once, when the scroll settles, never from a position mid-scroll', async () => {
    withAngles()
    await renderAt(`/e/${SLUG}/booth/b-res`)
    fireEvent.click(card('Titan Hoodie'))
    const dialog = screen.getByRole('dialog', { name: 'Titan Hoodie' })
    const track = dialog.querySelector<HTMLElement>('.gallery__track')!
    Object.defineProperty(track, 'clientWidth', { configurable: true, value: 300 })
    const current = () => [...dialog.querySelectorAll('.gallery__dot')].findIndex((d) => d.classList.contains('is-current'))
    // Positions passing during the swipe change nothing; the scroll's end decides, once.
    for (const left of [80, 160, 240, 300]) {
      track.scrollLeft = left
      fireEvent.scroll(track)
      expect(current()).toBe(0)
    }
    fireEvent(track, new Event('scrollend'))
    expect(current()).toBe(1)
    expect(within(dialog).getByRole('region', { name: 'Photos of Titan Hoodie' }).querySelector('[role=status]')!.textContent).toBe(
      'Image 2 of 3, Titan Hoodie, back',
    )
  })

  it('cards in the grid keep showing the first photo only', async () => {
    withAngles()
    await renderAt(`/e/${SLUG}/booth/b-res`)
    const imgs = card('Titan Hoodie').querySelectorAll('img')
    expect([...imgs].map((i) => i.getAttribute('src'))).toEqual(['/hoodie.webp'])
  })
})

describe('filters and sort (addition to FR-04)', () => {
  const priced = (prices: Record<string, number>) => {
    const catalog = makeCatalog()
    for (const p of catalog.products) p.priceCents = prices[p.id] ?? p.priceCents
    localStorage.setItem(`catalog.v4.${SLUG}`, JSON.stringify(catalog))
  }
  const resultNames = () =>
    within(screen.getByRole('region', { name: 'Search results' }))
      .getAllByRole('link')
      .map((a) => a.getAttribute('aria-label') ?? a.textContent ?? '')
      .filter((t) => !/^Booth|on the map/.test(t))
      .map((t) => /Titan \w+|Scout Cap/.exec(t)?.[0])
  const historyIndex = () => screen.getByTestId('history').textContent

  it('applies In stock and a price sort from the sheet, writes them to the URL in place, and lists flat while sorted', async () => {
    priced({ 'p-hoodie': 4500, 'p-poster': 2500 })
    await renderAt(`/e/${SLUG}?q=titan`)
    const before = historyIndex()
    expect(screen.getAllByRole('heading', { level: 2, name: /Wall Rose Goods|Pixel Forge Prints/ }).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }))
    const sheet = screen.getByRole('dialog', { name: 'Filter and sort' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'In stock' }))
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Price: high to low' }))
    await settle()

    expect(url()).toBe(`/e/${SLUG}?q=titan&stock=1&sort=price-desc`)
    expect(historyIndex()).toBe(before)
    expect(resultNames()).toEqual(['Titan Hoodie', 'Titan Poster'])
    // Sorted by price across booths, so no booth group headings; each row names its booth instead.
    expect(screen.queryByRole('heading', { level: 2, name: 'Wall Rose Goods' })).toBeNull()
    expect(screen.getByRole('link', { name: /^Booth\s*A3\s*on the map$/ })).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Show 2 products' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Filters,\s*2\s*on$/ })).toBeTruthy()
  })

  it('restores the filters from the URL on load, as after a reload or Back', async () => {
    priced({ 'p-hoodie': 4500, 'p-poster': 800 })
    await renderAt(`/e/${SLUG}?q=titan&sort=price-asc`)
    expect(resultNames()).toEqual(['Titan Poster', 'Titan Tee', 'Titan Hoodie'])
    // Two of these share a booth, which would group them; a price sort keeps the list flat instead.
    expect(screen.queryByRole('heading', { level: 2, name: 'Wall Rose Goods' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }))
    expect(screen.getByRole('radio', { name: 'Price: low to high' })).toHaveProperty('checked', true)
  })

  it('names the filter that emptied the list and Clear filters brings the matches back', async () => {
    await renderAt(`/e/${SLUG}?q=titan&price=under-10`)
    expect(screen.getByText('No results with Under $10.', { selector: '.result-count' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await settle()
    expect(url()).toBe(`/e/${SLUG}?q=titan`)
    expect(screen.getByText('3 results', { selector: '.result-count' })).toBeTruthy()
  })

  it('filters and sorts a storefront shelf from its URL, Featured being the booth order', async () => {
    priced({ 'p-hoodie': 900, 'p-cap': 3000 })
    await renderAt(`/e/${SLUG}/booth/b-res?stock=1&sort=price-desc`)
    const cards = [...document.querySelectorAll('.storefront__grid .product-card__name')].map((n) => n.textContent)
    expect(cards).toEqual(['Scout Cap', 'Titan Hoodie'])
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'Featured' }))
    await settle()
    expect(url()).toBe(`/e/${SLUG}/booth/b-res?stock=1`)
    expect([...document.querySelectorAll('.storefront__grid .product-card__name')].map((n) => n.textContent)).toEqual(['Titan Hoodie', 'Scout Cap'])
  })
})
