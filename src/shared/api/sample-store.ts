// Sample data used until the real Supabase calls replace each stub. Held in memory, so a
// page refresh resets it. Delete this file once nothing imports it.
import type { EventCatalog, Order } from "../types";
import { publicAssetUrl } from "./storage";

export const catalog: EventCatalog = {
  event: {
    id: "evt-1",
    slug: "code-camp-2026",
    name: "Code Camp 2026",
    venueName: "Demo Convention Center",
    currency: "USD",
    floorPlanUrl: null,
    reservationHoldMinutes: 120,
  },
  booths: [
    {
      id: "booth-a",
      vendorName: "Pixel Prints",
      logoUrl: publicAssetUrl("vendors/pixel-prints/logo.svg"),
      slogan: "Art you can hold",
      bannerUrl: publicAssetUrl("vendors/pixel-prints/banner.svg"),
      code: "A1",
      mode: "reservation",
      orderingPaused: false,
      mapX: 0.2,
      mapY: 0.3,
      pickupInstructions: "Show your code at the front table.",
    },
    {
      id: "booth-b",
      vendorName: "Moon Ceramics",
      logoUrl: publicAssetUrl("vendors/moon-ceramics/logo.svg"),
      slogan: "Handmade, one at a time",
      bannerUrl: publicAssetUrl("vendors/moon-ceramics/banner.svg"),
      code: "B4",
      mode: "prepay",
      orderingPaused: false,
      mapX: 0.6,
      mapY: 0.4,
      pickupInstructions: "Pickup is at the side counter.",
    },
    {
      id: "booth-c",
      vendorName: "Old Maps Co",
      logoUrl: publicAssetUrl("vendors/old-maps-co/logo.svg"),
      slogan: "Every place has a story",
      bannerUrl: publicAssetUrl("vendors/old-maps-co/banner.svg"),
      code: "C2",
      mode: "discovery",
      orderingPaused: false,
      mapX: 0.8,
      mapY: 0.7,
      pickupInstructions: "",
    },
  ],
  products: [
    {
      id: "p-1",
      boothId: "booth-a",
      name: "Dragon Print",
      category: "Art",
      description:
        "A signed print of a dragon over the mountains. One of a kind.",
      imageUrl: publicAssetUrl("products/pixel-prints/dragon-print.svg"),
      priceCents: 2500,
      availableQty: 1,
      maxPerOrder: 2,
    },
    {
      id: "p-2",
      boothId: "booth-a",
      name: "Sticker Pack",
      category: "Stickers",
      description: "Five weatherproof vinyl stickers.",
      imageUrl: publicAssetUrl("products/pixel-prints/sticker-pack.svg"),
      priceCents: 800,
      availableQty: 20,
      maxPerOrder: 5,
    },
    {
      id: "p-3",
      boothId: "booth-b",
      name: "Mug",
      category: "Ceramics",
      description: "A hand-thrown stoneware mug with a glazed handle.",
      imageUrl: publicAssetUrl("products/moon-ceramics/mug.svg"),
      priceCents: 3200,
      availableQty: 6,
      maxPerOrder: 2,
    },
    {
      id: "p-4",
      boothId: "booth-c",
      name: "City Map Poster",
      category: "Art",
      description: "A reproduction of an old city map, printed on heavy paper.",
      imageUrl: publicAssetUrl("products/old-maps-co/city-map-poster.svg"),
      priceCents: 1800,
      availableQty: 0,
      maxPerOrder: 1,
    },
  ],
};

export const orders: Order[] = [];
// Maps a request id to the order it created, so a repeated request returns the first one.
export const ordersByRequestId = new Map<string, Order>();

type Listener = () => void;
const listeners = new Set<Listener>();
export function onChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notifyChange(): void {
  listeners.forEach((listener) => listener());
}
