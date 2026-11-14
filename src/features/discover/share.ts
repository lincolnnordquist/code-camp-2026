/** What the page shares: the system share sheet's title and line, and the link itself. */
export interface ShareData {
  title: string
  text: string
  url: string
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

/**
 * The system share sheet where the browser has one; otherwise, or when it refuses, the link is
 * copied for the page to say so. Closing the share sheet without choosing is not an error.
 */
export async function shareOrCopy(data: ShareData): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function' && (navigator.canShare?.(data) ?? true)) {
    try {
      await navigator.share(data)
      return 'shared'
    } catch (e) {
      // Read by name: the error can come from another realm, where instanceof DOMException fails.
      if ((e as { name?: unknown } | null)?.name === 'AbortError') return 'cancelled'
      // NotAllowedError (no gesture, a policy) and the rest: copying still gets the link out.
    }
  }
  try {
    await navigator.clipboard.writeText(data.url)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** The link to a product: its booth's storefront with the product's sheet open over it. */
export function productShareUrl(origin: string, eventSlug: string, boothId: string, productId: string): string {
  return `${origin}/e/${encodeURIComponent(eventSlug)}/booth/${encodeURIComponent(boothId)}?product=${encodeURIComponent(productId)}`
}

/** The link to a booth's storefront, without the filters this visitor happened to pick. */
export function storefrontShareUrl(origin: string, eventSlug: string, boothId: string): string {
  return `${origin}/e/${encodeURIComponent(eventSlug)}/booth/${encodeURIComponent(boothId)}`
}
