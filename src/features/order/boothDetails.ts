import { useEffect, useSyncExternalStore } from 'react'
import { requestEventCatalog } from '../../shell/catalogRequest'
import type { Booth, Order, Product } from '../../shared/types'
import { orderEventSlug } from './orderExtras'

/** What the order page shows about a booth beyond the order's own booth code and name. */
export type BoothDetails = Pick<Booth, 'pickupInstructions' | 'logoUrl'> & {
  /** The booth's banner, for the pass's top strip; missing in copies saved before it was kept. */
  bannerUrl?: string
}

/**
 * The order carries its booth's code and name, but not its pickup instructions
 * or logo, so those come from the event's catalog. A saved copy keeps them
 * readable offline with the saved orders (FR-26).
 */
const DETAILS_KEY = 'orders.boothDetails'

function readSaved(): Record<string, BoothDetails> {
  try {
    const raw = localStorage.getItem(DETAILS_KEY)
    const saved: unknown = raw ? JSON.parse(raw) : null
    return typeof saved === 'object' && saved !== null && !Array.isArray(saved) ? (saved as Record<string, BoothDetails>) : {}
  } catch {
    return {}
  }
}

let details = readSaved()
/** The products of every event read on this page load, by id, for the order page's item photos. */
let products: Record<string, Product> = {}
const listeners = new Set<() => void>()
/** Events whose catalog was read, or is being read, on this page load. */
const requested = new Set<string>()
/** The booths each event's catalog listed when read on this page load; a booth missing here has left the event. */
let listed: Record<string, ReadonlySet<string>> = {}

function save(next: Record<string, BoothDetails>) {
  details = next
  try {
    localStorage.setItem(DETAILS_KEY, JSON.stringify(next))
  } catch {
    // A full or blocked storage only costs the offline copy.
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function loadEvent(slug: string) {
  if (requested.has(slug)) return
  requested.add(slug)
  requestEventCatalog(slug)
    .then((r) => {
      // An unknown event stays requested: asking again would get the same answer.
      if (!r.ok) return
      const next = { ...details }
      for (const b of r.value.booths) next[b.id] = { pickupInstructions: b.pickupInstructions, logoUrl: b.logoUrl, bannerUrl: b.bannerUrl }
      products = { ...products, ...Object.fromEntries(r.value.products.map((pr) => [pr.id, pr])) }
      listed = { ...listed, [slug]: new Set(r.value.booths.map((b) => b.id)) }
      save(next)
    })
    // A network failure is asked again when the device comes back online.
    .catch(() => requested.delete(slug))
}

/**
 * The order's booth details, once its event's catalog has been read on this
 * device. `null` until then; the order page leaves them out meanwhile.
 */
export function useBoothDetails(order: Order): BoothDetails | null {
  const current = useSyncExternalStore(subscribe, () => details)
  const slug = orderEventSlug(order)

  useEffect(() => {
    if (!slug) return
    const load = () => loadEvent(slug)
    load()
    window.addEventListener('online', load)
    return () => window.removeEventListener('online', load)
  }, [slug])

  return current[order.boothId] ?? null
}

/**
 * True once the event's catalog has been read here and no longer lists the order's booth, so the
 * map and the storefront have nothing to show for it. False until then (the links stay). Reads the
 * catalog that useBoothDetails asks for.
 */
export function useBoothGone(order: Order): boolean {
  const booths = useSyncExternalStore(subscribe, () => listed)[orderEventSlug(order) ?? '']
  return booths !== undefined && !booths.has(order.boothId)
}

/** A product of the order's event, once its catalog has been read here (useBoothDetails reads it); else null. */
export function useCatalogProduct(productId: string): Product | null {
  return useSyncExternalStore(subscribe, () => products)[productId] ?? null
}
