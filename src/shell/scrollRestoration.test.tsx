// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserRouter, useNavigate, type NavigateFunction } from 'react-router-dom'
import { RESTORE_WAIT_MS, useScrollRestoration } from './scrollRestoration'

const nav: { current: NavigateFunction | null } = { current: null }
const navigate: NavigateFunction = ((...args: Parameters<NavigateFunction>) => nav.current!(...args)) as NavigateFunction
function Probe() {
  useScrollRestoration()
  const routerNavigate = useNavigate()
  useEffect(() => {
    nav.current = routerNavigate
  })
  return null
}

let contentHeight = 5_000
const scrollTo = vi.fn((_x: number, y: number) => {
  window.scrollY = y
})

/** The attendee scrolls: the position changes and the browser fires scroll. */
function userScrolls(y: number) {
  act(() => {
    window.scrollY = y
    window.dispatchEvent(new Event('scroll'))
  })
}

async function back() {
  const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }))
  await act(async () => {
    window.history.back()
    await popped
  })
}

describe('scroll restoration', () => {
  beforeEach(() => {
    sessionStorage.clear()
    window.history.replaceState(null, '', '/e/x')
    contentHeight = 5_000
    scrollTo.mockClear()
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    Object.defineProperty(document.documentElement, 'scrollHeight', { get: () => contentHeight, configurable: true })
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  })

  afterEach(() => cleanup())

  it('starts a new screen at the top and returns to the saved spot on Back', async () => {
    render(
      <BrowserRouter>
        <Probe />
      </BrowserRouter>,
    )
    userScrolls(1_240)
    act(() => navigate('/e/x/booth/b1'))
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0)
    userScrolls(300)

    await back()
    expect(window.location.pathname).toBe('/e/x')
    expect(scrollTo).toHaveBeenLastCalledWith(0, 1_240)
  })

  it('waits for the returning screen to be tall enough before restoring', async () => {
    render(
      <BrowserRouter>
        <Probe />
      </BrowserRouter>,
    )
    userScrolls(2_000)
    act(() => navigate('/e/x/booths'))
    // The screen Back returns to is still loading: too short to hold the spot.
    contentHeight = 900
    scrollTo.mockClear()
    await back()
    expect(scrollTo).not.toHaveBeenCalled()

    contentHeight = 5_000
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 2_000))
  })

  it('gives up waiting after the limit and settles as close as it can', async () => {
    render(
      <BrowserRouter>
        <Probe />
      </BrowserRouter>,
    )
    userScrolls(2_000)
    act(() => navigate('/e/x/booths'))
    contentHeight = 900
    scrollTo.mockClear()
    await back()
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 2_000), { timeout: RESTORE_WAIT_MS + 1_000 })
  })

  it('keeps the position when only the query changes or the entry is replaced', () => {
    render(
      <BrowserRouter>
        <Probe />
      </BrowserRouter>,
    )
    userScrolls(600)
    scrollTo.mockClear()
    act(() => navigate('/e/x?q=t'))
    act(() => navigate('/e/x?q=te', { replace: true }))
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('a fresh document load starts at the top, even where another page saved a spot (Square return, emailed link)', () => {
    // Saved by earlier documents in this tab: the old shared "default" key, and this page's own.
    sessionStorage.setItem('shell.scroll', JSON.stringify([['default', 314], ['default:/orders/o1', 314]]))
    window.history.replaceState(null, '', '/orders/o1')
    render(
      <BrowserRouter>
        <Probe />
      </BrowserRouter>,
    )
    expect(scrollTo).not.toHaveBeenCalled()
    expect(window.scrollY).toBe(0)
  })

  it('a reload of the same page returns to where it was', () => {
    sessionStorage.setItem('shell.scroll', JSON.stringify([['default:/orders/o1', 314], ['default:/e/x', 900]]))
    window.history.replaceState(null, '', '/orders/o1')
    const entries = vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' } as unknown as PerformanceEntry])
    try {
      render(
        <BrowserRouter>
          <Probe />
        </BrowserRouter>,
      )
      expect(scrollTo).toHaveBeenLastCalledWith(0, 314)
    } finally {
      entries.mockRestore()
    }
  })

  it('keeps each entry its own position, forward as well as back', async () => {
    render(
      <BrowserRouter>
        <Probe />
      </BrowserRouter>,
    )
    userScrolls(400)
    act(() => navigate('/e/x/booth/b1'))
    userScrolls(900)
    await back()
    expect(scrollTo).toHaveBeenLastCalledWith(0, 400)

    const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }))
    await act(async () => {
      window.history.forward()
      await popped
    })
    expect(scrollTo).toHaveBeenLastCalledWith(0, 900)
  })
})
