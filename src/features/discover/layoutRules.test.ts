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
})
