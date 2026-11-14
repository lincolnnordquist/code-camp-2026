// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { builtChunkUrl, CHUNK_WAIT_MS, chunkFor, registerRouteChunk, retryChunk, waitForChunk, type RouteChunk } from './routeChunks'

const fakeChunk = (preload: () => Promise<unknown>, loaded = false): RouteChunk => ({ loaded: () => loaded, preload })

afterEach(() => {
  document.head.innerHTML = ''
  vi.useRealTimers()
})

describe('on-demand screen code', () => {
  it('finds the screen a path opens by its route pattern, and none for a screen in the first download', () => {
    const map = fakeChunk(() => Promise.resolve())
    const order = fakeChunk(() => Promise.resolve())
    registerRouteChunk(['/e/:eventSlug/map'], map)
    registerRouteChunk(['/orders/:orderId'], order)
    expect(chunkFor('/e/con/map')).toBe(map)
    expect(chunkFor('/orders/o-1')).toBe(order)
    expect(chunkFor('/orders')).toBeNull()
    expect(chunkFor('/e/con')).toBeNull()
  })

  it("names a screen's built file from the build's file list, and nothing in development", () => {
    expect(builtChunkUrl('MapPage')).toBeNull()
    document.head.innerHTML =
      '<meta name="precache" content="/assets/index-AbC1.js /assets/MapPage-_6fOnk0J.js /assets/MapPageExtra-Zz9.js /assets/map-x1.css">'
    expect(builtChunkUrl('MapPage')).toBe('/assets/MapPage-_6fOnk0J.js')
    expect(builtChunkUrl('OrderPage')).toBeNull()
  })

  it('retries with the usual import first and keeps its result when that works (Chromium)', async () => {
    const load = vi.fn().mockResolvedValue('module')
    await expect(retryChunk(load, 'MapPage', 1)).resolves.toBe('module')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('in development, with no file to ask for under a new name, a failed retry stays failed', async () => {
    const failure = new TypeError('Importing a module script failed.')
    await expect(retryChunk(() => Promise.reject(failure), 'MapPage', 1)).rejects.toBe(failure)
  })

  it('a tap waits for code that arrives quickly, asks again once after a failure, and gives up waiting after the limit', async () => {
    await expect(waitForChunk(fakeChunk(() => Promise.resolve()))).resolves.toBe('loaded')

    const flaky = vi.fn().mockRejectedValueOnce(new Error('aborted')).mockResolvedValueOnce(undefined)
    await expect(waitForChunk(fakeChunk(flaky))).resolves.toBe('loaded')
    expect(flaky).toHaveBeenCalledTimes(2)

    await expect(waitForChunk(fakeChunk(() => Promise.reject(new Error('offline'))))).resolves.toBe('failed')

    vi.useFakeTimers()
    const slow = waitForChunk(fakeChunk(() => new Promise(() => undefined)))
    await vi.advanceTimersByTimeAsync(CHUNK_WAIT_MS)
    await expect(slow).resolves.toBe('slow')
  })
})
