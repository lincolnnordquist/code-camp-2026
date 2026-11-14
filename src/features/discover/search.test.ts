import { describe, expect, it } from 'vitest'
import type { Booth, EventCatalog, Product } from '../../shared/types'

import { categoriesOf, descriptionSnippet, highlightParts, searchCatalog } from './search'

const booth = (id: string, vendorName: string): Booth => ({
  id,
  code: id.toUpperCase(),
  vendorName,
  slogan: '',
  logoUrl: '',
  bannerUrl: '',
  mode: 'reservation',
  orderingPaused: false,
  pickupInstructions: '',
  mapX: 0.05, mapY: 0.05,
})

const product = (
  id: string,
  boothId: string,
  name: string,
  category: string,
  availableQty = 5,
  description = '',
): Product => ({
  id,
  boothId,
  name,
  description,
  category,
  priceCents: 1000,
  availableQty,
  maxPerOrder: 2,
  imageUrl: '',
})

const catalog: EventCatalog = {
  event: {
    id: 'e',
    slug: 'e',
    name: 'E',
    venueName: 'Hall',
    currency: 'USD',
    floorPlanUrl: '',
    reservationHoldMinutes: 120,
  },
  booths: [booth('a1', 'Wall Rose Goods'), booth('b2', 'Critical Hit Dice'), booth('c3', 'Scout Figures')],
  products: [
    product('sold-out-titan', 'a1', 'Attack on Titan Tee', 'Apparel', 0),
    product('titan-patch', 'a1', 'Attack on Titan Patch', 'Accessories'),
    product('dice', 'b2', 'Obsidian Dice Set', 'Tabletop'),
    product('figure', 'c3', 'Levi Figure', 'Figures', 1, 'Limited figure, Attack on Titan.'),
    product('orphan', 'missing-booth', 'Attack on Titan Ghost', 'Apparel'),
  ],
}

const ids = (query: string, category: string | null = null) =>
  searchCatalog(catalog, query, category).map((h) => h.product.id)

describe('searchCatalog', () => {
  it('requires every word, in any field, ignoring case', () => {
    expect(ids('TITAN patch')).toEqual(['titan-patch'])
    expect(ids('titan dice')).toEqual([])
  })

  it('matches on vendor name and category, not only product name', () => {
    expect(ids('critical')).toEqual(['dice'])
    expect(ids('tabletop')).toEqual(['dice'])
  })

  it('matches a series named only in the description', () => {
    expect(ids('attack on titan')).toEqual(['titan-patch', 'figure', 'sold-out-titan'])
  })

  it('applies the category filter on top of the query', () => {
    expect(ids('titan', 'Apparel')).toEqual(['sold-out-titan'])
    expect(ids('', 'Tabletop')).toEqual(['dice'])
  })

  it('lists in-stock items before sold-out ones', () => {
    expect(ids('titan')).toEqual(['titan-patch', 'figure', 'sold-out-titan'])
  })

  it('skips products whose booth is not in the catalog', () => {
    expect(ids('ghost')).toEqual([])
  })

  it('returns sorted unique categories', () => {
    expect(categoriesOf(catalog)).toEqual(['Accessories', 'Apparel', 'Figures', 'Tabletop'])
  })
})

describe('descriptionSnippet', () => {
  const description = 'Limited 7 inch figure from the final season of Attack on Titan, with a display base and two hands.'

  it('is null when the visible fields explain every word', () => {
    expect(descriptionSnippet(description, 'Titan Figure Figures Scout Regiment', 'titan figure')).toBeNull()
  })

  it('excerpts around the first word only the description holds, cut at word boundaries', () => {
    const snippet = descriptionSnippet(description, 'Levi Ackerman Figure Figures Scout Regiment', 'titan')
    expect(snippet).toBe('...season of Attack on Titan, with a display base and two hands.')
  })

  it('keeps a short description whole', () => {
    expect(descriptionSnippet('Attack on Titan colours.', 'Shaker Charm', 'titan')).toBe('Attack on Titan colours.')
  })

  it('is null for an empty query or a description without the word', () => {
    expect(descriptionSnippet(description, 'Levi', '')).toBeNull()
    expect(descriptionSnippet(description, 'Levi', 'dragon')).toBeNull()
  })
})

describe('highlightParts', () => {
  it('marks matched words separated only by spaces as one run', () => {
    expect(highlightParts('Attack on Titan Hoodie', 'attack on titan')).toEqual([
      { text: 'Attack on Titan', match: true },
      { text: ' Hoodie', match: false },
    ])
  })

  it('keeps matches apart when other text lies between them', () => {
    expect(highlightParts('Titan Wall Poster', 'titan poster')).toEqual([
      { text: 'Titan', match: true },
      { text: ' Wall ', match: false },
      { text: 'Poster', match: true },
    ])
  })
})

describe('folding punctuation, emoji and accents (edge-case sweep)', () => {
  const dragonCatalog: EventCatalog = {
    ...catalog,
    products: [product('bag', 'b2', 'Black Dragon Dice Bag', 'Tabletop'), product('egg', 'b2', 'Dragón Egg (Ñandú edition)', 'Tabletop')],
  }
  const found = (query: string) => searchCatalog(dragonCatalog, query, null).map((h) => h.product.id)

  it.each([
    ['Dragon!', ['bag', 'egg']],
    ['dragón', ['bag', 'egg']],
    ['🐉 dragon', ['bag', 'egg']],
    ['DRAGON, bag', ['bag']],
    ['nandu', ['egg']],
    ['ñandú', ['egg']],
    ['egg)', ['egg']],
  ])('"%s" finds %j', (query, expected) => {
    expect(found(query).sort()).toEqual([...expected].sort())
  })

  it('a query of only emoji or punctuation finds nothing rather than everything', () => {
    expect(found('🐉')).toEqual([])
    expect(found('!!')).toEqual([])
  })

  it('marks the accented original from a plain query, and a plain original from an accented one', () => {
    expect(highlightParts('Dragón Egg', 'dragon')).toEqual([
      { text: 'Dragón', match: true },
      { text: ' Egg', match: false },
    ])
    expect(highlightParts('Black Dragon Dice Bag', 'dragón!')).toEqual([
      { text: 'Black ', match: false },
      { text: 'Dragon', match: true },
      { text: ' Dice Bag', match: false },
    ])
  })

  it('maps marks back over letters that change length when folded', () => {
    expect(highlightParts('İstanbul ﬁgure', 'figure')).toEqual([
      { text: 'İstanbul ', match: false },
      { text: 'ﬁgure', match: true },
    ])
  })

  it('finds a description-only accented match for the snippet', () => {
    expect(descriptionSnippet('Comes with a dragón stand.', 'Egg Tabletop Dice', 'dragon')).toBe('Comes with a dragón stand.')
  })
})
