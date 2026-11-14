/**
 * Recent search terms, kept on this device only and never sent anywhere (an
 * addition beyond SPEC FR-04 for the team to confirm). One list per event,
 * newest first.
 */
export const RECENT_SEARCH_LIMIT = 5

const keyFor = (eventSlug: string) => `discover.recentSearches.${eventSlug}`

export function readRecentSearches(eventSlug: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(keyFor(eventSlug)) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is string => typeof t === 'string' && t.trim() !== '').slice(0, RECENT_SEARCH_LIMIT)
  } catch {
    return []
  }
}

function write(eventSlug: string, terms: string[]): string[] {
  try {
    localStorage.setItem(keyFor(eventSlug), JSON.stringify(terms))
  } catch {
    // Storage full or blocked (private mode): the list lives for this page only.
  }
  return terms
}

/** Moves the term to the front; the same words in another case count as one term. */
export function addRecentSearch(eventSlug: string, term: string): string[] {
  const clean = term.trim().replace(/\s+/g, ' ')
  const current = readRecentSearches(eventSlug)
  if (clean === '') return current
  const rest = current.filter((t) => t.toLowerCase() !== clean.toLowerCase())
  return write(eventSlug, [clean, ...rest].slice(0, RECENT_SEARCH_LIMIT))
}

export function removeRecentSearch(eventSlug: string, term: string): string[] {
  return write(
    eventSlug,
    readRecentSearches(eventSlug).filter((t) => t !== term),
  )
}

export function clearRecentSearches(eventSlug: string): string[] {
  return write(eventSlug, [])
}
