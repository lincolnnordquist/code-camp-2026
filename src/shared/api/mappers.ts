// Turns what the database returns into the app's types. Rows come in snake_case and
// function results in camelCase; the screens only ever see the types.
import type {
  Booth,
  BoothMode,
  Event,
  Order,
  OrderItem,
  OrderRefundStatus,
  OrderStatus,
  OrderType,
  Product,
} from "../types";
import { publicAssetUrl } from "./storage";

// An order as the order functions return it.
export type OrderPayload = {
  orderId: string;
  boothId: string;
  eventId: string;
  boothCode: string;
  boothName: string;
  type: OrderType;
  status: OrderStatus;
  pickupCode: string;
  holdEndsAt: string | null;
  totalCents: number;
  currency: string;
  createdAt: string;
  collectedAt: string | null;
  cancelReason: string | null;
  refundStatus: OrderRefundStatus;
  refundedCents: number;
  items: OrderItem[];
};

export function orderFromPayload(payload: OrderPayload): Order {
  return {
    id: payload.orderId,
    boothId: payload.boothId,
    eventId: payload.eventId,
    boothCode: payload.boothCode,
    boothName: payload.boothName,
    type: payload.type,
    status: payload.status,
    items: payload.items,
    totalCents: payload.totalCents,
    currency: payload.currency,
    pickupCode: payload.pickupCode,
    holdEndsAt: payload.holdEndsAt,
    createdAt: payload.createdAt,
    collectedAt: payload.collectedAt,
    cancelReason: payload.cancelReason,
    refundStatus: payload.refundStatus,
    refundedCents: payload.refundedCents,
  };
}

// A row of the order_details view.
export type OrderRow = {
  id: string;
  booth_id: string;
  event_id: string;
  booth_code: string;
  booth_name: string;
  type: OrderType;
  status: OrderStatus;
  total_cents: number;
  currency: string;
  pickup_code: string;
  hold_ends_at: string | null;
  created_at: string;
  collected_at: string | null;
  cancel_reason: string | null;
  refund_status: OrderRefundStatus;
  refunded_cents: number;
};

// A row of order_items.
export type ItemRow = {
  order_id: string;
  product_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
};

export function orderFromRow(row: OrderRow, items: ItemRow[]): Order {
  return {
    id: row.id,
    boothId: row.booth_id,
    eventId: row.event_id,
    boothCode: row.booth_code,
    boothName: row.booth_name,
    type: row.type,
    status: row.status,
    items: items
      .filter((item) => item.order_id === row.id)
      .map((item) => ({
        productId: item.product_id,
        name: item.name,
        quantity: item.quantity,
        unitPriceCents: item.unit_price_cents,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    totalCents: row.total_cents,
    currency: row.currency,
    pickupCode: row.pickup_code,
    holdEndsAt: row.hold_ends_at,
    createdAt: row.created_at,
    collectedAt: row.collected_at,
    cancelReason: row.cancel_reason,
    refundStatus: row.refund_status,
    refundedCents: row.refunded_cents,
  };
}

export type EventRow = {
  id: string;
  slug: string;
  name: string;
  venue_name: string;
  currency: string;
  floor_plan_url: string | null;
  reservation_hold_minutes: number;
};

export function eventFromRow(row: EventRow): Event {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    venueName: row.venue_name,
    currency: row.currency,
    floorPlanUrl: row.floor_plan_url,
    reservationHoldMinutes: row.reservation_hold_minutes,
  };
}

export type BoothRow = {
  id: string;
  code: string;
  mode: BoothMode;
  ordering_paused: boolean;
  map_x: number | string;
  map_y: number | string;
  pickup_instructions: string;
  vendors: {
    name: string;
    slogan: string;
    logo_path: string;
    banner_path: string;
  };
};

export function boothFromRow(row: BoothRow): Booth {
  return {
    id: row.id,
    vendorName: row.vendors.name,
    logoUrl: publicAssetUrl(row.vendors.logo_path),
    slogan: row.vendors.slogan,
    bannerUrl: publicAssetUrl(row.vendors.banner_path),
    code: row.code,
    mode: row.mode,
    orderingPaused: row.ordering_paused,
    mapX: Number(row.map_x),
    mapY: Number(row.map_y),
    pickupInstructions: row.pickup_instructions,
  };
}

// The product columns every read asks for, in one place so two reads cannot drift apart.
export const PRODUCT_COLUMNS =
  "id, booth_id, name, category, description, image_path, image_paths, price_cents, available_qty, max_per_order";

export type ProductRow = {
  id: string;
  booth_id: string;
  name: string;
  category: string;
  description: string;
  image_path: string;
  image_paths: string[];
  price_cents: number;
  available_qty: number;
  max_per_order: number;
};

export function productFromRow(row: ProductRow): Product {
  return {
    id: row.id,
    boothId: row.booth_id,
    name: row.name,
    category: row.category,
    description: row.description,
    imageUrl: publicAssetUrl(row.image_path),
    ...(row.image_paths.length > 0 && {
      images: [row.image_path, ...row.image_paths].map(publicAssetUrl),
    }),
    priceCents: row.price_cents,
    availableQty: row.available_qty,
    maxPerOrder: row.max_per_order,
  };
}
