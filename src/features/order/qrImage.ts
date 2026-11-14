import { toDataURL } from 'qrcode'
import { useEffect, useState } from 'react'

/** The quiet zone scanners need around the code, in modules (ISO/IEC 18004). */
export const QR_QUIET_ZONE_MODULES = 4
/** A handful of codes at a couple of sizes; older entries are dropped first. */
const CACHE_LIMIT = 16

const cache = new Map<string, string>()

function remember(key: string, url: string) {
  cache.set(key, url)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
}

/** Device pixels for a CSS size, so a 3x screen gets three image pixels per CSS pixel. */
export function qrPixelSize(cssPx: number, dpr = window.devicePixelRatio || 1): number {
  return Math.ceil(cssPx * dpr)
}

/**
 * The QR as a data URL at `px` image pixels, generated on the device so it
 * works offline. Kept per code and size, so reopening the pickup view shows it
 * in the same frame.
 */
export function useQrDataUrl(code: string, px: number | null): string | null {
  const key = px ? `${code}@${px}` : null
  const [generated, setGenerated] = useState<{ key: string; url: string } | null>(null)

  useEffect(() => {
    if (!key || !px || cache.has(key)) return
    let active = true
    toDataURL(code, { width: px, margin: QR_QUIET_ZONE_MODULES, errorCorrectionLevel: 'M' })
      .then((url) => {
        remember(key, url)
        if (active) setGenerated({ key, url })
      })
      // The code itself is always shown as text, so a missing QR loses nothing essential.
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [code, px, key])

  if (!key) return null
  return cache.get(key) ?? (generated?.key === key ? generated.url : null)
}
