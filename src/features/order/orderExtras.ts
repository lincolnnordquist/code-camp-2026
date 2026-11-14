/**
 * The order screens need the order's event slug, for the map link and to load
 * the booth's catalog entry, but the shared contract gives the order its
 * `eventId` and `getEventCatalog` is keyed by slug. The accessor reads
 * `order.eventSlug` first, so it picks the field up as soon as Data & vendor
 * adds it (remove the rest then). Until then it uses the slug the shell names
 * for each event it loads, kept on this device so a reload or a later visit to
 * /orders still has it. A private link opened on another device has none.
 */
import type { Order } from '../../shared/types'

const SLUGS_KEY = 'orders.eventSlugs'

function readSlugs(): Record<string, string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SLUGS_KEY) ?? '{}')
    return typeof saved === 'object' && saved !== null && !Array.isArray(saved) ? (saved as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** Names an event's slug for its orders. The shell calls it for each event catalog it loads. */
export function provideOrderEventSlug(eventId: string, slug: string) {
  const slugs = readSlugs()
  if (slugs[eventId] === slug) return
  try {
    localStorage.setItem(SLUGS_KEY, JSON.stringify({ ...slugs, [eventId]: slug }))
  } catch {
    // Without storage the order page goes without the map link and pickup instructions.
  }
}

/** Remove when Order.eventSlug exists. `null` when neither the order nor the shell names the event. */
export function orderEventSlug(order: Order): string | null {
  return (order as Order & { eventSlug?: string | null }).eventSlug ?? readSlugs()[order.eventId] ?? null
}

/** The order's booth storefront, or null when its event is not known on this device (a private link opened cold). */
export function storefrontPath(order: Order): string | null {
  const slug = orderEventSlug(order)
  return slug && order.boothId ? `/e/${slug}/booth/${order.boothId}` : null
}
