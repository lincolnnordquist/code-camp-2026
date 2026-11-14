import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Event } from '../../shared/types'
import { CODE_CAMP_LAYOUT } from './codeCampHall'

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
