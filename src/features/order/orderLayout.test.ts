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

  it('a narrow wallet row drops its badge under the summary', () => {
    expect(css).toMatch(/@container \(max-width: 300px\) \{\n {2}\.past-order \{/)
  })

  it('pickup mode has a compact pass on short phones and a sideways pass in landscape', () => {
    expect(css).toMatch(/@media \(orientation: portrait\) and \(max-height: 720px\)/)
    expect(css).toMatch(/@media \(orientation: landscape\) and \(max-height: 500px\)/)
  })
})
