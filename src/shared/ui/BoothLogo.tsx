import { useState } from 'react'
import type { Booth } from '../types'
import './BoothLogo.css'

/** Rendered pixel sizes, for the width and height attributes that reserve the box before the image arrives. */
const LOGO_PX = { sm: 32, md: 40, lg: 64 } as const

/** Logos that have loaded on this page, so a logo shown again draws at once instead of fading in again. */
const shownLogos = new Set<string>()

/**
 * A booth's one picture everywhere it is named: the vendor's logo, round and flush. It sits next to
 * the vendor's name, so it is decorative (empty alt). With no logo, or one that fails to load, the
 * booth code in the quiet tile stands in.
 */
export function BoothLogo({
  booth,
  size = 'md',
  className = '',
  priority = false,
}: {
  booth: Pick<Booth, 'code' | 'logoUrl'>
  size?: keyof typeof LOGO_PX
  /** Placement from the screen it sits on (a grid area, a margin). */
  className?: string
  /** The screen's own booth (the storefront header): requested at once, ahead of the product photos. */
  priority?: boolean
}) {
  // Remembers which address failed, so a booth whose logo changes tries the new one.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const px = LOGO_PX[size]
  const url = booth.logoUrl
  if (url && url !== failedUrl) {
    const shown = loadedUrl === url || shownLogos.has(url)
    const loaded = () => {
      shownLogos.add(url)
      setLoadedUrl(url)
    }
    return (
      // The frame is the logo's final circle from the first frame, in a neutral tone, so a ring drawn
      // around it by the screen never changes size or colour; the logo fades in over it.
      <span className={`booth-logo booth-logo--${size} booth-logo--frame ${className}`.trim()}>
        <img
          className={`booth-logo__img${shown ? ' is-loaded' : ''}`}
          src={url}
          alt=""
          width={px}
          height={px}
          loading={priority || shownLogos.has(url) ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          // A logo already in the cache (preloaded from the link) can finish before React attaches onLoad.
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0 && loadedUrl !== url) loaded()
          }}
          onLoad={loaded}
          onError={() => setFailedUrl(url)}
        />
      </span>
    )
  }
  return (
    <span className={`booth-logo booth-logo--${size} booth-logo--code ${className}`.trim()} aria-hidden="true">
      {booth.code}
    </span>
  )
}
