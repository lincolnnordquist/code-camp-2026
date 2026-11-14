// The app shell: router, header, tab bar and the attendee routes.
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
// The screens are imported from their own files, not the features' index files, which import every
// screen and so would keep the on-demand ones in the first download. The index files' stylesheets
// come in here instead, in the same order as before, so the cascade is unchanged.
import './features/discover/discover.css'
import { BoothsSkeleton, MapSkeleton, StorefrontSkeleton } from './features/discover/DiscoverSkeletons'
import { EventHome } from './features/discover/EventHome'
import './features/order/order.css'
import { AddToCart } from './features/order/AddToCart'
import { CartLink } from './features/order/CartLink'
import { useCart } from './features/order/cartStore'
import { OpenOrderCount } from './features/order/OpenOrderCount'
import { provideOrderEventSlug } from './features/order/orderExtras'
import { MyOrdersSkeleton, OrderSkeleton } from './features/order/OrderSkeletons'
import { getEventCatalog } from './shared/api'
import { useOnlineStatus } from './shared/live'
import { refusalLabels } from './shared/ui/labels'
import { previousEntryPath, useGoBack, useViewTransitions } from './shell/navTransitions'
import { usePullToRefresh, type PullPhase } from './shell/pullToRefresh'
import { backLabelOf, hasBack as hasBackFrom, hasInlineBack, headerTitleOf, isCartFlow } from './shell/routes'
import { ScreenErrorBoundary } from './shell/ScreenErrorBoundary'
import { registerRouteChunk, retryChunk } from './shell/routeChunks'
import { useScrollRestoration } from './shell/scrollRestoration'
import { SkeletonGroup } from './shell/Skeleton'
import { useSwipeBack } from './shell/swipeBack'

/** A screen's code that did not download (offline before the service worker stored it). */
class RouteLoadError extends Error {}

/** Every on-demand screen's download, so they can all be fetched once the first screen is up. */
const routePreloads: Array<() => Promise<unknown>> = []

/**
 * A screen whose code downloads on demand, so the first screen does not wait for it. Once its
 * code is here it renders directly rather than through React.lazy, so a navigation commits the
 * real screen at once (and the view transition captures it), not a Suspense fallback first.
 */
function lazyRoute<M, P extends object>(
  patterns: readonly string[],
  chunkName: string,
  load: () => Promise<M>,
  pick: (module: M) => ComponentType<P>,
) {
  let Loaded: ComponentType<P> | null = null
  let pending: Promise<ComponentType<P>> | null = null
  let attempts = 0
  const preload = () =>
    (pending ??= (attempts++ === 0 ? load() : retryChunk(load, chunkName, attempts)).then(
      (module) => (Loaded = pick(module)),
      (error: unknown) => {
        // Forgotten, so the next ask (Try again, a tap) downloads it afresh.
        pending = null
        throw new RouteLoadError('The screen did not load', { cause: error })
      },
    ))
  routePreloads.push(preload)
  registerRouteChunk(patterns, { loaded: () => Loaded !== null, preload })
  const Suspending = lazy(() => preload().then((Screen) => ({ default: Screen })))
  return function LazyRoute(props: P) {
    return Loaded ? <Loaded {...props} /> : <Suspending {...props} />
  }
}

const MapPage = lazyRoute(['/e/:eventSlug/map'], 'MapPage', () => import('./features/discover/MapPage'), (m) => m.MapPage)
const BoothsPage = lazyRoute(['/e/:eventSlug/booths'], 'BoothsPage', () => import('./features/discover/BoothsPage'), (m) => m.BoothsPage)
const Storefront = lazyRoute(['/e/:eventSlug/booth/:boothId'], 'Storefront', () => import('./features/discover/Storefront'), (m) => m.Storefront)
const CartPage = lazyRoute(['/e/:eventSlug/cart'], 'CartPage', () => import('./features/order/CartPage'), (m) => m.CartPage)
const CheckoutPage = lazyRoute(['/e/:eventSlug/cart/checkout'], 'CheckoutPage', () => import('./features/order/CheckoutPage'), (m) => m.CheckoutPage)
const MyOrders = lazyRoute(['/orders'], 'MyOrders', () => import('./features/order/MyOrders'), (m) => m.MyOrders)
const OrderPage = lazyRoute(['/orders/:orderId'], 'OrderPage', () => import('./features/order/OrderPage'), (m) => m.OrderPage)
const OrderByTokenPage = lazyRoute(['/o/:token'], 'OrderPage', () => import('./features/order/OrderPage'), (m) => m.OrderByTokenPage)

