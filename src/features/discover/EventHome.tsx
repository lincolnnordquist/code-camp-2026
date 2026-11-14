import { focusQuietly } from '../../shell/inputModality'
import { useFirstEntrance } from '../../shell/useFirstEntrance'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { EventBanner } from '../../shared/ui/EventBanner'
import { formatMoney } from '../../shared/ui/labels'
import type { EventCatalog, Product } from '../../shared/types'
import { ActiveOrders } from './ActiveOrders'
import { openOrdersSettled, primeOpenOrders } from './openOrders'
import { EventHomeSkeleton } from './DiscoverSkeletons'
import { ProductImage } from '../../shared/ui/ProductImage'
import { ProductSheetHost, type RenderOrderControl } from './ProductSheet'
import { useProductSheetLink } from './productSheetLink'
import { addRecentSearch, clearRecentSearches, readRecentSearches, removeRecentSearch } from './recentSearches'
import { categoriesOf, descriptionSnippet, groupHitsByBooth, highlightParts, searchBooths, searchCatalog, topCategories, type SearchHit } from './search'
import { BoothListRow } from './BoothListRow'
import { SavedCopyNote } from './SavedCopyNote'
import { StockLine } from './StockLine'
import { soldOutLast, stockState } from './stockState'
import { CatalogError } from './CatalogError'
import { useCatalog } from './useCatalog'
import { applyFilters, narrowingLabels, NO_FILTERS, readFilters, writeFilters, type ProductFilters } from './filters'
import { featuredProducts, homeShelves } from './shelves'
import { HomeHero } from './HomeHero'
import { HomeProductCard, ProductShelf } from './ProductShelf'
import { FiltersChip, FiltersSheet } from './FiltersSheet'
import './storefront.css'
import './home.css'

/** The count is spoken once typing pauses, not on every keystroke. */
const RESULT_ANNOUNCE_DELAY_MS = 500

/** Space between the search bar and the first line of the search view. */
const SEARCH_VIEW_GAP_PX = 8

/** The longest the home waits for the open orders before showing without them (they then slot in). */
const ORDERS_WAIT_MS = 300

/** How long after Cancel a click is ignored: the rest of the tap that pressed it. */
const CANCEL_CLICK_GUARD_MS = 400

/** How long the field takes to glide up into the search view. */
const SEARCH_FLIP_MS = 220

/** The search field's label and placeholder. */
const SEARCH_LABEL = 'Search products, booths or vendors'
const SEARCH_HINT_DOCKED = 'Products, booths or vendors'

/** The empty-results message, also spoken as the result count. */
export const NO_RESULTS = 'Nothing matched your search. Even the mimic checked twice.'

/** How many categories the empty results suggest. */
const SUGGESTED_CATEGORY_COUNT = 2

/** Phone widths dock the focused search field to the top; mirrors the 40rem rules in storefront.css. */
const PHONE_QUERY = '(max-width: 40rem)'

