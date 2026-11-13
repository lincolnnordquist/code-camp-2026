// Sample data used until the real Supabase calls replace each stub. Held in memory, so a
// page refresh resets it. Delete this file once nothing imports it.
import type { EventCatalog, Order } from "../types";

export const catalog: EventCatalog = {
  event: {
    id: "evt-1",
    slug: "demo",
    name: "Demo Convention 2026",
    currency: "USD",
    floorPlanUrl: "/floor-plan.png",
    reservationHoldMinutes: 120,
  },
  booths: [
    {
      id: "booth-a",
      vendorName: "Pixel Prints",
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
      priceCents: 2500,
      availableQty: 1,
      maxPerOrder: 2,
    },
    {
      id: "p-2",
      boothId: "booth-a",
      name: "Sticker Pack",
      category: "Stickers",
      priceCents: 800,
      availableQty: 20,
      maxPerOrder: 5,
    },
    {
      id: "p-3",
      boothId: "booth-b",
      name: "Mug",
      category: "Ceramics",
      priceCents: 3200,
      availableQty: 6,
      maxPerOrder: 2,
    },
    {
      id: "p-4",
      boothId: "booth-c",
      name: "City Map Poster",
      category: "Art",
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
