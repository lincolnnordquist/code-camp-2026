/**
 * Remembers each order's Square checkout link on this device, so an attendee who left the payment
 * page can go back to it while the hold lasts, from any tab or the home-screen app (iOS opens Square
 * in Safari, a different session). Forgotten once the order leaves pending payment.
 */
const KEY_PREFIX = 'checkout.'

export function rememberCheckoutUrl(orderId: string, url: string) {
  try {
    localStorage.setItem(KEY_PREFIX + orderId, url)
  } catch {
    // Without storage the attendee can still wait for the hold to end.
  }
}

export function readCheckoutUrl(orderId: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + orderId)
  } catch {
    return null
  }
}

export function forgetCheckoutUrl(orderId: string) {
  try {
    localStorage.removeItem(KEY_PREFIX + orderId)
  } catch {
    // Nothing was stored.
  }
}
