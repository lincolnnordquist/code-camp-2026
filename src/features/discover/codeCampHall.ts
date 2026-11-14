/**
 * The Code Camp hall: its 63 tables, nine columns lettered A to I from left to
 * right and seven rows numbered 1 (the back row, by the kitchen) to 7 (the front row, by the
 * stage), and the sample booths at their tables. H6 is the team's own table, listed as the booth
 * "Snag": discovery mode with no products, so it never takes orders. The map tests draw from it, and a host app can seed its catalog with it.
 * The real hall comes from the event row (floor_layout) and the booth rows.
 */
import type { Booth, Event, EventCatalog } from '../../shared/types'
import { publicAssetUrl } from '../../shared/api/storage'
import type { FloorLayout } from './catalogExtras'
import { CODE_CAMP_LAYOUT } from './codeCampLayout'

// The team's placeholder branding (supabase/seed-assets/placeholders); a host app may show its own per vendor.
const LOGO_PLACEHOLDER = publicAssetUrl('placeholders/logo.svg')
const BANNER_PLACEHOLDER = publicAssetUrl('placeholders/banner.svg')

export { CODE_CAMP_LAYOUT }

export const CODE_CAMP_BOOTHS: Booth[] = [
  {
    id: 'b-titan',
    vendorName: 'Wall Rose Goods',
    slogan: 'Anime apparel and patches',
    logoUrl: LOGO_PLACEHOLDER,
    bannerUrl: BANNER_PLACEHOLDER,
    code: 'A3',
    mode: 'reservation',
    orderingPaused: false,
    mapX: 0.1,
    mapY: 0.58452,
    pickupInstructions: 'Show your code at the front table. Pay by card or cash.',
  },
  {
    id: 'b-pixel',
    vendorName: 'Pixel Forge Prints',
    slogan: 'Art prints and posters',
    logoUrl: LOGO_PLACEHOLDER,
    bannerUrl: BANNER_PLACEHOLDER,
    code: 'B6',
    mode: 'reservation',
    orderingPaused: false,
    mapX: 0.2,
    mapY: 0.32024,
    pickupInstructions: 'Pickup shelf on the left side of the booth.',
  },
  {
    id: 'b-dice',
    vendorName: 'Critical Hit Dice',
    slogan: 'Dice sets and tabletop gear',
    logoUrl: LOGO_PLACEHOLDER,
    bannerUrl: BANNER_PLACEHOLDER,
    code: 'C2',
    mode: 'prepay',
    orderingPaused: false,
    mapX: 0.3,
    mapY: 0.67262,
    pickupInstructions: 'Prepaid orders at the blue counter.',
  },
  {
    id: 'b-plush',
    vendorName: 'Soft Kaiju Plush',
    slogan: 'Handmade plush monsters',
    logoUrl: LOGO_PLACEHOLDER,
    bannerUrl: BANNER_PLACEHOLDER,
    code: 'D5',
    mode: 'reservation',
    orderingPaused: true,
    mapX: 0.4,
    mapY: 0.40833,
    pickupInstructions: 'Ask any staff member wearing green.',
  },
  {
    id: 'b-figs',
    vendorName: 'Scout Regiment Figures',
    slogan: 'Figures and collectibles',
    logoUrl: LOGO_PLACEHOLDER,
    bannerUrl: BANNER_PLACEHOLDER,
    code: 'E4',
    mode: 'reservation',
    orderingPaused: false,
    mapX: 0.5,
    mapY: 0.49643,
    pickupInstructions: 'Pickup window at the back of the booth.',
  },
  {
    id: 'b-artist',
    vendorName: 'Inkwell Artist Alley',
    slogan: 'Commissions and sketches',
    logoUrl: LOGO_PLACEHOLDER,
    bannerUrl: BANNER_PLACEHOLDER,
    code: 'I7',
    mode: 'discovery',
    orderingPaused: false,
    mapX: 0.9,
    mapY: 0.23214,
    pickupInstructions: 'Walk up only.',
  },
  {
    id: 'b-snag',
    vendorName: 'Snag',
    slogan: 'The team behind this app',
    logoUrl: LOGO_PLACEHOLDER,
    bannerUrl: BANNER_PLACEHOLDER,
    code: 'H6',
    mode: 'discovery',
    orderingPaused: false,
    mapX: 0.8,
    mapY: 0.32024,
    pickupInstructions: 'Come say hi.',
  },
]

/**
 * A catalog for the hall with no products. The event also carries the drawn
 * layout, which the contract lacks yet and `eventFloorLayout` reads first.
 */
export function codeCampCatalog(): EventCatalog {
  const event: Event & { floorLayout: FloorLayout } = {
    id: 'evt-1',
    slug: 'code-camp-con',
    name: 'Code Camp Con 2026',
    venueName: 'Vasion Headquarters',
    currency: 'USD',
    floorPlanUrl: '/floorplan-codecamp.svg?v=3',
    reservationHoldMinutes: 120,
    floorLayout: CODE_CAMP_LAYOUT,
  }
  return structuredClone({ event, booths: CODE_CAMP_BOOTHS, products: [] })
}