function subscribePhone(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(PHONE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const isPhoneWidth = () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches

/** Where focus goes after the next render, because the control that had it was replaced. */
type FocusTarget =
  | { kind: 'chip'; category: string }
  | { kind: 'search' }
  | { kind: 'categories' }
  | { kind: 'recent'; index: number }
  | { kind: 'count' }
  | { kind: 'heading' }

export interface EventHomeProps {
  /** The order control for the product sheet, wired at the route like the storefront's. */
  renderOrderControl?: RenderOrderControl
}

/** FR-01: the event home. Search, open orders, then ways to browse the loaded catalog. */
export function EventHome({ renderOrderControl }: EventHomeProps = {}) {
  const { eventSlug = '' } = useParams()
  const { state, reload } = useCatalog(eventSlug)
  // The open orders are read alongside the catalog, and the home waits for them a moment, so the
  // orders strip renders with the sections below it rather than pushing them down later. Only the
  // first visit waits: a return already has them (the strip remembers its last orders and refreshes).
  const [ordersPrimed, setOrdersPrimed] = useState(openOrdersSettled)
  useEffect(() => {
    let active = true
    const done = () => active && setOrdersPrimed(true)
    void primeOpenOrders().then(done)
    const id = window.setTimeout(done, ORDERS_WAIT_MS)
    return () => {
      active = false
      window.clearTimeout(id)
    }
  }, [])

  if (state.status === 'loading' || (state.status === 'ready' && !ordersPrimed)) return <EventHomeSkeleton />
  if (state.status === 'error') return <CatalogError refusal={state.refusal} onRetry={() => void reload()} />
  return <EventHomeLoaded catalog={state.catalog} fromCache={state.fromCache} onRetry={() => void reload()} renderOrderControl={renderOrderControl} />
}

/** Material's filter chip check, shown on the selected chip. */
function CheckIcon() {
  return (
    <svg className="chip__check" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

/** The name with each query word marked, so the reason for a match is visible at a glance. */
function Highlighted({ text, query }: { text: string; query: string }) {
  return highlightParts(text, query).map((part, i) =>
    part.match ? (
      <mark key={i} className="search-mark">
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  )
}

interface LoadedProps {
  catalog: EventCatalog
  fromCache: boolean
  /** Reloads the catalog, as pull to refresh does. */
  onRetry: () => void
  renderOrderControl?: RenderOrderControl
}

function EventHomeLoaded({ catalog, fromCache, onRetry, renderOrderControl }: LoadedProps) {
  // The filter lives in the URL (?q=&category=), so Back, swipe-back and reload all keep or undo it.
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const urlQuery = params.get('q') ?? ''
  const category = params.get('category')
  // The field keeps its own copy, so a keystroke never waits on the router.
  const [query, setQuery] = useState(urlQuery)
  // Queries this page wrote that the URL has not caught up with yet.
  const pendingQueries = useRef<string[]>([])
  const slug = catalog.event.slug
  const filters = readFilters(params)
  // A shelf's See all opens a filter on its own (?price=under-10), which is a search like a category.
  const searching = query.trim() !== '' || category !== null || narrowingLabels(filters).length > 0
  const matches = searching ? searchCatalog(catalog, query, category) : []
  const hits = applyFilters(matches, (h) => h.product, filters)
  // Booths the query names (a vendor with nothing listed, a booth code). A category or a product
  // filter is about products, so booths show only for a plain search.
  const boothHits = searching && category === null && narrowingLabels(filters).length === 0 ? searchBooths(catalog, query) : []
  const found = hits.length + boothHits.length
  // Only the filters emptied the list: the message names them, and Clear filters brings the matches back.
  const filteredOut = found === 0 && matches.length > 0
  const resultCount =
    found > 0
      ? `${found} ${found === 1 ? 'result' : 'results'}`
      : filteredOut
        ? `No results with ${narrowingLabels(filters).join(' and ')}.`
        : NO_RESULTS
  // A price sort orders products across booths, so the booth groups give way to a flat list with
  // the booth on every row while it is on.
  const groups = filters.sort === 'default' ? groupHitsByBooth(hits) : null
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtersChipRef = useRef<HTMLDivElement>(null)
  const sheetLink = useProductSheetLink()
  const isPhone = useSyncExternalStore(subscribePhone, isPhoneWidth, () => false)
  // Focus mode: on a phone the focused field docks to the top and shows results or recent searches.
  const [focusMode, setFocusMode] = useState(false)
  const [recents, setRecents] = useState(() => readRecentSearches(catalog.event.slug))
  // The phone search view: the field fixed at the top with Cancel, and nothing else of the home.
  const docked = isPhone && focusMode
  const showRecents = docked && !searching && recents.length > 0
  // Where the page was when the search view opened, so Cancel puts it back.
  const scrollBeforeSearch = useRef(0)
  // Ends Cancel's click guard early; leaving the screen must not leave a page-wide click blocker behind.
  const endClickGuard = useRef<() => void>(() => undefined)
  useEffect(() => () => endClickGuard.current(), [])

  // While the search view is open the tab bar and the cart bar step aside (home.css), as a native
  // search does; on iOS they would otherwise sit on the keyboard's accessory bar. The mark leaves with
  // the view, and with this screen, so the bars can never stay hidden.
  useEffect(() => {
    if (!docked) return
    const root = document.documentElement
    root.dataset.searchView = ''
    return () => {
      delete root.dataset.searchView
    }
  }, [docked])

  // The fixed search bar covers the top of the screen, and what sits above the view (the app bar's
  // height) differs by screen, so the view measures it: its first line starts just under the bar.
  useLayoutEffect(() => {
    const region = searchRegionRef.current
    const bar = region?.querySelector<HTMLElement>('.search')
    if (!region || !bar) return
    region.style.paddingTop = ''
    if (!docked) return
    // The view opens at the top of the page (an instant jump, nothing for reduced motion to honour),
    // before measuring, so the scroll it opened from is not counted into the gap.
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' })
    // Layout values only: the bar is fixed at the top, so its height is its bottom edge (its entrance
    // slide is a transform and does not count), and the region's place in the document does not
    // depend on when the engine applies the scroll.
    const regionTop = region.getBoundingClientRect().top + window.scrollY
    const gap = bar.offsetHeight + SEARCH_VIEW_GAP_PX - regionTop
    region.style.paddingTop = `${Math.max(0, gap)}px`
  })

  // Opening the view, the field glides from its place on the home to the top bar (FLIP): it is laid
  // out at the top at once, then drawn from where it was and eased up. Reduced motion: it is just there.
  const fieldFrom = useRef<number | null>(null)
  useLayoutEffect(() => {
    const from = fieldFrom.current
    fieldFrom.current = null
    const bar = searchRegionRef.current?.querySelector<HTMLElement>('.search')
    const field = bar?.querySelector<HTMLElement>('.search__field')
    if (!docked || from === null || !bar || !field || typeof bar.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const dy = from - field.getBoundingClientRect().top
    if (Math.abs(dy) < 1) return
    const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-ios').trim() || 'ease-out'
    bar.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: SEARCH_FLIP_MS, easing })
  }, [docked])
  const [announcement, setAnnouncement] = useState('')
  const categories = categoriesOf(catalog)
  const boothsById = new Map(catalog.booths.map((b) => [b.id, b]))

  const pendingFocus = useRef<FocusTarget | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const resultCountRef = useRef<HTMLParagraphElement>(null)
  // The home's lists rise in once per session, the first time they render (shell, index.css).
  const categoriesEntrance = useFirstEntrance('home:categories', true)
  const productsEntrance = useFirstEntrance('home:products', true)
  const chipsRef = useRef<HTMLDivElement>(null)
  const categoriesRef = useRef<HTMLHeadingElement>(null)
  const recentsRef = useRef<HTMLUListElement>(null)
  const searchRegionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    if (target.kind === 'search') searchRef.current?.focus()
    else if (target.kind === 'count') resultCountRef.current?.focus()
    else if (target.kind === 'heading') {
      const h1 = document.querySelector<HTMLHeadingElement>('.discover__header h1')
      if (h1) {
        h1.tabIndex = -1
        h1.focus({ preventScroll: true })
      }
    }
    else if (target.kind === 'categories') categoriesRef.current?.focus()
    else if (target.kind === 'recent') {
      const buttons = recentsRef.current?.querySelectorAll<HTMLButtonElement>('.recent__remove') ?? []
      const next = buttons[Math.min(target.index, buttons.length - 1)]
      if (next) focusQuietly(next)
      else searchRef.current?.focus()
    } else {
      const chip = Array.from(chipsRef.current?.querySelectorAll('button') ?? []).find(
        (b) => b.dataset.category === target.category,
      )
      if (chip) focusQuietly(chip)
    }
  })

  // A change the page did not make (Back, swipe-back, the Home tab) moves the field to the URL's query.
  useEffect(() => {
    const at = pendingQueries.current.indexOf(urlQuery)
    if (at >= 0) {
      pendingQueries.current.splice(0, at + 1)
      return
    }
    pendingQueries.current = []
    setQuery(urlQuery)
    // Back to the bare home with the field not focused leaves focus mode.
    if (urlQuery === '' && !searchRegionRef.current?.contains(document.activeElement)) setFocusMode(false)
  }, [location.key, urlQuery])

  // Back leaves the control that had focus (the header Back, a chip) unmounted: the page h1 takes it.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return
    const h1 = document.querySelector<HTMLHeadingElement>('main h1')
    if (!h1) return
    h1.tabIndex = -1
    // The shell has already restored this entry's scroll; a scrolling focus would undo it.
    h1.focus({ preventScroll: true })
  }, [location.key])

  useEffect(() => {
    const next = searching ? resultCount : ''
    const id = setTimeout(() => setAnnouncement(next), RESULT_ANNOUNCE_DELAY_MS)
    return () => clearTimeout(id)
  }, [searching, resultCount])

  const writeFilter = (q: string, c: string | null, replace: boolean, f: ProductFilters = filters) => {
    const next = new URLSearchParams()
    if (q !== '') next.set('q', q)
    if (c !== null) next.set('category', c)
    pendingQueries.current.push(q)
    setParams(writeFilters(next, f), { replace })
  }

  // Filter and sort changes replace the entry, as the storefront's category chips do, so a few taps
  // in the sheet do not each take a Back press.
  const changeFilters = (f: ProductFilters) => writeFilter(query, category, true, f)
  // In the search view focus goes back to the field, which keeps the view; elsewhere to the chip.
  const filtersReturnFocus = useCallback(
    () => (docked ? searchRef.current : filtersChipRef.current?.querySelector<HTMLElement>('.chip--filters') ?? null),
    [docked],
  )

  const changeQuery = (value: string) => {
    // The first character pushes one entry, so Back returns to the unfiltered home; the rest of the typing replaces it.
    const replace = query !== ''
    setQuery(value)
    writeFilter(value, category, replace)
  }

  const setCategory = (c: string | null) => writeFilter(query, c, false)

  const pickCategory = (c: string) => {
    pendingFocus.current = { kind: 'chip', category: c }
    setCategory(c)
  }

  const toggleChip = (c: string) => {
    const next = category === c ? null : c
    // Turning off the last filter brings the browse sections back, and this chip goes with them.
    if (next === null && query.trim() === '') pendingFocus.current = { kind: 'categories' }
    setCategory(next)
  }

  const clearSearch = () => {
    pendingFocus.current = { kind: 'search' }
    setQuery('')
    pendingQueries.current.push('')
    navigate(`/e/${slug}`)
  }

  // A search that found nothing is not worth offering again.
  const rememberQuery = () => {
    if (query.trim() !== '' && hits.length > 0) setRecents(addRecentSearch(slug, query))
  }

  // Opening a result leaves the search view; the results stay on the page behind the sheet.
  const openResult = () => {
    rememberQuery()
    setFocusMode(false)
  }

  // Enter runs no new search (results follow typing). Focus moves to the result count, which closes
  // the phone keyboard without dropping a keyboard user's focus to the page.
  const submitSearch = () => {
    rememberQuery()
    if (resultCountRef.current) resultCountRef.current.focus()
    else searchRef.current?.blur()
  }

  const clearField = () => {
    pendingFocus.current = { kind: 'search' }
    changeQuery('')
  }

  const pickRecent = (term: string) => {
    setQuery(term)
    writeFilter(term, category, false)
    setRecents(addRecentSearch(slug, term))
    pendingFocus.current = { kind: 'count' }
  }

  const forgetRecent = (term: string, index: number) => {
    pendingFocus.current = { kind: 'recent', index }
    setRecents(removeRecentSearch(slug, term))
  }

  const forgetAllRecents = () => {
    pendingFocus.current = { kind: 'search' }
    setRecents(clearRecentSearches(slug))
  }

  const suggestCategory = (c: string) => {
    pendingFocus.current = { kind: 'chip', category: c }
    setQuery('')
    writeFilter('', c, false)
  }

  const enterSearchView = () => {
    if (!focusMode) {
      scrollBeforeSearch.current = window.scrollY
      fieldFrom.current = searchRegionRef.current?.querySelector('.search__field')?.getBoundingClientRect().top ?? null
    }
    setFocusMode(true)
  }

  // Leaving the search view: only Cancel, Escape or opening a result do it (a tap on empty space only
  // closes the keyboard). The search is cleared and the page returns to where it was.
  const leaveSearchView = (focusAfter: 'field' | 'heading') => {
    const restoreTo = scrollBeforeSearch.current
    setFocusMode(false)
    setQuery('')
    if (query !== '' || category !== null) {
      pendingQueries.current.push('')
      navigate(`/e/${slug}`, { replace: true })
    }
    if (focusAfter === 'field') pendingFocus.current = { kind: 'search' }
    else {
      searchRef.current?.blur()
      pendingFocus.current = { kind: 'heading' }
    }
    requestAnimationFrame(() => window.scrollTo({ top: restoreTo, behavior: 'instant' }))
  }

  // Cancel: the finger that lifts off it must not activate the home card that reappears under it, so
  // clicks are swallowed until that tap has finished.
  const cancelSearch = () => {
    const swallow = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('click', swallow, true)
    const timer = setTimeout(() => endClickGuard.current(), CANCEL_CLICK_GUARD_MS)
    endClickGuard.current = () => {
      clearTimeout(timer)
      document.removeEventListener('click', swallow, true)
      endClickGuard.current = () => undefined
    }
    leaveSearchView('heading')
  }

  // Escape leaves the search view; focus stays in the field rather than falling to the page.
  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    leaveSearchView('field')
  }

  // Taps on these keep focus in the field, so focus mode does not end (and the layout jump) before the click lands.
  // Mousedown, not pointerdown: cancelling pointerdown makes WebKit drop the tap's click on touch,
  // while cancelling the mousedown that follows still keeps focus (and the keyboard) on the field.
  const keepFieldFocus = (e: MouseEvent) => e.preventDefault()

  const resultRow = ({ product, booth }: SearchHit, grouped: boolean) => {
    const snippet = descriptionSnippet(
      product.description,
      `${product.name} ${product.category} ${booth.vendorName}`,
      query,
    )
    return (
      <li key={product.id} className="result">
        <Link className="result__main" {...sheetLink(product.id)} onClick={openResult}>
          <ProductImage product={product} size="small" />
          <span className="result__text">
            <span className="result__name">
              <Highlighted text={product.name} query={query} />
            </span>
            {snippet && (
              <span className="result__snippet">
                <span className="visually-hidden">, </span>
                <Highlighted text={snippet} query={query} />
              </span>
            )}
            {!grouped && (
              <span className="result__vendor">
                <span className="visually-hidden">, </span>
                {booth.vendorName}
              </span>
            )}
            <span className="result__row">
              <span className="result__price">
                <span className="visually-hidden">, </span>
                {formatMoney(product.priceCents, catalog.event.currency)}
              </span>
              {stockState(product.availableQty) && <span className="visually-hidden">, </span>}
              <StockLine qty={product.availableQty} />
            </span>
          </span>
        </Link>
        {!grouped && (
          <Link className="booth-plate result__plate" to={`/e/${slug}/map?booth=${booth.id}`}>
            <span className="booth-plate__label">Booth </span>
            {booth.code}
            <span className="visually-hidden"> on the map</span>
          </Link>
        )}
      </li>
    )
  }

  const venue = catalog.event.venueName
  const productCount = (c: string) => catalog.products.filter((p) => p.category === c).length
  const coverFor = (c: string): Product | undefined => catalog.products.find((p) => p.category === c && p.imageUrl)

  return (
    <div
      className={`discover${searching ? ' discover--searching' : ''}${docked ? ' discover--docked' : ''}${showRecents ? ' discover--recents' : ''}`}
    >
      <EventBanner name={catalog.event.name} venue={venue} decorative />
      <header className="discover__header">
        <h1 className="visually-hidden">{catalog.event.name}</h1>
        {venue && (
          <p className="discover__venue visually-hidden">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
              <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
              <circle cx="12" cy="10" r="2.25" />
            </svg>
            {venue}
          </p>
        )}
        <SavedCopyNote show={fromCache} onRetry={onRetry} />
      </header>

      <div className="search-region" ref={searchRegionRef}>
        <form
          className="search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            submitSearch()
          }}
        >
          <div className="search__field">
            <svg className="search__icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
            <label htmlFor="search-input" className="visually-hidden">
              {SEARCH_LABEL}
            </label>
            <input
              ref={searchRef}
              id="search-input"
              className="search__input"
              type="search"
              enterKeyHint="search"
              // The docked field is narrower (Cancel beside it), so its hint drops the leading verb.
              placeholder={docked ? SEARCH_HINT_DOCKED : SEARCH_LABEL}
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
              onFocus={enterSearchView}
              onKeyDown={onSearchKeyDown}
              autoComplete="off"
            />
            {query !== '' && (
              <button
                type="button"
                className="search__clear"
                aria-label="Clear search text"
                onMouseDown={keepFieldFocus}
                onClick={clearField}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
          {docked && (
            <button type="button" className="search__cancel" onClick={cancelSearch}>
              Cancel
            </button>
          )}
        </form>

        {docked && !searching && (
          <p className="search-view__hint">Try a product, a series or a vendor name.</p>
        )}

        {showRecents && (
          <section className="recents" aria-labelledby="recent-searches">
            <div className="recents__head">
              <h2 id="recent-searches" className="recents__title">
                Recent
              </h2>
              <button type="button" className="recents__clear" onMouseDown={keepFieldFocus} onClick={forgetAllRecents}>
                Clear all<span className="visually-hidden"> recent searches</span>
              </button>
            </div>
            <ul className="recents__list" role="list" ref={recentsRef}>
              {recents.map((term, i) => (
                <li key={term} className="recent">
                  <button type="button" className="recent__term" onMouseDown={keepFieldFocus} onClick={() => pickRecent(term)}>
                    <svg className="recent__icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
                      <circle cx="12" cy="12" r="8" />
                      <path d="M12 8v4.5l3 2" />
                    </svg>
                    <span className="recent__text">{term}</span>
                  </button>
                  <button
                    type="button"
                    className="recent__remove"
                    aria-label={`Remove ${term} from recent searches`}
                    onMouseDown={keepFieldFocus}
                    onClick={() => forgetRecent(term, i)}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {docked && !searching && (
          <section className="search-view__categories" aria-labelledby="search-view-categories">
            <h2 id="search-view-categories" className="recents__title">
              Browse a category
            </h2>
            <div className="chips" role="group" aria-labelledby="search-view-categories">
              {categories.map((c) => (
                <button key={c} type="button" className="chip" onMouseDown={keepFieldFocus} onClick={() => {
                    writeFilter('', c, false)
                  }}>
                  {c}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Always mounted, outside the results, so only the count is spoken. */}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>

      <ActiveOrders eventId={catalog.event.id} booths={catalog.booths} />

      <FiltersSheet
        open={filtersOpen && searching}
        filters={filters}
        onChange={changeFilters}
        onClose={() => setFiltersOpen(false)}
        defaultSortLabel="Relevance"
        resultCount={hits.length}
        returnFocus={filtersReturnFocus}
      />

      {searching ? (
        <section aria-label="Search results" className="results-section">
          <div className="results-section__bar">
            <div className="chips" ref={chipsRef}>
              <span className="chips__lead" ref={filtersChipRef}>
                <FiltersChip filters={filters} expanded={filtersOpen} onOpen={() => setFiltersOpen(true)} onMouseDown={keepFieldFocus} />
              </span>
              <div className="chips__group" role="group" aria-label="Filter by category">
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="chip"
                    data-category={c}
                    aria-pressed={category === c}
                    onMouseDown={keepFieldFocus}
                    onClick={() => {
                      toggleChip(c)
                    }}
                  >
                    {category === c && <CheckIcon />}
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className={`results-section__head${found === 0 ? ' results-section__head--empty' : ''}`}>
            <p className="result-count" ref={resultCountRef} tabIndex={-1}>
              {resultCount}
            </p>
            {/* When only the filters emptied the list, the way out is clearing them, not the search. */}
            {filteredOut ? (
              <button
                type="button"
                className="button button--ghost"
                onMouseDown={keepFieldFocus}
                onClick={() => {
                  // The button goes with the empty state; in the search view the field keeps focus.
                  if (!docked) pendingFocus.current = { kind: 'count' }
                  changeFilters(NO_FILTERS)
                }}
              >
                Clear filters
              </button>
            ) : (
              <button type="button" className="button button--ghost" onClick={clearSearch}>
                Clear search
              </button>
            )}
          </div>
          {found === 0 && !filteredOut && (
            <div className="results-empty">
              <p id="results-empty-label" className="results-empty__label">
                Try a category
              </p>
              <div className="chips" role="group" aria-labelledby="results-empty-label">
                {topCategories(catalog, SUGGESTED_CATEGORY_COUNT, category).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="chip"
                    onClick={() => {
                      suggestCategory(c)
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
          {boothHits.length > 0 && (
            <section className="result-booths" aria-labelledby="result-booths">
              <h2 id="result-booths" className="result-group__name">
                Booths
              </h2>
              <ul className="directory" role="list">
                {boothHits.map((b) => (
                  <BoothListRow key={b.id} booth={b} eventSlug={slug} name={<Highlighted text={b.vendorName} query={query} />} />
                ))}
              </ul>
            </section>
          )}
          {groups ? (
            groups.map(({ booth, hits: groupHits }) => (
              <section key={booth.id} className="result-group" aria-labelledby={`result-group-${booth.id}`}>
                <div className="result-group__head">
                  <Link className="booth-plate" to={`/e/${slug}/map?booth=${booth.id}`}>
                    <span className="booth-plate__label">Booth </span>
                    {booth.code}
                    <span className="visually-hidden"> on the map</span>
                  </Link>
                  <h2 id={`result-group-${booth.id}`} className="result-group__name">
                    {booth.vendorName}
                  </h2>
                </div>
                <ul className="results" role="list">
                  {groupHits.map((hit) => resultRow(hit, true))}
                </ul>
              </section>
            ))
          ) : (
            <ul className="results" role="list">
              {hits.map((hit) => resultRow(hit, false))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <HomeHero products={featuredProducts(catalog.products)} boothsById={boothsById} currency={catalog.event.currency} />

          <section className="home-section" aria-labelledby="home-categories">
            <h2 id="home-categories" ref={categoriesRef} tabIndex={-1}>
              Browse by category
            </h2>
            <ul className="category-tiles" role="list" {...categoriesEntrance}>
              {categories.map((c) => {
                const cover = coverFor(c)
                return (
                  <li key={c}>
                    <button
                      type="button"
                      className="category-tile"
                      onClick={() => {
                        pickCategory(c)
                      }}
                    >
                      <span className="category-tile__image" aria-hidden="true">
                        {/* The tiles fill the first screen on a phone, and whichever photo paints largest (a
                            full-bleed one, measured: Tabletop) is its Largest Contentful Paint, so all of them load first. */}
                        {cover && <ProductImage product={cover} size="large" priority />}
                      </span>
                      <span className="category-tile__name">{c}</span>
                      <span className="category-tile__count">
                        {productCount(c)} {productCount(c) === 1 ? 'product' : 'products'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          {homeShelves(catalog).map((shelf) => (
            <ProductShelf key={shelf.id} shelf={shelf} boothsById={boothsById} currency={catalog.event.currency} eventSlug={slug} />
          ))}

          <section className="home-section" aria-labelledby="home-products">
            <h2 id="home-products">All products</h2>
            <ul className="product-grid" role="list" {...productsEntrance}>
              {soldOutLast(catalog.products).map((product, i) => {
                const booth = boothsById.get(product.boothId)
                if (!booth) return null
                return (
                  <li key={product.id}>
                    <HomeProductCard product={product} booth={booth} currency={catalog.event.currency} priority={i === 0} />
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}

      <ProductSheetHost catalog={catalog} renderOrderControl={renderOrderControl} />
    </div>
  )
}
