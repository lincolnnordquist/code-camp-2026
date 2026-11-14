import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('preloadBanner', () => {
  it('starts each banner once, however often a link is pressed, hovered or focused, and skips a booth without one', async () => {
    const created: string[] = []
    vi.stubGlobal(
      'Image',
      class {
        decoding = ''
        set src(url: string) {
          created.push(url)
        }
      },
    )
    const { bannerPreloadProps, preloadBanner } = await import('./bannerPreload')
    const props = bannerPreloadProps({ bannerUrl: 'https://storage.example/b.png' })
    props.onPointerDown()
    props.onMouseEnter()
    props.onFocus()
    preloadBanner(null)
    preloadBanner('')
    expect(created).toEqual(['https://storage.example/b.png'])
  })
})
