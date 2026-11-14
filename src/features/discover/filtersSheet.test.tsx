// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NO_FILTERS } from './filters'
import { FiltersSheet } from './FiltersSheet'

afterEach(() => {
  cleanup()
  document.documentElement.style.overflow = ''
  vi.restoreAllMocks()
})

const sheet = (open: boolean) => (
  <FiltersSheet
    open={open}
    filters={NO_FILTERS}
    onChange={() => undefined}
    onClose={() => undefined}
    defaultSortLabel="Featured"
    resultCount={3}
    returnFocus={() => null}
  />
)

describe('FiltersSheet page lock', () => {
  it('locks the page while open and releases it on close, back where the page was', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 420 })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const { rerender } = render(sheet(false))
    expect(document.documentElement.style.overflow).toBe('')
    rerender(sheet(true))
    expect(document.documentElement.style.overflow).toBe('hidden')
    // Something moved the page while it was locked (iOS can): closing puts it back.
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
    rerender(sheet(false))
    expect(document.documentElement.style.overflow).toBe('')
    expect(scrollTo).toHaveBeenCalledWith({ top: 420, behavior: 'instant' })
  })

  it('keeps a lock the page already had (the product sheet under it) after it closes', () => {
    document.documentElement.style.overflow = 'clip'
    const { rerender } = render(sheet(true))
    expect(document.documentElement.style.overflow).toBe('hidden')
    rerender(sheet(false))
    expect(document.documentElement.style.overflow).toBe('clip')
  })

  it('releases the lock when the screen goes while it is open', () => {
    const { unmount } = render(sheet(true))
    unmount()
    expect(document.documentElement.style.overflow).toBe('')
  })
})
