// Route shape knowledge the shell's gestures and transitions share with the header's Back.

/**
 * The paths the attendee router renders (App.tsx). Links anywhere else (another role's screens, a
 * file) are left to the browser and the router.
 */
const APP_ROUTES = [
  /^\/$/,
  /^\/e\/[^/]+(\/(map|booths|cart|cart\/checkout|booth\/[^/]+))?\/?$/,
  /^\/orders(\/[^/]+)?\/?$/,
  /^\/o\/[^/]+\/?$/,
]

export function isAppRoute(path: string): boolean {
  return APP_ROUTES.some((route) => route.test(path))
}

/** Tab roots cross-fade and have no Back; every other screen is drilled into from one. */
export function isTabRoot(path: string): boolean {
  return /^\/e\/[^/]+(\/(map|booths))?$/.test(path) || path === '/orders'
}

/**
 * Where Back goes when there is no in-app history to return to (a page opened
 * from a link): one level up. Null for tab roots and the emailed order link,
 * which have nowhere above them. Filtered results on the event home sit one
 * level below the unfiltered home.
 */
export function parentOf(path: string, search = ''): string | null {
  const params = new URLSearchParams(search)
  if (/^\/e\/[^/]+$/.test(path) && (params.has('q') || params.has('category'))) return path
  if (isTabRoot(path)) return null
  // Checkout is the cart's second step, so Back from it returns to the cart.
  const checkout = path.match(/^(\/e\/[^/]+\/cart)\/checkout$/)
  if (checkout) return checkout[1]
  const event = path.match(/^\/e\/[^/]+/)
  if (event) return event[0]
  if (path.startsWith('/orders/')) return '/orders'
  return null
}

/** The cart and its checkout step: a focused flow with no tab bar, left behind once an order is placed. */
export function isCartFlow(path: string): boolean {
  return /^\/e\/[^/]+\/cart(\/checkout)?$/.test(path)
}

/** React Router records the position in its history stack; above 0 there is an in-app page to return to. */
export function historyIndex(): number {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' ? idx : 0
}

/** The emailed order link opened cold has nowhere to go back to; reached inside the app, it goes back. */
export function hasBack(path: string, search = '', idx = historyIndex()): boolean {
  return parentOf(path, search) !== null || (path.startsWith('/o/') && idx > 0)
}

/**
 * Filtered results on the event home are still the home, so they keep its large-title layout with
 * Back inline before the title, rather than a Back row of their own above the event hero.
 */
export function hasInlineBack(path: string, search = ''): boolean {
  return isTabRoot(path) && parentOf(path, search) !== null
}

/**
 * The header's own title for screens whose h1 states something else (the order's status, the
 * cart's vendor); else null. Checkout is named for what its button does, which depends on how the
 * cart's booth takes payment.
 */
export function headerTitleOf(path: string, cartMode?: string): string | null {
  if (/^\/(orders\/[^/]+|o\/[^/]+)$/.test(path)) return 'Order'
  if (/^\/e\/[^/]+\/cart$/.test(path)) return 'Cart'
  if (/^\/e\/[^/]+\/cart\/checkout$/.test(path)) return cartMode === 'prepay' ? 'Checkout' : 'Reserve'
  return null
}

/**
 * The icon-only Back button's accessible name. It names the wallet only when Back is sure to land
 * there: with in-app history it returns to the previous screen, which may be the home or a booth.
 */
export function backLabelOf(path: string, idx = historyIndex(), previousPath?: string): string {
  // Behind a new order is the cart it emptied, so Back goes up to the wallet there too (useGoBack).
  const upToWallet = idx === 0 || isCartFlow(previousPath ?? '')
  return path.startsWith('/orders/') && upToWallet ? 'Back to your orders' : 'Back'
}