/**
 * How long after the page's load event the other screens' code waits. Lazy photos do not hold the
 * load event, so without this the downloads would compete with the first screen's photos.
 */
const PRELOAD_DELAY_MS = 3_000
/** How long the browser may then stay busy before the code is fetched anyway. */
const PRELOAD_IDLE_TIMEOUT_MS = 2_000

/**
 * Fetches every on-demand screen once the first screen is up and the browser is idle, so later
 * taps open at once instead of waiting on the network.
 */
function usePreloadRoutes() {
  useEffect(() => {
    let delay = 0
    let idle = 0
    const run = () => routePreloads.forEach((preload) => void preload().catch(() => undefined))
    const whenIdle = () => {
      // Older Safari has no requestIdleCallback.
      if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(run, { timeout: PRELOAD_IDLE_TIMEOUT_MS })
      else run()
    }
    const schedule = () => {
      delay = window.setTimeout(whenIdle, PRELOAD_DELAY_MS)
    }
    if (document.readyState === 'complete') schedule()
    else window.addEventListener('load', schedule, { once: true })
    return () => {
      window.removeEventListener('load', schedule)
      window.clearTimeout(delay)
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idle)
    }
  }, [])
}

/**
 * Catches a screen whose code did not download and offers Try again, like a screen whose data did
 * not load. Any other error is not this boundary's to explain, so it is thrown on. A new path
 * clears it.
 */
interface RouteLoadBoundaryProps {
  pathname: string
  children: ReactNode
}

interface RouteLoadBoundaryState {
  pathname: string
  error: unknown
  retrying: boolean
}

class RouteLoadBoundary extends Component<RouteLoadBoundaryProps, RouteLoadBoundaryState> {
  state: RouteLoadBoundaryState = { pathname: this.props.pathname, error: null, retrying: false }

  static getDerivedStateFromProps(props: RouteLoadBoundaryProps, state: RouteLoadBoundaryState) {
    return props.pathname === state.pathname ? null : { pathname: props.pathname, error: null, retrying: false }
  }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (!(error instanceof RouteLoadError)) throw error
    return (
      <div className="screen-state">
        <h1 className="screen-state__message">{refusalLabels.network}</h1>
        <button
          type="button"
          className="button"
          aria-disabled={this.state.retrying}
          onClick={() => {
            if (this.state.retrying) return
            this.setState({ retrying: true })
            void Promise.allSettled(routePreloads.map((preload) => preload())).then(() => this.setState({ error: null, retrying: false }))
          }}
        >
          Try again
        </button>
      </div>
    )
  }
}

/** A screen still downloading, with no placeholders of its own: shown, like them, after 150 ms. */
function ScreenLoading({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label}>{null}</SkeletonGroup>
  )
}

// The seeded event (supabase/seed.sql). The shared API has no event list yet, so `/` opens this one.
const DEMO_EVENT_SLUG = 'code-camp-2026'
/** The app's name: the tab title's suffix, and the header's when no event is loaded (an order link opened cold). */
const PRODUCT_NAME = 'DibSpot'
/** The shell's own copy of each event's name, so the header shows it at once on the next visit. */
const EVENT_NAME_KEY = 'shell.eventName.'
/** The most recently loaded event's name, for pages outside any event (orders, the Square return, not found). */
const LAST_EVENT_NAME_KEY = 'shell.lastEventName'

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * The header and title name the event being browsed: the loaded event's name
 * on /e/:slug, the last loaded one elsewhere (orders), else the product name.
 */
