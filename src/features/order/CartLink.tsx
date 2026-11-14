import { Link, useLocation } from 'react-router-dom'
import { formatMoney } from '../../shared/ui/labels'
import { cartCount, cartTotal, useCart } from './cartStore'

/** The shopping screens: the event home (with its search, categories and product sheet) and storefronts. */
const SHOPPING = /^\/e\/[^/]+(\/booth\/[^/]+)?$/

/**
 * Floating "View cart" bar above the tab bar, shown only while the cart has items and only while
 * shopping: never on the map, the booth list, the wallet, an order, or the cart itself.
 */
export function CartLink() {
  const cart = useCart()
  const { pathname } = useLocation()
  const count = cartCount(cart)
  if (!cart || count === 0 || !SHOPPING.test(pathname)) return null
  return (
    // In its own labelled landmark, so it is reachable from a screen reader's landmarks list.
    <nav aria-label="Cart">
      <Link className="cart-bar" to={`/e/${cart.eventSlug}/cart`}>
        <span>View cart ({count})</span>
        <span className="cart-bar__total">{formatMoney(cartTotal(cart), cart.currency)}</span>
      </Link>
    </nav>
  )
}
