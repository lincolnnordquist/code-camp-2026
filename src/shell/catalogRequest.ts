import { getEventCatalog } from '../shared/api'

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
 * The event catalog, shared by every caller asking for the same event at about the same time: the
 * header's event name, the screen's catalog and the order screens' booth details then cost one set
 * of requests, not one each. A request still out is shared, and so is a successful answer for
 * SHARE_ANSWER_MS after it arrives; a failure is never kept. A reload the person asked for
 * (`fresh`) always asks the server, and later callers then share that request.
 */
export function requestEventCatalog(slug: string, { fresh = false }: { fresh?: boolean } = {}): CatalogResponse {
  const entry = recent.get(slug)
  if (entry && !fresh && (entry.answeredAt === null || Date.now() - entry.answeredAt < SHARE_ANSWER_MS)) return entry.request
  const request = getEventCatalog(slug)
  const mine = { request, answeredAt: null as number | null }
  recent.set(slug, mine)
  request.then(
    () => {
      mine.answeredAt = Date.now()
    },
    () => {
      if (recent.get(slug) === mine) recent.delete(slug)
    },
  )
  return request
}
