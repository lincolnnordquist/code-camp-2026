// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { productShareUrl, shareOrCopy, storefrontShareUrl } from './share'
import { ShareButton } from './ShareButton'

const DATA = { title: 'Titan Hoodie', text: 'Titan Hoodie at Wall Rose Goods, Booth A3', url: 'https://example.test/e/ev/booth/b?product=p' }

function stub(name: 'share' | 'canShare' | 'clipboard', value: unknown) {
  Object.defineProperty(navigator, name, { configurable: true, value })
}

afterEach(() => {
  cleanup()
  for (const name of ['share', 'canShare', 'clipboard']) Reflect.deleteProperty(navigator, name)
  vi.useRealTimers()
})

describe('shareOrCopy', () => {
  it('uses the system share sheet when there is one, with the title, line and link', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    stub('share', share)
    stub('clipboard', { writeText })
    expect(await shareOrCopy(DATA)).toBe('shared')
    expect(share).toHaveBeenCalledWith(DATA)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('a cancelled share sheet is not an error and copies nothing', async () => {
    const writeText = vi.fn()
    stub('share', vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' })))
    stub('clipboard', { writeText })
    expect(await shareOrCopy(DATA)).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies the link when there is no share sheet, or the browser refuses it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stub('clipboard', { writeText })
    expect(await shareOrCopy(DATA)).toBe('copied')
    stub('share', vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' })))
    expect(await shareOrCopy(DATA)).toBe('copied')
    stub('canShare', () => false)
    stub('share', vi.fn())
    expect(await shareOrCopy(DATA)).toBe('copied')
    expect(writeText).toHaveBeenCalledTimes(3)
    expect(writeText).toHaveBeenCalledWith(DATA.url)
  })

  it('says it failed when the link cannot be copied either', async () => {
    stub('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    expect(await shareOrCopy(DATA)).toBe('failed')
  })
})

describe('share links', () => {
  it('a product links to its storefront with its sheet open; a booth to its plain storefront', () => {
    expect(productShareUrl('https://dibspot.test', 'code-camp', 'b 1', 'p/2')).toBe('https://dibspot.test/e/code-camp/booth/b%201?product=p%2F2')
    expect(storefrontShareUrl('https://dibspot.test', 'code-camp', 'b1')).toBe('https://dibspot.test/e/code-camp/booth/b1')
  })
})

describe('ShareButton', () => {
  it('shows and says "Link copied" after copying, then clears it', async () => {
    vi.useFakeTimers()
    stub('clipboard', { writeText: vi.fn().mockResolvedValue(undefined) })
    render(
      <ShareButton className="x" data={() => DATA}>
        Share
      </ShareButton>,
    )
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    })
    expect(status.textContent).toBe('Link copied')
    expect(document.querySelector('.share-toast__snackbar')?.textContent).toBe('Link copied')
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(status.textContent).toBe('')
    expect(document.querySelector('.share-toast__snackbar')).toBeNull()
  })

  it('shows nothing after a share or a cancel', async () => {
    stub('share', vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' })))
    render(
      <ShareButton className="x" data={() => DATA}>
        Share
      </ShareButton>,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    })
    expect(screen.getByRole('status').textContent).toBe('')
  })
})
