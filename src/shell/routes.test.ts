import { describe, expect, it } from 'vitest'
import { backLabelOf, hasBack, hasInlineBack, headerTitleOf, parentOf } from './routes'

describe('top app bar route rules', () => {
  it('drilled-in screens have Back and tab roots do not', () => {
    expect(hasBack('/e/con/booth/b-1', '', 0)).toBe(true)
    expect(hasBack('/e/con/cart', '', 0)).toBe(true)
    expect(hasBack('/orders/o-1', '', 0)).toBe(true)
    expect(hasBack('/e/con', '', 3)).toBe(false)
    expect(hasBack('/orders', '', 3)).toBe(false)
  })

  it('filtered results on the home keep the home layout, with Back inline before the title', () => {
    expect(hasBack('/e/con', '?category=Apparel', 0)).toBe(true)
    expect(hasInlineBack('/e/con', '?category=Apparel')).toBe(true)
    expect(hasInlineBack('/e/con', '?q=hoodie')).toBe(true)
    // The plain home has no Back at all; drilled-in screens keep Back in a row of its own.
    expect(hasInlineBack('/e/con', '')).toBe(false)
    expect(hasInlineBack('/e/con/booth/b-1', '?category=Apparel')).toBe(false)
    expect(hasInlineBack('/orders/o-1')).toBe(false)
  })

  it('the emailed order link shows Back only when the app has history to return to', () => {
    expect(hasBack('/o/tok', '', 0)).toBe(false)
    expect(hasBack('/o/tok', '', 2)).toBe(true)
  })

  it('the order screens take the title "Order"; other screens keep the event wordmark', () => {
    expect(headerTitleOf('/orders/o-1')).toBe('Order')
    expect(headerTitleOf('/o/tok')).toBe('Order')
    expect(headerTitleOf('/orders')).toBeNull()
    expect(headerTitleOf('/e/con/booth/b-1')).toBeNull()
  })

  it('the cart and its checkout step name themselves, and Back from checkout returns to the cart', () => {
    expect(headerTitleOf('/e/con/cart')).toBe('Cart')
    expect(headerTitleOf('/e/con/cart/checkout', 'reservation')).toBe('Reserve')
    expect(headerTitleOf('/e/con/cart/checkout', 'prepay')).toBe('Checkout')
    // With the cart not read yet, checkout falls back to the reservation wording.
    expect(headerTitleOf('/e/con/cart/checkout')).toBe('Reserve')
    expect(parentOf('/e/con/cart/checkout')).toBe('/e/con/cart')
    expect(parentOf('/e/con/cart')).toBe('/e/con')
    expect(hasBack('/e/con/cart/checkout', '', 0)).toBe(true)
  })

  it('the icon-only Back is named for where it leads', () => {
    // Opened from a link, Back goes up to the wallet.
    expect(backLabelOf('/orders/o-1', 0)).toBe('Back to your orders')
    // Inside the app it returns to the previous screen, which may not be the wallet.
    expect(backLabelOf('/orders/o-1', 4)).toBe('Back')
    expect(backLabelOf('/e/con/booth/b-1', 0)).toBe('Back')
  })
})
