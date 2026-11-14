import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('preloadBanner', () => {
  it('starts the banner then the logo once each, however often a link is pressed, hovered or focused, and skips a booth without them', async () => {
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
    const props = bannerPreloadProps({ bannerUrl: 'https://storage.example/b.png', logoUrl: 'https://storage.example/l.svg' })
    props.onPointerDown()
    props.onMouseEnter()
    props.onFocus()
    preloadBanner(null)
    preloadBanner('')
    bannerPreloadProps({ bannerUrl: '', logoUrl: '' }).onPointerDown()
    expect(created).toEqual(['https://storage.example/b.png', 'https://storage.example/l.svg'])
  })
})