/** The event's name, or null while it is still loading on an event screen with none saved yet. */
function useEventName(): string | null {
  const { pathname } = useLocation()
  const slug = pathname.match(/^\/e\/([^/]+)/)?.[1] ?? null
  const [loaded, setLoaded] = useState<{ slug: string; name: string } | null>(null)
  // The slug whose load ended without a name (offline, unknown event); only then the product name shows.
  const [unnamed, setUnnamed] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let active = true
    getEventCatalog(slug)
      .then((r) => {
        if (!active) return
        if (!r.ok) return setUnnamed(slug)
        setLoaded({ slug, name: r.value.event.name })
        // Orders carry only their event id; the order page needs the slug for its map link and booth details.
        provideOrderEventSlug(r.value.event.id, slug)
        try {
          localStorage.setItem(EVENT_NAME_KEY + slug, r.value.event.name)
          localStorage.setItem(LAST_EVENT_NAME_KEY, r.value.event.name)
        } catch {
          // Without storage the name still shows once this load finishes.
        }
      })
      // Offline keeps the saved name, or the product name.
      .catch(() => active && setUnnamed(slug))
    return () => {
      active = false
    }
  }, [slug])

  if (!slug) return loaded?.name ?? readStored(LAST_EVENT_NAME_KEY) ?? PRODUCT_NAME
  if (loaded?.slug === slug) return loaded.name
  // An event this browser has never loaded (or an unknown slug) is not named after a different event,
  // and on a cold load the header stays blank until the name arrives rather than flashing the product name.
  return readStored(EVENT_NAME_KEY + slug) ?? (unnamed === slug ? PRODUCT_NAME : null)
}

/**
 * Every page renders one h1. The tab title follows it, and after an in-app
 * navigation focus moves to it, so screen readers hear the new page. Pages
 * that load data render their h1 later, so this waits for it.
 */
function useRouteHeading(siteName: string) {
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  // The path focus was last handled for. Survives StrictMode's effect re-run, which a first-render flag does not.
  const handledPath = useRef<string | null>(null)
  const [heading, setHeading] = useState('')

  // The h1 text can change without a route change (the map's selected booth).
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const syncTitle = () => {
      const text = main.querySelector('h1')?.textContent?.trim()
      setHeading(text ?? '')
      // "<screen> | DibSpot"; a screen with no h1 yet is titled with the app's name alone.
      const next = text && text !== siteName ? `${text} | ${siteName}` : siteName
      if (document.title !== next) document.title = next
    }
    syncTitle()
    const observer = new MutationObserver(syncTitle)
    observer.observe(main, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [siteName])

  useEffect(() => {
    const previous = handledPath.current
    handledPath.current = pathname
    // The first page load keeps the browser's own reading start.
    if (previous === null || previous === pathname) return
    const main = mainRef.current
    if (!main) return
    const focusHeading = () => {
      const h1 = main.querySelector('h1')
      if (!h1) return false
      h1.tabIndex = -1
      // The shell already placed the scroll: the top for a new screen, the saved spot on Back,
      // the product for a #id link. Focus must not move it.
      h1.focus({ preventScroll: true })
      return true
    }
    if (focusHeading()) return
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect()
    })
    observer.observe(main, { childList: true, subtree: true })
    return () => observer.disconnect()
    // Keyed on the path only: a query change on the same page (the map's booth) keeps focus where it is.
  }, [pathname])

  return { mainRef, heading }
}

const ICON_PROPS = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

const TAB_ICONS: Record<string, ReactNode> = {
  home: (
    <svg {...ICON_PROPS}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </svg>
  ),
  map: (
    <svg {...ICON_PROPS}>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  ),
  booths: (
    <svg {...ICON_PROPS}>
      <rect x="4" y="4" width="16" height="9" rx="1" />
      <path d="M12 13v7M8 20h8" />
    </svg>
  ),
  orders: (
    <svg {...ICON_PROPS}>
      <path d="M4 6h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4z" />
      <path d="M14 6v12" strokeDasharray="2 2" />
    </svg>
  ),
}

/* Filled versions for the selected destination, as Material 3 and iOS both mark it. Inner lines
   (folds, perforation) are cut in the indicator's colour so they stay visible on the fill. */
const TAB_ICONS_SELECTED: Record<string, ReactNode> = {
  home: (
    <svg {...ICON_PROPS}>
      <path d="M12 5l7 5.5V20H5V10.5z" fill="currentColor" />
      <path d="M3 11l9-7 9 7" />
    </svg>
  ),
  map: (
    <svg {...ICON_PROPS}>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" fill="currentColor" />
      <path className="tab-bar__cut" d="M9 5v13M15 7v13" strokeWidth={1.5} />
    </svg>
  ),
  booths: (
    <svg {...ICON_PROPS}>
      <rect x="4" y="4" width="16" height="9" rx="1" fill="currentColor" />
      <path d="M12 13v7M8 20h8" />
    </svg>
  ),
  orders: (
    <svg {...ICON_PROPS}>
      <path d="M4 6h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4z" fill="currentColor" />
      <path className="tab-bar__cut" d="M14 7v10" strokeWidth={1.5} strokeDasharray="2 2" />
    </svg>
  ),
}

