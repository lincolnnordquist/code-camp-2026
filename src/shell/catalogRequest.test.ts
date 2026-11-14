import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ getEventCatalog: vi.fn() }))
vi.mock('../shared/api', () => api)

const deferred = () => {
  let resolve: (v: unknown) => void = () => undefined
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetModules()
  api.getEventCatalog.mockReset()
})

describe('requestEventCatalog (one set of requests per event per navigation)', () => {
  it('callers asking for the same event at once share one request; another event gets its own', async () => {
    const first = deferred()
    api.getEventCatalog.mockReturnValue(first.promise)
    const { requestEventCatalog } = await import('./catalogRequest')
    const header = requestEventCatalog('code-camp-2026')
    const screen = requestEventCatalog('code-camp-2026')
    requestEventCatalog('other-event')
    expect(screen).toBe(header)
    expect(api.getEventCatalog.mock.calls).toEqual([['code-camp-2026'], ['other-event']])
    first.resolve({ ok: true })
    await expect(screen).resolves.toEqual({ ok: true })
  })

  it('a screen that mounts just after the answer arrived shares it; seconds later it asks the server again', async () => {
    vi.useFakeTimers()
    try {
      api.getEventCatalog.mockResolvedValue({ ok: true })
      const { requestEventCatalog } = await import('./catalogRequest')
      await requestEventCatalog('code-camp-2026')
      vi.advanceTimersByTime(1000)
      await requestEventCatalog('code-camp-2026')
      expect(api.getEventCatalog).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(3000)
      await requestEventCatalog('code-camp-2026')
      expect(api.getEventCatalog).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a failed request is not kept either', async () => {
    api.getEventCatalog.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true })
    const { requestEventCatalog } = await import('./catalogRequest')
    await expect(requestEventCatalog('code-camp-2026')).rejects.toThrow('offline')
    await expect(requestEventCatalog('code-camp-2026')).resolves.toEqual({ ok: true })
  })

  it('a reload the person asked for starts a new request, which later callers share', async () => {
    const first = deferred()
    const second = deferred()
    api.getEventCatalog.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { requestEventCatalog } = await import('./catalogRequest')
    const opening = requestEventCatalog('code-camp-2026')
    const reload = requestEventCatalog('code-camp-2026', { fresh: true })
    expect(reload).not.toBe(opening)
    expect(requestEventCatalog('code-camp-2026')).toBe(reload)
    // The first answer arriving late does not clear the newer request from sharing.
    first.resolve({ ok: true })
    await opening
    expect(requestEventCatalog('code-camp-2026')).toBe(reload)
    expect(api.getEventCatalog).toHaveBeenCalledTimes(2)
  })
})
