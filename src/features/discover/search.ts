import type { Booth, EventCatalog, Product } from '../../shared/types'

/**
 * Text folded for matching, with where each folded character came from in the original: accents
 * dropped (NFKD, then marks removed), lower case, and anything that is not a letter or digit (punctuation,
 * emoji) turned into a space. So "Dragón!" folds to "dragon " and still points at the right letters.
 */
export function foldText(text: string): { folded: string; start: number[]; end: number[] } {
  let folded = ''
  const start: number[] = []
  const end: number[] = []
  let at = 0
  for (const char of text) {
    const next = at + char.length
    const plain = char.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    for (const c of plain || ' ') {
      folded += /[\p{L}\p{N}]/u.test(c) ? c : ' '
      start.push(at)
      end.push(next)
    }
    at = next
  }
  return { folded, start, end }
}

/** The words of a query, folded like the text they are matched against; punctuation and emoji drop out. */
export function queryWords(query: string): string[] {
  return foldText(query).folded.split(' ').filter(Boolean)
}

export interface SearchHit {
  product: Product
  booth: Booth
}

/**
 * FR-04: every word of the query must appear in the product name, description,
 * category, or vendor name. Description is our addition to FR-04, so a series
 * named only there ("shaker charm in Attack on Titan colors") is still found. Runs in the
 * browser over the loaded catalog, so it also works offline (ARCHITECTURE.md,
 * "Search runs in the browser").
 */
export function searchCatalog(catalog: EventCatalog, query: string, category: string | null): SearchHit[] {
  const words = queryWords(query)
  // Only emoji or punctuation ("🐉", "!!") is a search for nothing we can match, not for everything.
  if (words.length === 0 && query.trim() !== '') return []
  const boothsById = new Map(catalog.booths.map((b) => [b.id, b]))
  const hits: SearchHit[] = []
  for (const product of catalog.products) {
    const booth = boothsById.get(product.boothId)
    if (!booth) continue
    if (category && product.category !== category) continue
    const haystack = foldText(`${product.name} ${product.description} ${product.category} ${booth.vendorName}`).folded
    if (words.every((w) => haystack.includes(w))) hits.push({ product, booth })
  }
  return hits.sort((a, b) => Number(b.product.availableQty > 0) - Number(a.product.availableQty > 0))
}

export function categoriesOf(catalog: EventCatalog): string[] {
  return [...new Set(catalog.products.map((p) => p.category))].sort()
}

/** Categories with the most products first, for the empty-results suggestions. */
export function topCategories(catalog: EventCatalog, count: number, exclude: string | null = null): string[] {
  const counts = new Map<string, number>()
  for (const p of catalog.products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
  return [...counts]
    .filter(([c]) => c !== exclude)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([c]) => c)
}

/** Characters of description kept before the first needed word; about twice as many follow it. */
const SNIPPET_LEAD = 24

/**
 * The reason for a match the visible fields cannot explain: when some query word appears only in
 * the description, an excerpt around the first such word, cut at word boundaries. Null when the
 * name, category or vendor already account for every word.
 */
export function descriptionSnippet(description: string, shownFields: string, query: string): string | null {
  const shown = foldText(shownFields).folded
  const fold = foldText(description)
  const needed = queryWords(query).filter((w) => !shown.includes(w) && fold.folded.includes(w))
  if (needed.length === 0) return null
  const at = fold.start[Math.min(...needed.map((w) => fold.folded.indexOf(w)))]
  let start = Math.max(0, at - SNIPPET_LEAD)
  let end = Math.min(description.length, at + 2 * SNIPPET_LEAD + needed[0].length)
  if (start > 0) {
    const space = description.indexOf(' ', start)
    if (space >= 0 && space < at) start = space + 1
  }
  if (end < description.length) {
    const space = description.lastIndexOf(' ', end)
    if (space > at) end = space
  }
  return `${start > 0 ? '...' : ''}${description.slice(start, end).trim()}${end < description.length ? '...' : ''}`
}

export interface TextPart {
  text: string
  match: boolean
}

/**
 * Splits text into matched and unmatched runs for every query word, case-insensitively.
 * Overlapping matches ("tit" and "titan") merge into one run, and so do matches separated only by
 * spaces, so "attack on titan" is marked as one phrase rather than three patches.
 */
export function highlightParts(text: string, query: string): TextPart[] {
  // Matched on the folded text, then mapped back, so "dragon" marks "Dragón" and a letter that changes
  // length when folded (the Turkish dotted capital I, a ligature) still marks the right characters.
  const { folded, start: from, end: to } = foldText(text)
  const ranges: Array<[number, number]> = []
  for (const word of queryWords(query)) {
    for (let at = folded.indexOf(word); at >= 0; at = folded.indexOf(word, at + 1)) ranges.push([from[at], to[at + word.length - 1]])
  }
  if (ranges.length === 0) return [{ text, match: false }]
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1]
    if (last && (start <= last[1] || text.slice(last[1], start).trim() === '')) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  const parts: TextPart[] = []
  let cursor = 0
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false })
    parts.push({ text: text.slice(start, end), match: true })
    cursor = end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false })
  return parts
}

export interface BoothGroup {
  booth: Booth
  hits: SearchHit[]
}

/**
 * Groups hits under their booth when any booth has more than one, keeping the
 * order of each booth's first hit; null means the flat list reads better.
 */
export function groupHitsByBooth(hits: SearchHit[]): BoothGroup[] | null {
  const groups = new Map<string, BoothGroup>()
  for (const hit of hits) {
    const group = groups.get(hit.booth.id)
    if (group) group.hits.push(hit)
    else groups.set(hit.booth.id, { booth: hit.booth, hits: [hit] })
  }
  const list = [...groups.values()]
  return list.some((g) => g.hits.length > 1) ? list : null
}
