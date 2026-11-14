import type { Booth } from '../../shared/types'

/** Pictures already requested this session, so repeated hovers and focus do not start them again. */
const started = new Set<string>()

/**
 * Starts downloading a storefront picture (the booth's banner or logo) as soon as the person shows
 * they are going to its storefront (pressing, hovering or focusing a link to it), so it is usually
 * in the browser's cache by the time the storefront paints. The browser keeps the response; this
 * holds no reference to it.
 */
export function preloadBanner(url: string | null | undefined) {
  if (!url || started.has(url) || typeof Image === 'undefined') return
  started.add(url)
  const img = new Image()
  img.decoding = 'async'
  img.src = url
}

/** Props for a link into a booth's storefront: they start its banner and logo early, the banner first. */
export function bannerPreloadProps(booth: Pick<Booth, 'bannerUrl' | 'logoUrl'>) {
  const start = () => {
    preloadBanner(booth.bannerUrl)
    preloadBanner(booth.logoUrl)
  }
  return { onPointerDown: start, onMouseEnter: start, onFocus: start }
}
