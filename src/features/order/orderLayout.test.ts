import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// jsdom does not lay out, so these pin the narrow and short-screen rules in the stylesheet itself
// (QA edge sweep: 200% text, 320 x 568, landscape).
const css = readFileSync(new URL('./order.css', import.meta.url), 'utf8')

describe('order layout at narrow widths and short heights', () => {
  it('the pass header wraps Find booth under the identity instead of squeezing the name', () => {
    expect(css).toMatch(/\.order-pass__head \{\n {2}display: flex;\n {2}flex-wrap: wrap;/)
    expect(css).toMatch(/\.order-pass \.order-vendor__name \{\n {2}overflow-wrap: break-word;/)
  })

  it('the wallet sits beside the rest only when there is room for its 400 px column', () => {
    expect(css).toMatch(/@media \(min-width: 48rem\) \{\n {2}\.orders-layout--with-wallet \{\n {4}display: grid;\n {4}grid-template-columns: minmax\(0, 400px\) minmax\(0, 1fr\);/)
  })

  it('the passes change place at once under reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n {2}\.wallet-stack,\n {2}\.wallet-pass \{\n {4}transition: none;/)
  })

  it('pickup mode has a compact pass on short phones and a sideways pass in landscape', () => {
    expect(css).toMatch(/@media \(orientation: portrait\) and \(max-height: 720px\)/)
    expect(css).toMatch(/@media \(orientation: landscape\) and \(max-height: 500px\)/)
  })

  it('item and cart photos sit on our own neutral square from the first frame, the photo tile see-through over it', () => {
    expect(css).toMatch(/\.order-item__photo,\n\.cart__photo \{\n {2}display: block;\n {2}overflow: hidden;\n {2}border-radius: var\(--radius-sm\);\n {2}background: var\(--neutral-200\);/)
    expect(css).toMatch(/\.order-item__photo \{\n {2}width: 48px;\n {2}height: 48px;/)
    expect(css).toMatch(/\.cart__photo \{\n {2}width: 64px;\n {2}height: 64px;/)
    expect(css).toMatch(/\.order-item__photo \.product-image--frame,\n\.cart__photo \.product-image--frame \{\n {2}background: transparent;/)
  })
})
