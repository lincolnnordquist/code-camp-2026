import { useFirstEntrance } from '../../shell/useFirstEntrance'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Link, useLocation, useNavigationType, useParams, useSearchParams } from 'react-router-dom'
import { Banner } from '../../shared/ui/Banner'
import { Icon } from '../../shared/ui/Icon'
import { formatMoney, pausedBoothBadge, shopTypeLabels } from '../../shared/ui/labels'
import { isPaused } from './boothLabel'
import { StorefrontSkeleton } from './DiscoverSkeletons'
import { BoothLogo } from '../../shared/ui/BoothLogo'
import { ProductImage } from '../../shared/ui/ProductImage'
import { ProductSheetHost, type RenderOrderControl } from './ProductSheet'
import { useProductSheetLink } from './productSheetLink'
import { SavedCopyNote } from './SavedCopyNote'
import { storefrontShareUrl } from './share'
import { ShareButton, ShareIcon } from './ShareButton'
import { StockLine } from './StockLine'
import { stockState } from './stockState'
import { CatalogError } from './CatalogError'
import { useCatalog } from './useCatalog'
import { activeFilterCount, applyFilters, narrowingLabels, NO_FILTERS, readFilters, writeFilters, type ProductFilters } from './filters'
import { FiltersChip, FiltersSheet } from './FiltersSheet'
import './storefront.css'

/** The storefront's category filter, named as on the event home. */
const CATEGORY_PARAM = 'category'
const TAB_ID = 'storefront-tab'
const PANEL_ID = 'storefront-products'

export interface StorefrontProps {
  /**
   * Ordering controls come from the order feature. Feature folders may not
   * import each other (ARCHITECTURE.md, "Codemap"), so the route wires them in.
   */
  renderOrderControl: RenderOrderControl
}

