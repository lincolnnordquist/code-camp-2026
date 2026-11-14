// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

describe('useFirstEntrance', () => {
  beforeEach(() => {
    sessionStorage.clear()
    Reflect.deleteProperty(window, 'matchMedia')
  })

  async function list(ready: boolean, key = 'wallet:open') {
    const { useFirstEntrance } = await import('./useFirstEntrance')
    function List() {
      return (
        <ul {...useFirstEntrance(key, ready)}>
          <li>a</li>
        </ul>
      )
    }
    return render(<List />)
  }

  it('plays once per session for a list, only once its data is there', async () => {
    const waiting = await list(false)
    expect(waiting.container.querySelector('[data-entrance]')).toBeNull()
    cleanup()
    const first = await list(true)
    expect(first.container.querySelector('ul')!.hasAttribute('data-entrance')).toBe(true)
    cleanup()
    // A tab return, Back or reload in the same session: no entrance.
    const again = await list(true)
    expect(again.container.querySelector('ul')!.hasAttribute('data-entrance')).toBe(false)
    cleanup()
    // Another list still gets its own first entrance.
    const other = await list(true, 'wallet:past')
    expect(other.container.querySelector('ul')!.hasAttribute('data-entrance')).toBe(true)
  })

  it('never plays under reduced motion', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true })
    const r = await list(true)
    expect(r.container.querySelector('ul')!.hasAttribute('data-entrance')).toBe(false)
  })
})
