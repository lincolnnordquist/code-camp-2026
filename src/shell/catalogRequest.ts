import { getEventCatalog } from '../shared/api'
import type { EventCatalog, Product } from '../shared/types'

type CatalogResponse = ReturnType<typeof getEventCatalog>

/**
 * How long a successful answer is shared after it arrives. A lazily loaded screen mounts a moment
 * after the header's request has finished, still on the same navigation; a few seconds keeps that
 * one request without ever holding stock or booth data for long.
 */
const SHARE_ANSWER_MS = 3000

/** The request per event slug, with when its successful answer arrived (null while it is out). */
const recent = new Map<string, { request: CatalogResponse; answeredAt: number | null }>()

/**
 * The last good catalog per event this page life, for showing at once on a screen opened again (the
 * home after a storefront, an order after the wallet) while that screen's own request refreshes it.
 * It is never handed out as an answer: past SHARE_ANSWER_MS every caller still asks the server, so
 * stock is only as old as the refresh in flight. One entry per event opened, so it stays small.
 */
const lastGood = new Map<string, EventCatalog>()

/**
 * The event catalog, shared by every caller asking for the same event at about the same time: the
 * header's event name, the screen's catalog and the order screens' booth details then cost one set
 * of requests, not one each. A request still out is shared, and so is a successful answer for
 * SHARE_ANSWER_MS after it arrives; a failure is never kept. A reload the person asked for
 * (`fresh`) always asks the server, and later callers then share that request.
 */
export function requestEventCatalog(slug: string, { fresh = false }: { fresh?: boolean } = {}): CatalogResponse {
  dropExpiredAnswers()
  const entry = recent.get(slug)
  if (entry && !fresh) return entry.request
  const request = getEventCatalog(slug)
  const mine = { request, answeredAt: null as number | null }
  recent.set(slug, mine)
  request.then(
    (result) => {
      mine.answeredAt = Date.now()
      // A refusal (the event is gone) keeps the copy for the screen to replace with its own error.
      if (result.ok) lastGood.set(slug, result.value)
    },
    () => {
      if (recent.get(slug) === mine) recent.delete(slug)
    },
  )
  return request
}

/** Answers past SHARE_ANSWER_MS are let go, so a page left open does not hold every event it ever showed. */
function dropExpiredAnswers() {
  const now = Date.now()
  for (const [slug, entry] of recent) {
    if (entry.answeredAt !== null && now - entry.answeredAt >= SHARE_ANSWER_MS) recent.delete(slug)
  }
}

/** The event's last good catalog this page life, or null before one has arrived. */
export function lastEventCatalog(slug: string): EventCatalog | null {
  return lastGood.get(slug) ?? null
}

/** A product from any event's last good catalog this page life, or null. */
export function lastCatalogProduct(productId: string): Product | null {
  for (const catalog of lastGood.values()) {
    const product = catalog.products.find((p) => p.id === productId)
    if (product) return product
  }
  return null
}

/** The events whose request or recent answer is held now; for tests. */
export function heldCatalogSlugs(): string[] {
  return [...recent.keys()]
}