interface Tab {
  key: string
  label: string
  to: string
  /** The tab stays lit on the screens drilled into from it. */
  inSection: (path: string) => boolean
}

function tabsFor(slug: string): Tab[] {
  const home = `/e/${slug}`
  return [
    {
      key: 'home',
      label: 'Home',
      to: home,
      inSection: (p) => p === home || p.startsWith(`${home}/booth/`) || p.startsWith(`${home}/cart`),
    },
    { key: 'map', label: 'Map', to: `${home}/map`, inSection: (p) => p === `${home}/map` },
    { key: 'booths', label: 'Booths', to: `${home}/booths`, inSection: (p) => p === `${home}/booths` },
    {
      key: 'orders',
      label: 'Orders',
      to: '/orders',
      inSection: (p) => p === '/orders' || p.startsWith('/orders/') || p.startsWith('/o/'),
    },
  ]
}

function TabBar() {
  const { pathname } = useLocation()
  const slug = pathname.match(/^\/e\/([^/]+)/)?.[1] ?? DEMO_EVENT_SLUG
  return (
    <nav className="tab-bar" aria-label="Main">
      <ul className="tab-bar__list" role="list">
        {tabsFor(slug).map((tab) => {
          const selected = tab.inSection(pathname)
          return (
            <li key={tab.key}>
              <Link
                className={`tab-bar__link${selected ? ' is-active' : ''}`}
                to={tab.to}
                aria-current={pathname === tab.to ? 'page' : undefined}
              >
                {(selected ? TAB_ICONS_SELECTED : TAB_ICONS)[tab.key]}
                <span className="tab-bar__label">
                  <span className="tab-bar__label-text">{tab.label}</span>
                  {tab.key === 'orders' && <OpenOrderCount />}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * Large titles: the page h1 sits big under the header, and once it scrolls
 * under the header a small copy shows there. The copy is hidden from screen
 * readers, so the page keeps one h1.
 */
/**
 * The offline banner sits under the header and over the page, so a page whose media runs up behind
 * the header (the storefront banner, --app-header-block) also runs up behind it. Its height, margin
 * included, goes into --offline-banner-block: 0 while it is empty.
 */
function useOfflineBannerBlock(bannerRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const banner = bannerRef.current
    if (!banner) return
    const root = document.documentElement
    const measure = () => {
      const block = banner.offsetHeight + parseFloat(getComputedStyle(banner).marginTop || '0')
      root.style.setProperty('--offline-banner-block', `${block}px`)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(banner)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--offline-banner-block')
    }
  }, [bannerRef])
}

/**
 * A page that starts with media (the storefront banner) asks for the over-media header by putting
 * data-header="over-media" on its root: transparent at rest with Back on a frosted chip, and the
 * banner runs up behind it. Read before paint, so the header never flashes its plain look first.
 */
function useOverMediaHeader(mainRef: React.RefObject<HTMLElement | null>) {
  const [overMedia, setOverMedia] = useState(false)
  useLayoutEffect(() => {
    const main = mainRef.current
    if (!main) return
    const check = () => setOverMedia(main.querySelector('[data-header="over-media"]') !== null)
    check()
    const observer = new MutationObserver(check)
    observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-header'] })
    return () => observer.disconnect()
  }, [mainRef])
  return overMedia
}

/** How far the title group must come back out from under the header before the large title returns. */
const COLLAPSE_HYSTERESIS_PX = 8

function useCollapsedTitle(mainRef: React.RefObject<HTMLElement | null>) {
  const [title, setTitle] = useState<string | null>(null)
  // Scrolled at all, collapsed or not: the inline Back takes a chip once content can pass under it.
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    let h1: HTMLHeadingElement | null = null
    let block: HTMLElement | null = null
    let frame = 0
    // Measured on every check rather than once (WebKit's IntersectionObserver applied a negative root
    // margin late). The line is the header box's bottom: on a tab root that is the safe area, since the
    // row there floats over the page only once collapsed, and the h1 rests inside that row's area.
    // Collapsed only while the page is really scrolled: at the top (and so during a pull, its refresh
    // hold and any rubber-band overscroll, which all happen at scroll 0) the title is the page's own.
    // A few pixels of hysteresis keep it from flickering at the line.
    let collapsed = false
    const check = () => {
      frame = 0
      setScrolled(window.scrollY > 0)
      const header = document.querySelector('.app-header')
      if (!h1 || !block || !header || window.scrollY <= 0) {
        collapsed = false
        return setTitle(null)
      }
      const gap = block.getBoundingClientRect().bottom - header.getBoundingClientRect().bottom
      collapsed = collapsed ? gap <= COLLAPSE_HYSTERESIS_PX : gap <= 0
      setTitle(collapsed ? (h1.textContent ?? '') : null)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check)
    }
    const bind = () => {
      const next = main.querySelector('h1')
      if (next === h1) return
      h1 = next
      // A title with its own introductory group (the event name and its venue in a <header>) collapses
      // only once the whole group has gone under the header, so the subtitle is never left behind.
      const group = h1?.parentElement
      block = group && group !== main && group.tagName === 'HEADER' ? group : h1
      check()
    }
    bind()
    const mo = new MutationObserver(bind)
    mo.observe(main, { childList: true, subtree: true })
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      mo.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [mainRef])
  return { title, scrolled }
}

/**
 * Back lives in the header, which never scrolls, so it is one tap away however
 * far down a storefront or order the attendee is.
 */
function HeaderBack({ goBack, label }: { goBack: () => void; label: string }) {
  return (
    <button type="button" className="app-header__back" aria-label={label} onClick={goBack}>
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        <path d="M19 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

/**
 * The pull-to-refresh spinner, pinned under the header and uncovered as the
 * content stretches down. usePullToRefresh moves it directly, frame by frame.
 * Decorative: the status line announces the refresh.
 */
function PullIndicator({ phase, indicatorRef }: { phase: PullPhase; indicatorRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="pull-refresh" ref={indicatorRef} data-phase={phase} aria-hidden="true">
      <span className="pull-refresh__slot">
        <span className="pull-refresh__spinner" />
      </span>
    </div>
  )
}

function Shell({ children }: { children: ReactNode }) {
  const online = useOnlineStatus()
  const eventName = useEventName()
  const { pathname, search } = useLocation()
  // The tab title is the screen's h1 and the app's name ("Booths | DibSpot"); the header names the event.
  const { mainRef, heading } = useRouteHeading(PRODUCT_NAME)
  const { title: collapsedTitle, scrolled } = useCollapsedTitle(mainRef)
  const overMedia = useOverMediaHeader(mainRef)
  const offlineBannerRef = useRef<HTMLParagraphElement>(null)
  useOfflineBannerBlock(offlineBannerRef)
  useViewTransitions()
  useScrollRestoration()
  const goBack = useGoBack()
  const hasBack = hasBackFrom(pathname, search)
  const inlineBack = hasInlineBack(pathname, search)
  const routeTitle = headerTitleOf(pathname, useCart()?.boothMode)
  useSwipeBack(mainRef, hasBack, () => goBack('swipe'))
  const pullIndicatorRef = useRef<HTMLDivElement>(null)
  const pull = usePullToRefresh(mainRef, pullIndicatorRef)
  return (
    <>
      {/* On a tab root (no Back) the page h1 is the only title: the header is just the safe area until the h1 scrolls away. */}
      <header
        className={`app-header${hasBack && !inlineBack ? '' : ' app-header--root'}${inlineBack ? ' app-header--inline-back' : ''}${overMedia ? ' app-header--over-media' : ''}${collapsedTitle ? ' is-collapsed' : ''}${scrolled ? ' is-scrolled' : ''}${heading === eventName ? ' is-name-in-page' : ''}`}
      >
        <div className={`app-header__inner${hasBack ? ' app-header__inner--back' : ''}`}>
          {hasBack && <HeaderBack goBack={() => goBack()} label={backLabelOf(pathname, undefined, previousEntryPath())} />}
          {/* The Home tab links home, so the header is a label: the screen's own title or the event
              wordmark, and the page title once its h1 scrolls away. */}
          {/* On the event home the wordmark repeats the h1, so a screen reader hears the name once,
              and it shows only once the h1 has scrolled away. */}
          <div className="app-header__titles">
            <p className="wordmark" aria-hidden={heading === eventName ? true : undefined}>
              {routeTitle ?? eventName}
            </p>
            <p className="app-header__title" aria-hidden="true">
              {collapsedTitle}
            </p>
          </div>
        </div>
      </header>
      <PullIndicator phase={pull.phase} indicatorRef={pullIndicatorRef} />
      <p className="visually-hidden" role="status">
        {pull.announcement}
      </p>
      {/* Always mounted, so the message is announced when it fills in. */}
      <p className="offline-banner" role="status" ref={offlineBannerRef}>
        {!online && (
          <>
            <svg {...ICON_PROPS}>
              <path d="M2 2l20 20" />
              <path d="M8.5 16.5a5 5 0 017 0M5 12.9a10 10 0 015.2-2.8M19 12.9a10 10 0 00-2.6-1.8M2 8.8a15 15 0 014.2-2.6M22 8.8A15 15 0 0010.7 5" />
              <path d="M12 20h.01" />
            </svg>
            You are offline. You can still browse what was loaded. Ordering is paused.
          </>
        )}
      </p>
      {/* The order screens start right under the top app bar, as in design/order-page. */}
      <main ref={mainRef} className={overMedia ? 'main--under-header' : routeTitle ? 'main--flush' : inlineBack ? 'main--inline-back' : undefined}>
        <ScreenErrorBoundary pathname={pathname}>
          <RouteLoadBoundary pathname={pathname}>{children}</RouteLoadBoundary>
        </ScreenErrorBoundary>
      </main>
      {/* Sticky at the end of the page, so it sits on the screen's bottom edge and the page reserves its real height. */}
      <div className="bottom-bars">
        <CartLink />
        {/* The cart and checkout are a focused flow, as drawn: header Back, no tab bar. */}
        {!isCartFlow(pathname) && <TabBar />}
      </div>
    </>
  )
}

export default function App() {
  usePreloadRoutes()
  return (
    // Route updates commit synchronously, so a view transition captures the new screen, not the old one twice.
    <BrowserRouter useTransitions={false}>
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to={`/e/${DEMO_EVENT_SLUG}`} replace />} />
          <Route path="/e/:eventSlug" element={<EventHome renderOrderControl={(args) => <AddToCart {...args} />} />} />
          {/* The other screens download on demand; each waits behind its own loading placeholders. */}
          <Route
            path="/e/:eventSlug/map"
            element={
              <Suspense fallback={<MapSkeleton />}>
                <MapPage />
              </Suspense>
            }
          />
          <Route
            path="/e/:eventSlug/booths"
            element={
              <Suspense fallback={<BoothsSkeleton />}>
                <BoothsPage />
              </Suspense>
            }
          />
          <Route
            path="/e/:eventSlug/booth/:boothId"
            element={
              <Suspense fallback={<StorefrontSkeleton />}>
                <Storefront renderOrderControl={(args) => <AddToCart {...args} />} />
              </Suspense>
            }
          />
          <Route
            path="/e/:eventSlug/cart"
            element={
              <Suspense fallback={<ScreenLoading label="Loading your cart..." />}>
                <CartPage />
              </Suspense>
            }
          />
          <Route
            path="/e/:eventSlug/cart/checkout"
            element={
              <Suspense fallback={<ScreenLoading label="Loading checkout..." />}>
                <CheckoutPage />
              </Suspense>
            }
          />
          <Route
            path="/orders"
            element={
              <Suspense fallback={<MyOrdersSkeleton />}>
                <MyOrders />
              </Suspense>
            }
          />
          <Route
            path="/orders/:orderId"
            element={
              <Suspense fallback={<OrderSkeleton />}>
                <OrderPage />
              </Suspense>
            }
          />
          <Route
            path="/o/:token"
            element={
              <Suspense fallback={<OrderSkeleton />}>
                <OrderByTokenPage />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={
              <div className="screen-state">
                <h1 className="screen-state__message">Page not found.</h1>
              </div>
            }
          />
        </Routes>
      </Shell>
    </BrowserRouter>
  )
}
