import { useState } from 'react'
import type { Booth } from '../types'
import './BoothLogo.css'

/** Rendered pixel sizes, for the width and height attributes that reserve the box before the image arrives. */
const LOGO_PX = { sm: 32, md: 40, lg: 64 } as const

/**
 * A booth's one picture everywhere it is named: the vendor's logo, round and flush. It sits next to
 * the vendor's name, so it is decorative (empty alt). With no logo, or one that fails to load, the
 * booth code in the quiet tile stands in.
 */
export function BoothLogo({
  booth,
  size = 'md',
  className = '',
}: {
  booth: Pick<Booth, 'code' | 'logoUrl'>
  size?: keyof typeof LOGO_PX
  /** Placement from the screen it sits on (a grid area, a margin). */
  className?: string
}) {
  // Remembers which address failed, so a booth whose logo changes tries the new one.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const px = LOGO_PX[size]
  if (booth.logoUrl && booth.logoUrl !== failedUrl) {
    return (
      <img
        className={`booth-logo booth-logo--${size} ${className}`.trim()}
        src={booth.logoUrl}
        alt=""
        width={px}
        height={px}
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(booth.logoUrl)}
      />
    )
  }
  return (
    <span className={`booth-logo booth-logo--${size} booth-logo--code ${className}`.trim()} aria-hidden="true">
      {booth.code}
    </span>
  )
}
