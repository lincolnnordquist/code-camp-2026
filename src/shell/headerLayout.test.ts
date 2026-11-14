import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// jsdom does not lay out, so these pin the shell's header spacing rules in the stylesheet itself.
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

/** The declarations of the one rule with exactly this selector. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\~]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, 'g'))]
  expect(matches, selector).toHaveLength(1)
  return matches[0][1]
}

describe('header spacing', () => {
  it('a back screen title starts just under a 48 px row, not under a tall empty one', () => {
    expect(css).toMatch(/--header-height: 48px;/)
  })

  it('a page with no row (the emailed order link opened cold) keeps 16 under the safe area', () => {
    expect(rule('.app-header--root ~ main.main--flush')).toMatch(/padding-top: var\(--space-16\)/)
  })

  it('filtered home results keep the tab root layout, with the hero clear of the inline Back', () => {
    expect(rule('.app-header--inline-back:not(.is-collapsed) .app-header__inner')).toMatch(/opacity: 1/)
    // Back stays tappable inside the tab root's row, which ignores taps at rest.
    expect(css).toMatch(/\n\.app-header--inline-back \.app-header__back \{\n {2}pointer-events: auto;/)
    expect(rule('.main--inline-back .discover__header')).toMatch(/padding-left:/)
  })

  it('the offline banner stays over the page under the bar, and media run up behind it too', () => {
    expect(rule('.offline-banner')).toMatch(/position: sticky;[\s\S]*z-index: 9;/)
    expect(css).toMatch(/--app-header-block: calc\(var\(--app-safe-top\) \+ var\(--header-height\) \+ var\(--offline-banner-block, 0px\)\);/)
  })

  it('on a short screen the cart shrinks to a compact pill instead of disappearing (QA D2)', () => {
    const short = css.slice(css.indexOf('@media (max-height: 30rem) {'))
    const cartBar = short.slice(short.indexOf('  .cart-bar {'), short.indexOf('}', short.indexOf('  .cart-bar {')))
    expect(cartBar).toMatch(/width: fit-content;/)
    expect(cartBar).not.toMatch(/display: none/)
  })

  it('the inline Back is a bare arrow at rest and carries the frosted chip once the page scrolls', () => {
    expect(css).toMatch(/^\.app-header--inline-back:not\(\.is-collapsed\) \.app-header__back::before \{/m)
    expect(rule('.app-header--inline-back:not(.is-scrolled) .app-header__back::before')).toMatch(/opacity: 0/)
  })
})
