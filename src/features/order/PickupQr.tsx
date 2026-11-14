import { useLayoutEffect, useRef, useState } from 'react'
import { qrPixelSize, useQrDataUrl } from './qrImage'

/** Used until the frame is measured, and where layout reports no width (tests). */
const FALLBACK_CSS_PX = 220

/**
 * FR-30 (Extra): the pickup code as a QR code. It encodes only the code, the
 * same text staff would type, so the vendor scanner needs no other format.
 * The frame's CSS width sets the size; the image is drawn at the device pixel
 * ratio so it stays sharp on a 3x phone.
 */
export function PickupQr({ code, className = 'pickup__qr' }: { code: string; className?: string }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [px, setPx] = useState<number | null>(null)

  // Measured before paint, so a cached image appears in the first visible frame.
  useLayoutEffect(() => {
    const measure = () => {
      const frame = frameRef.current
      const style = frame ? getComputedStyle(frame) : null
      // The image fills the frame's content box, so its white padding is left out.
      const padding = style ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) : 0
      const cssPx = (frame?.getBoundingClientRect().width ?? 0) - padding
      setPx(qrPixelSize(cssPx > 0 ? cssPx : FALLBACK_CSS_PX))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const src = useQrDataUrl(code, px)
  return (
    <div className={className} ref={frameRef}>
      {/* Not draggable: a native image drag would cancel the pickup view's swipes. */}
      {src && <img className="pickup-qr__img" src={src} alt="QR code of your pickup code" draggable={false} />}
    </div>
  )
}
