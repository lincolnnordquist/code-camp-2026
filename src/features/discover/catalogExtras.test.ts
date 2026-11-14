import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Event } from '../../shared/types'
import { CODE_CAMP_LAYOUT } from './codeCampHall'
import { rowTop } from './catalogExtras'

const event: Event = {
  id: 'e',
  slug: 'e',
  name: 'E',
  venueName: 'Hall',
  currency: 'USD',
  floorPlanUrl: '/plan.svg',
  reservationHoldMinutes: 120,
}

async function fresh() {
  vi.resetModules()
  return import('./catalogExtras')
}

beforeEach(() => vi.resetModules())

describe('eventFloorLayout (remove the extras lookup when Event.floorLayout is in the contract)', () => {
  it('without the field or a provided layout, the map gets none and uses the image', async () => {
    const x = await fresh()
    expect(x.eventFloorLayout(event)).toBeUndefined()
  })

  it('reads a layout the host provides, by event id', async () => {
    const x = await fresh()
    x.provideCatalogExtras({ events: { e: { floorLayout: CODE_CAMP_LAYOUT } } })
    expect(x.eventFloorLayout(event)).toEqual(CODE_CAMP_LAYOUT)
  })

  it('a layout on the event wins over the provided one, so the accessor picks up the real field', async () => {
    const x = await fresh()
    x.provideCatalogExtras({ events: { e: { floorLayout: { ...CODE_CAMP_LAYOUT, tablesPerRow: 3 } } } })
    expect(x.eventFloorLayout({ ...event, ...{ floorLayout: CODE_CAMP_LAYOUT } })).toEqual(CODE_CAMP_LAYOUT)
  })

  it('ignores a layout it cannot draw, from either source, so the map falls back to the image', async () => {
    const x = await fresh()
    x.provideCatalogExtras({ events: { e: { floorLayout: { ...CODE_CAMP_LAYOUT, columns: [] } } } })
    expect(x.eventFloorLayout(event)).toBeUndefined()
    expect(x.eventFloorLayout({ ...event, ...{ floorLayout: { ...CODE_CAMP_LAYOUT, walls: [] } } })).toBeUndefined()
  })
})

describe('stand-in hall until events.floor_layout exists (STAND_IN_FLOOR_LAYOUTS)', () => {
  const codeCamp: Event = { ...event, id: 'e0000000-0000-0000-0000-000000000001', slug: 'code-camp-2026' }

  it('draws the Code Camp hall for the Code Camp event when it brings no layout', async () => {
    const x = await fresh()
    expect(x.eventFloorLayout(codeCamp)).toEqual(CODE_CAMP_LAYOUT)
  })

  it('a real layout from the API wins over the stand-in', async () => {
    const x = await fresh()
    const real = { ...CODE_CAMP_LAYOUT, rows: 3 }
    expect(x.eventFloorLayout({ ...codeCamp, ...{ floorLayout: real } })).toEqual(real)
  })

  it('a layout from the API it cannot draw still leaves the stand-in hall for the Code Camp event', async () => {
    const x = await fresh()
    expect(x.eventFloorLayout({ ...codeCamp, ...{ floorLayout: { width: 'wide' } } })).toEqual(CODE_CAMP_LAYOUT)
  })

  it.each(['another-event', 'constructor', '__proto__', ''])('an event with slug "%s" stays on the plain plan', async (slug) => {
    const x = await fresh()
    expect(x.eventFloorLayout({ ...event, slug })).toBeUndefined()
  })
})

describe('the seeded booths sit on the stand-in hall tables', () => {
  // supabase/seed.sql places each booth (map_x, map_y) at its table centre, rounded to 4 decimals.
  const seed = readFileSync(new URL('../../../supabase/seed.sql', import.meta.url), 'utf8')
  const booths = [...seed.matchAll(/'([A-I])([1-7])', '[a-z]+', (?:true|false), ([\d.]+), ([\d.]+),/g)].map((m) => ({
    code: `${m[1]}${m[2]}`,
    column: m[1],
    row: Number(m[2]),
    mapX: Number(m[3]),
    mapY: Number(m[4]),
  }))

  it('finds the seeded booths', () => {
    expect(booths.map((b) => b.code)).toEqual(['A3', 'B6', 'C2', 'D5', 'E4', 'I7', 'H6'])
  })

  it.each(booths.map((b) => [b.code, b] as const))('%s: its map point is its drawn table centre', (_code, b) => {
    const L = CODE_CAMP_LAYOUT
    const centreX = (L.firstTable.x + L.columns.indexOf(b.column) * L.pitch.x + L.tableSize.width / 2) / L.width
    const centreY = (rowTop(L, b.row) + L.tableSize.height / 2) / L.height
    expect(Math.abs(b.mapX - centreX)).toBeLessThanOrEqual(0.00005)
    expect(Math.abs(b.mapY - centreY)).toBeLessThanOrEqual(0.00005)
  })
})
