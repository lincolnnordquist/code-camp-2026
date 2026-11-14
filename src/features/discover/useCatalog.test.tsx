// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventCatalog, Product, Result } from '../../shared/types'


const api = vi.hoisted(() => ({ getEventCatalog: vi.fn() }))
vi.mock('../../shared/api', () => api)

const SLUG = 'ev'
const catalog = (name: string): EventCatalog => ({
  event: { id: 'e', slug: SLUG, name, venueName: 'Hall', currency: 'USD', floorPlanUrl: '', reservationHoldMinutes: 120 },
  booths: [],
  products: [],
})
const never = <T,>() => new Promise<T>(() => undefined)
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

type Seen = { status: string; fromCache?: boolean; name?: string; reason?: string }

async function renderProbe() {
  const { useCatalog } = await import('./useCatalog')
  const seen: Seen[] = []
  function Probe() {
    const { state } = useCatalog(SLUG)
    seen.push(
      state.status === 'ready'
        ? { status: 'ready', fromCache: state.fromCache, name: state.catalog.event.name }
        : state.status === 'error'
          ? { status: 'error', reason: state.refusal.reason }
          : { status: 'loading' },
    )
    return null
  }
  const view = render(<Probe />)
  return { seen, view }
}

beforeEach(() => {
  localStorage.clear()
  api.getEventCatalog.mockReset()
  vi.resetModules()
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useCatalog time limits (D4)', () => {
  it('a saved copy gets the saved-info flag once the refresh is overdue, and loses it when the refresh lands', async () => {
    localStorage.setItem(`catalog.v4.${SLUG}`, JSON.stringify(catalog('Saved')))
    const refresh = deferred<Result<EventCatalog, 'event_not_found'>>()
    api.getEventCatalog.mockReturnValue(refresh.promise)
    const { SAVED_NOTE_DELAY_MS } = await import('./useCatalog')
    const { seen } = await renderProbe()
    act(() => vi.advanceTimersByTime(SAVED_NOTE_DELAY_MS - 1))
    expect(seen.at(-1)).toEqual({ status: 'ready', fromCache: false, name: 'Saved' })
    act(() => vi.advanceTimersByTime(1))
    expect(seen.at(-1)).toEqual({ status: 'ready', fromCache: true, name: 'Saved' })
    await act(async () => refresh.resolve({ ok: true, value: catalog('Fresh') }))
    expect(seen.at(-1)).toEqual({ status: 'ready', fromCache: false, name: 'Fresh' })
  })

  it('a first visit stops waiting after the limit, and a late answer still replaces the error', async () => {
    const refresh = deferred<Result<EventCatalog, 'event_not_found'>>()
    api.getEventCatalog.mockReturnValue(refresh.promise)
    const { FIRST_LOAD_TIMEOUT_MS } = await import('./useCatalog')
    const { seen } = await renderProbe()
    act(() => vi.advanceTimersByTime(FIRST_LOAD_TIMEOUT_MS - 1))
    expect(seen.at(-1)).toEqual({ status: 'loading' })
    act(() => vi.advanceTimersByTime(1))
    expect(seen.at(-1)).toEqual({ status: 'error', reason: 'network' })
    await act(async () => refresh.resolve({ ok: true, value: catalog('Late') }))
    expect(seen.at(-1)).toEqual({ status: 'ready', fromCache: false, name: 'Late' })
  })

  it('a refresh that lands in time never sets either bound', async () => {
    api.getEventCatalog.mockResolvedValue({ ok: true, value: catalog('Fast') })
    const { seen } = await renderProbe()
    await act(async () => undefined)
    expect(vi.getTimerCount()).toBe(0)
    act(() => vi.advanceTimersByTime(60_000))
    expect(seen.at(-1)).toEqual({ status: 'ready', fromCache: false, name: 'Fast' })
    expect(seen.some((s) => s.status === 'error' || s.fromCache)).toBe(false)
  })

  it('leaving the screen during a hung load clears its bounds', async () => {
    api.getEventCatalog.mockReturnValue(never())
    const { view } = await renderProbe()
    expect(vi.getTimerCount()).toBe(2)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useCatalog pull to refresh', () => {
  const pull = () => new Event('app:pull-refresh', { cancelable: true })
  const done = vi.fn()
  beforeEach(() => {
    done.mockReset()
    window.addEventListener('app:pull-refresh-done', done)
  })
  afterEach(() => window.removeEventListener('app:pull-refresh-done', done))

  it('claims a pull, reloads once, and answers once the reload lands', async () => {
    api.getEventCatalog.mockResolvedValueOnce({ ok: true, value: catalog('First') })
    const { seen } = await renderProbe()
    await act(async () => undefined)
    expect(api.getEventCatalog).toHaveBeenCalledTimes(1)

    const answer = deferred<Result<EventCatalog, 'event_not_found'>>()
    api.getEventCatalog.mockReturnValueOnce(answer.promise)
    let claimed = false
    act(() => {
      claimed = !window.dispatchEvent(pull())
    })
    expect(claimed).toBe(true)
    expect(api.getEventCatalog).toHaveBeenCalledTimes(2)
    expect(done).not.toHaveBeenCalled()

    await act(async () => answer.resolve({ ok: true, value: catalog('Pulled') }))
    expect(done).toHaveBeenCalledTimes(1)
    expect(api.getEventCatalog).toHaveBeenCalledTimes(2)
    expect(seen.at(-1)).toEqual({ status: 'ready', fromCache: false, name: 'Pulled' })
  })

  it('a failed reload still answers, and keeps the loaded catalog marked as saved', async () => {
    api.getEventCatalog.mockResolvedValueOnce({ ok: true, value: catalog('First') })
    const { seen } = await renderProbe()
    await act(async () => undefined)
    api.getEventCatalog.mockRejectedValueOnce(new Error('offline'))
    await act(async () => {
      window.dispatchEvent(pull())
    })
    expect(done).toHaveBeenCalledTimes(1)
    expect(seen.at(-1)).toEqual({ status: 'ready', fromCache: true, name: 'First' })
  })

  it('leaves the pull unclaimed once the screen has gone', async () => {
    api.getEventCatalog.mockResolvedValue({ ok: true, value: catalog('First') })
    const { view } = await renderProbe()
    await act(async () => undefined)
    view.unmount()
    expect(window.dispatchEvent(pull())).toBe(true)
    await act(async () => undefined)
    expect(api.getEventCatalog).toHaveBeenCalledTimes(1)
    expect(done).not.toHaveBeenCalled()
  })
})

describe('ProductImage (D8)', () => {
  const photo: Product = {
    id: 'p',
    boothId: 'b',
    name: 'Hoodie',
    description: '',
    category: 'Apparel',
    priceCents: 100,
    availableQty: 1,
    maxPerOrder: 1,
    imageUrl: '/products/hoodie.jpg',
  }

  it('a photo that fails to load becomes the category tile', async () => {
    vi.useRealTimers()
    const { ProductImage } = await import('../../shared/ui/ProductImage')
    const { container } = render(<ProductImage product={photo} size="small" />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Apparel').className).toContain('product-image--placeholder')
  })
})
