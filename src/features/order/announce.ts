/** Long enough for a screen reader to notice the same sentence written again after it was cleared. */
export const ANNOUNCE_GAP_MS = 100

/** Writes a sentence into a mounted live region: cleared first, so a repeat of the same text is read again. */
export function announceIn(region: HTMLElement | null, text: string) {
  if (!region) return
  region.textContent = ''
  window.setTimeout(() => {
    region.textContent = text
  }, ANNOUNCE_GAP_MS)
}
