import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { Booth, Product } from '../../shared/types'
import { formatMoney } from '../../shared/ui/labels'
import { ProductImage } from '../../shared/ui/ProductImage'
import { useProductSheetLink } from './productSheetLink'

/** How long each featured slide shows before the next, while the carousel plays. */
export const HERO_ADVANCE_MS = 5000

/**
 * Shop's top banner: a few featured products, full width, big type over a soft scrim. The slides
 * scroll and snap like any carousel; while nothing is pressed, hovered or focused in it, the next one
 * slides in every few seconds. Pause stops that for good (WCAG 2.2.2); reduced motion never starts it.
 */
export function HomeHero({ products, boothsById, currency }: { products: Product[]; boothsById: Map<string, Booth>; currency: string }) {
  const sheetLink = useProductSheetLink()
  const trackRef = useRef<HTMLUListElement>(null)
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  // Held while a finger, the pointer or focus is in the carousel, so it never moves under the person.
  const [held, setHeld] = useState(false)

  // The dot follows whichever slide is mostly in view, however it got there.
  useEffect(() => {
    const track = trackRef.current
    if (!track || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index))
      },
      { root: track, threshold: 0.6 },
    )
    track.querySelectorAll('[data-index]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [products.length])

  useEffect(() => {
    if (paused || held || products.length < 2) return
    const id = window.setTimeout(() => {
      const track = trackRef.current
      const next = track?.querySelector<HTMLElement>(`[data-index="${(active + 1) % products.length}"]`)
      if (track && next) track.scrollTo({ left: next.offsetLeft - track.offsetLeft - parseFloat(getComputedStyle(track).scrollPaddingLeft || '0'), behavior: 'smooth' })
    }, HERO_ADVANCE_MS)
    return () => window.clearTimeout(id)
  }, [active, paused, held, products.length])

  const playing = !paused && !held && products.length > 1
  if (products.length === 0) return null
  return (
    <section
      className="hero"
      data-playing={playing}
      style={{ '--hero-advance': `${HERO_ADVANCE_MS}ms` } as CSSProperties}
      aria-roledescription="carousel"
      aria-label="Featured"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false)
      }}
    >
      <ul className="hero__track" role="list" ref={trackRef}>
        {products.map((product, i) => {
          const booth = boothsById.get(product.boothId)
          return (
            <li key={product.id} className="hero__slide" data-index={i} aria-roledescription="slide" aria-label={`${i + 1} of ${products.length}`}>
              <Link className="hero__card" {...sheetLink(product.id)}>
                <ProductImage product={product} size="large" priority={i === 0} />
                <span className="hero__scrim" aria-hidden="true" />
                <span className="hero__text">
                  <span className="hero__name">{product.name}</span>
                  <span className="hero__meta">
                    <span className="visually-hidden">, </span>
                    <span className="hero__price">{formatMoney(product.priceCents, currency)}</span>
                    {booth && (
                      <span className="hero__vendor">
                        <span className="visually-hidden">, </span>
                        {booth.vendorName}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      {products.length > 1 && (
        <div className="hero__controls">
          {/* Story-style progress: past slides full, the current one filling while it plays. */}
          <span className="hero__progress" aria-hidden="true">
            {products.map((p, i) => (
              <span key={p.id} className={`hero__seg${i < active ? ' is-done' : ''}${i === active ? ' is-active' : ''}`}>
                {/* Keyed on play state, so the fill restarts with the timer when play resumes. */}
                {i === active && <span key={`${active}-${playing}`} className="hero__fill" />}
              </span>
            ))}
          </span>
          <button type="button" className="hero__pause" aria-pressed={paused} onClick={() => setPaused((v) => !v)}>
            <span className="visually-hidden">Pause featured slides</span>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              {paused ? <path d="M8 5.5v13l10-6.5z" /> : <path d="M8 5h3v14H8zM13 5h3v14h-3z" />}
            </svg>
          </button>
        </div>
      )}
    </section>
  )
}
