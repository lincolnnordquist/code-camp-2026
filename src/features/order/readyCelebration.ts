/** Orders this device has already celebrated as ready for pickup, newest last. */
const STORAGE_KEY = 'order.readyCelebrated.v1'

/** Enough for a whole event's orders; the oldest drop off so the list never grows without bound. */
const MAX_REMEMBERED = 100

/** A short buzz, a pause, a second buzz: felt as "it's ready" without looking. iOS ignores it. */
export const READY_VIBRATION = [40, 60, 40]

// Storage can be blocked or full; this page life still celebrates each order at most once.
const celebratedThisPage = new Set<string>()

function readCelebrated(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * True the first time this device sees the order ready, and false every time after, so the
 * celebration plays once per order, not on every render or reload.
 */
export function claimReadyCelebration(orderId: string): boolean {
  if (celebratedThisPage.has(orderId)) return false
  celebratedThisPage.add(orderId)
  const saved = readCelebrated()
  if (saved.includes(orderId)) return false
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...saved, orderId].slice(-MAX_REMEMBERED)))
  } catch {
    // Not remembered across reloads; the in-page set above still stops a replay here.
  }
  return true
}

/** A buzz where the browser supports it; a refusal or a missing API changes nothing on screen. */
export function vibrateReady() {
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(READY_VIBRATION)
  } catch {
    // Some browsers throw when vibration is blocked by policy; the celebration is complete without it.
  }
}
