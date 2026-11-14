import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Rules jsdom cannot lay out, pinned in the stylesheets; both were measured in WebKit and Chromium.
const storefrontCss = readFileSync(new URL('./storefront.css', import.meta.url), 'utf8')
const indexCss = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')

describe('layout rules from the live-site QA', () => {
  it('D8: a short screen caps the storefront banner, after the wide rule that would make it tall', () => {
    const wide = storefrontCss.indexOf('@media (min-width: 45rem)')
    const short = storefrontCss.search(/@media \(max-height: 30rem\) \{\s*\.storefront__banner \{\s*--banner-visible: 56px;/)
    expect(wide).toBeGreaterThan(-1)
    expect(short).toBeGreaterThan(wide)
  })

  it('D4: on a tab root the page starts below the offline banner while it shows, not under it', () => {
    expect(indexCss).toMatch(
      /\.app-header--root ~ \.offline-banner:not\(:empty\) ~ main \{\s*padding-top: calc\(var\(--space-8\) \+ var\(--header-height\)\);/,
    )
  })

  it('the storefront logo frame holds its 56 px circle, neutral fill and ring before the logo arrives', () => {
    expect(storefrontCss).toMatch(
      /\.storefront__logo \{\n {2}display: inline-grid;\n {2}flex: none;\n {2}width: 56px;\n {2}height: 56px;\n {2}overflow: hidden;\n {2}border-radius: var\(--radius-full\);\n {2}background: var\(--neutral-200\);\n {2}box-shadow: 0 0 0 1px var\(--neutral-200\);/,
    )
    expect(storefrontCss).toMatch(/\.storefront__logo img\.booth-logo,\n\.sheet__booth img\.booth-logo \{\n {2}background: var\(--neutral-200\);/)
  })
})
