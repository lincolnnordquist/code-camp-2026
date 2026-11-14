import type { Booth } from '../../shared/types'

/** Banners already requested this session, so repeated hovers and focus do not start them again. */
const started = new Set<string>()

/**
 * Starts downloading a booth's banner as soon as the person shows they are going to its storefront
 * (pressing, hovering or focusing a link to it), so the banner is usually in the browser's cache by
 * the time the storefront paints. The browser keeps the response; this holds no reference to it.
 */
export function preloadBanner(url: string | null | undefined) {
  if (!url || started.has(url) || typeof Image === 'undefined') return
  started.add(url)
  const img = new Image()
  img.decoding = 'async'
  img.src = url
}

/** Props for a link into a booth's storefront: they start its banner early. */
export function bannerPreloadProps(booth: Pick<Booth, 'bannerUrl'>) {
  const start = () => preloadBanner(booth.bannerUrl)
  return { onPointerDown: start, onMouseEnter: start, onFocus: start }
}