/** FR-05: a booth's products with price, stock, and ordering only where the booth allows it. */
export function Storefront({ renderOrderControl }: StorefrontProps) {
  const { eventSlug = '', boothId = '' } = useParams()
  const location = useLocation()
  const { hash, key } = location
  const [params, setParams] = useSearchParams()
  const filterParam = params.get(CATEGORY_PARAM)
  const navigationType = useNavigationType()
  const { state, reload } = useCatalog(eventSlug)
  // The shelf rises in once per session per booth, the first time its products render (shell, index.css).
  const productsEntrance = useFirstEntrance(`storefront:${boothId}:products`, state.status === 'ready')
  const sheetLink = useProductSheetLink()
  const signRef = useRef<HTMLDListElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  // Shown once the booth sign has scrolled under the app header; it sits on that header's bottom edge.
  const [bar, setBar] = useState({ shown: false, top: 0 })
  const ready = state.status === 'ready'
  const filters = readFilters(params)
  // A banner that fails to load leaves the plain banner band, not the browser's broken-image icon.
  const [failedBanner, setFailedBanner] = useState<string | null>(null)
  // The banner's box is reserved at its final size from the first paint; the picture fades in once
  // it has loaded instead of popping in late.
  const [loadedBanner, setLoadedBanner] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtersChipRef = useRef<HTMLDivElement>(null)
  const filtersReturnFocus = useCallback(() => filtersChipRef.current?.querySelector<HTMLElement>('.chip--filters') ?? null, [])

  // A #product link centres that card on arrival. Back and Forward (POP) keep the position the shell restored;
  // a link opened in a fresh tab is a POP too, but its entry has no history key ('default') and nothing to restore.
  const returning = navigationType === 'POP' && key !== 'default'
  useEffect(() => {
    if (ready && hash && !returning) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'center' })
  }, [ready, hash, returning])

  useEffect(() => {
    const sign = signRef.current
    if (!ready || !sign || typeof IntersectionObserver === 'undefined') return
    const appHeader = document.querySelector('.app-header')
    const height = appHeader?.getBoundingClientRect().height ?? 0
    const io = new IntersectionObserver(
      ([entry]) =>
        setBar({
          shown: !entry.isIntersecting && entry.boundingClientRect.top < height,
          top: Math.max(0, appHeader?.getBoundingClientRect().bottom ?? 0),
        }),
      { rootMargin: `-${Math.round(height)}px 0px 0px 0px` },
    )
    io.observe(sign)
    return () => io.disconnect()
  }, [ready])

  if (state.status === 'loading') return <StorefrontSkeleton />
  if (state.status === 'error') return <CatalogError refusal={state.refusal} onRetry={() => void reload()} />

  const { catalog } = state
  const booth = catalog.booths.find((b) => b.id === boothId)
  if (!booth) {
    return (
      <div className="screen-state">
        <h1 className="screen-state__message">We could not find this booth.</h1>
        <Link to={`/e/${eventSlug}`}>Back to the event</Link>
      </div>
    )
  }
  const products = catalog.products.filter((p) => p.boothId === booth.id)
  const categories = [...new Set(products.map((p) => p.category))].sort((a, b) => a.localeCompare(b))
  // An unknown category in the URL (an old link) shows everything rather than an empty shelf.
  const shownCategory = filterParam !== null && categories.includes(filterParam) ? filterParam : null
  const inCategory = shownCategory === null ? products : products.filter((p) => p.category === shownCategory)
  // Featured is the booth's own order; filters and a price sort apply on top (filters.ts).
  const shown = applyFilters(inCategory, (p) => p, filters)
  const filteredOut = shown.length === 0 && inCategory.length > 0
  const shownCount = `${shown.length} ${shown.length === 1 ? 'product' : 'products'}`
  const takesOrders = booth.mode !== 'discovery' && !isPaused(booth)
  const mapHref = `/e/${eventSlug}/map?booth=${booth.id}`

  // The filter lives in the URL like the home's, replacing the entry so Back still leaves the booth.
  const pickCategory = (c: string | null) => {
    const next = new URLSearchParams(params)
    if (c === null) next.delete(CATEGORY_PARAM)
    else next.set(CATEGORY_PARAM, c)
    setParams(next, { replace: true, state: location.state })
  }

  const changeFilters = (f: ProductFilters) => setParams(writeFilters(params, f), { replace: true, state: location.state })

  const tabs: Array<string | null> = [null, ...categories]
  const hasTabs = categories.length > 1
  const shownTab = tabs.indexOf(shownCategory)
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    pickCategory(tabs[next])
    tabsRef.current?.querySelector<HTMLElement>(`#${TAB_ID}-${next}`)?.focus()
  }

  // How the booth takes orders, in the label module's words; a paused booth never reads as taking them (FR-05).
  const shopType = isPaused(booth) ? (
    <span className="storefront__paused">
      <Icon name="pause_circle" size={16} />
      {pausedBoothBadge.label}
    </span>
  ) : (
    shopTypeLabels[booth.mode].label
  )

  return (
    // The banner leads the page, so it asks the shell for the header that floats over media (App.tsx).
    <div className="storefront" data-header="over-media">
      {/* The vendor name moves into the app header on scroll; this bar keeps the plate and mode in view. */}
      <div
        className={`storefront__bar${bar.shown ? ' is-shown' : ''}`}
        style={{ '--storefront-bar-top': `${bar.top}px` } as CSSProperties}
        inert={!bar.shown}
      >
        <div className="storefront__bar-inner">
          <Link className="plate-link" to={mapHref}>
            <BoothLogo booth={booth} size="sm" />
            <span className="plate-link__text">
              Find it on the map<span className="visually-hidden">, Booth {booth.code}</span>
            </span>
          </Link>
          <span className="storefront__bar-type">{shopType}</span>
        </div>
      </div>

      {/* The banner and the logo are decorative beside the name. */}
      <header className="storefront__header">
        <div className="storefront__banner">
          {booth.bannerUrl && booth.bannerUrl !== failedBanner && (
            <img
              className={booth.bannerUrl === loadedBanner ? 'is-loaded' : undefined}
              src={booth.bannerUrl}
              alt=""
              width={1200}
              height={400}
              // The storefront's first picture: requested at once, ahead of the product photos.
              loading="eager"
              fetchPriority="high"
              decoding="async"
              // A banner already in the cache (preloaded from the link) can finish before React attaches onLoad.
              ref={(img) => {
                if (img?.complete && img.naturalWidth > 0 && loadedBanner !== booth.bannerUrl) setLoadedBanner(booth.bannerUrl)
              }}
              onLoad={() => setLoadedBanner(booth.bannerUrl)}
              onError={() => setFailedBanner(booth.bannerUrl)}
            />
          )}
          <ShareButton
            className="storefront__share"
            label={`Share ${booth.vendorName}`}
            data={() => ({
              title: booth.vendorName,
              text: `${booth.vendorName}, Booth ${booth.code} at ${catalog.event.name}`,
              url: storefrontShareUrl(window.location.origin, eventSlug, booth.id),
            })}
          >
            <ShareIcon size={22} />
          </ShareButton>
        </div>
        <div className="storefront__identity">
          <span className="storefront__logo">
            <BoothLogo booth={booth} size="lg" />
          </span>
          <div className="storefront__name">
            <h1>{booth.vendorName}</h1>
            {booth.slogan && <p className="storefront__tagline">{booth.slogan}</p>}
          </div>
        </div>
        <dl className="storefront__facts" ref={signRef}>
          <div>
            <dt>Booth</dt>
            <dd>{booth.code}</dd>
          </div>
          <div>
            <dt>Shop type</dt>
            <dd>{shopType}</dd>
          </div>
          <div>
            <dt>Map</dt>
            <dd>
              <Link className="storefront__map" to={mapHref}>
                Find it<span className="visually-hidden"> on the map, Booth {booth.code}</span>
                <Icon name="chevron_right" size={20} />
              </Link>
            </dd>
          </div>
        </dl>
      </header>

      <SavedCopyNote show={state.fromCache} onRetry={() => void reload()} />

      {/* The vendor's own words only; a booth that has written none shows no note. */}
      {booth.pickupInstructions && (
        <div className="storefront__pickup">
          <Banner tone="neutral" icon="shopping_bag">
            <span>{booth.pickupInstructions}</span>
          </Banner>
        </div>
      )}

      {isPaused(booth) && (
        <div className="storefront__notice" role="status">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            <rect x="7" y="6" width="3.5" height="12" rx="1" />
            <rect x="13.5" y="6" width="3.5" height="12" rx="1" />
          </svg>
          <p>
            <strong>Ordering is paused.</strong> You can still browse.
          </p>
        </div>
      )}

      {products.length > 0 && (
        <div className="storefront__tabs-row">
          {/* A booth with one category has no tabs; the row still carries Filters at its end. */}
          <div className="storefront__tabs" ref={tabsRef} {...(hasTabs && { role: 'tablist', 'aria-label': 'Category' })}>
            {hasTabs &&
              tabs.map((c, i) => {
                const selected = c === shownCategory
                const count = c === null ? products.length : products.filter((p) => p.category === c).length
                return (
                  <button
                    key={c ?? 'all'}
                    type="button"
                    role="tab"
                    id={`${TAB_ID}-${i}`}
                    className="storefront__tab"
                    aria-selected={selected}
                    aria-controls={PANEL_ID}
                    aria-label={`${c ?? 'All'}, ${count} ${count === 1 ? 'product' : 'products'}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => pickCategory(c)}
                    onKeyDown={(e) => onTabKey(e, i)}
                  >
                    <span className="storefront__tab-label">{c ?? 'All'}</span>
                    <span className="storefront__tab-count">{count}</span>
                  </button>
                )
              })}
          </div>
          <span className="storefront__filters" ref={filtersChipRef}>
            <FiltersChip filters={filters} expanded={filtersOpen} onOpen={() => setFiltersOpen(true)} />
          </span>
        </div>
      )}

      {/* The count is spoken when a filter or sort changes what the shelf shows. */}
      <p className="visually-hidden" role="status">
        {activeFilterCount(filters) > 0 || shownCategory !== null ? (filteredOut ? `No products with ${narrowingLabels(filters).join(' and ')}.` : shownCount) : ''}
      </p>

      {filteredOut && (
        <div className="storefront__empty">
          <p>No products with {narrowingLabels(filters).join(' and ')}.</p>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              changeFilters(NO_FILTERS)
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {products.length === 0 ? (
        <div className="storefront__empty">
          <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" focusable="false">
            <path d="M5 8h14l-1 12H6L5 8z" />
            <path d="M9 8V6a3 3 0 0 1 6 0v2" />
          </svg>
          <p>Nothing on the table yet. Stop by the booth to see what they have.</p>
        </div>
      ) : (
        <ul
          className="product-grid storefront__grid"
          role="list"
          {...productsEntrance}
          {...(hasTabs && { id: PANEL_ID, 'aria-labelledby': `${TAB_ID}-${shownTab}` })}
        >
          {shown.map((product) => (
            <li key={product.id} id={product.id} className="product-grid__item">
              <Link className="product-card" {...sheetLink(product.id)}>
                <ProductImage product={product} size="large" />
                <span className="product-card__body">
                  <span className="product-card__name">{product.name}</span>
                  {product.description && (
                    <span className="product-card__desc">
                      <span className="visually-hidden">, </span>
                      <span>{product.description}</span>
                    </span>
                  )}
                  <span className="product-card__price">
                    <span className="visually-hidden">, </span>
                    {formatMoney(product.priceCents, catalog.event.currency)}
                  </span>
                  {stockState(product.availableQty) && <span className="visually-hidden">, </span>}
                  <StockLine qty={product.availableQty} reserve />
                </span>
              </Link>
              {/* FR-05: ordering only where the booth takes orders, it is not paused, and stock is left. */}
              {takesOrders && product.availableQty > 0 && (
                <div className="product-card__order">{renderOrderControl({ product, booth, event: catalog.event, variant: 'card' })}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      <FiltersSheet
        open={filtersOpen}
        filters={filters}
        onChange={changeFilters}
        onClose={() => setFiltersOpen(false)}
        defaultSortLabel="Featured"
        resultCount={shown.length}
        returnFocus={filtersReturnFocus}
      />

      <ProductSheetHost catalog={catalog} renderOrderControl={renderOrderControl} currentBoothId={booth.id} />
    </div>
  )
}
