import type { RefObject } from 'react'
import { BoothLogo } from '../../shared/ui/BoothLogo'
import { BoothPlate } from '../../shared/ui/BoothPlate'
import { shopTypeLabels } from '../../shared/ui/labels'
import type { Cart } from './cartStore'

/** The booth a cart orders from, heading the cart and the checkout; its name is the page's h1. `lead` is spoken before the name. */
export function BoothIdentity({ cart, lead, headingRef }: { cart: Cart; lead: string; headingRef: RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className="booth-identity">
      {/* Carts saved before the logo was recorded have none, and show the code tile. */}
      <BoothLogo booth={{ code: cart.boothCode, logoUrl: cart.logoUrl ?? '' }} className="booth-identity__logo" />
      <div className="booth-identity__text">
        <h1 className="booth-identity__name" ref={headingRef} tabIndex={-1}>
          {/* The space stays outside the hidden span, where every name computation keeps it. */}
          <span className="visually-hidden">{lead}</span> {cart.vendorName}
        </h1>
        <p className="booth-identity__type">{shopTypeLabels[cart.boothMode].label}</p>
      </div>
      <BoothPlate code={cart.boothCode} />
    </div>
  )
}
