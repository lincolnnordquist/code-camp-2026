// The shared contract between screens and src/shared/api. Changes go through the Data & vendor role.
// Money is always integer cents with a currency code.

export type BoothMode = "prepay" | "reservation" | "discovery";
export type OrderType = "reservation" | "prepaid";
export type OrderStatus =
  | "pending_payment"
  | "confirmed"
  | "ready"
  | "collected"
  | "cancelled"
  | "expired";
// Whether money is owed back to the attendee. Separate from the order status.
export type OrderRefundStatus = "none" | "due" | "refunded";

export type Event = {
  id: string;
  slug: string;
  name: string;
  venueName: string;
  currency: string;
  // The map image is optional: the hall may be drawn in the app instead.
  floorPlanUrl: string | null;
  reservationHoldMinutes: number;
};

export type Booth = {
  id: string;
  vendorName: string;
  // Branding belongs to the vendor and is the same at every event. Public image addresses.
  logoUrl: string;
  slogan: string;
  bannerUrl: string;
  code: string;
  mode: BoothMode;
  orderingPaused: boolean;
  // Position on the floor plan image, as a fraction (0 to 1) of its width and height.
  mapX: number;
  mapY: number;
  pickupInstructions: string;
};

export type Product = {
  id: string;
  boothId: string;
  name: string;
  category: string;
  description: string;
  // Public image address.
  imageUrl: string;
  // Every photo's public address, imageUrl first, when the product has more than one.
  images?: string[];
  priceCents: number;
  availableQty: number;
  maxPerOrder: number;
};

export type EventCatalog = {
  event: Event;
  booths: Booth[];
  products: Product[];
};

export type OrderItem = {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
};

export type Order = {
  id: string;
  boothId: string;
  eventId: string;
  // The booth's number and the vendor's name, so an order shows where to collect it.
  boothCode: string;
  boothName: string;
  type: OrderType;
  status: OrderStatus;
  items: OrderItem[];
  totalCents: number;
  currency: string;
  pickupCode: string;
  holdEndsAt: string | null;
  createdAt: string;
  collectedAt: string | null;
  cancelReason: string | null;
  refundStatus: OrderRefundStatus;
};

export type CartItem = {
  productId: string;
  quantity: number;
};

// Every function that changes data returns a result or a typed reason for refusal.
export type Result<T, R extends string> =
  | { ok: true; value: T }
  | { ok: false; reason: R; productIds?: string[]; at?: string };

export type OrderRequestRefusal =
  | "insufficient_stock"
  | "over_max_per_order"
  | "ordering_paused"
  | "booth_not_accepting_orders"
  | "empty_cart"
  | "invalid_items"
  | "invalid_email"
  | "product_not_found";

export type OrderRequest = {
  boothId: string;
  items: CartItem[];
  email: string;
  // Generated in the browser so a retried request returns the first order.
  requestId: string;
};

export type OrderLookupRefusal = "order_not_found";
export type OrderChangeRefusal = "order_not_found" | "not_allowed_in_status";
export type CollectRefusal =
  "not_found" | "already_collected" | "cancelled" | "expired";
export type CancelOrderRefusal = OrderChangeRefusal | "reason_required";
export type SetStockRefusal = "product_not_found" | "invalid_quantity";
export type VendorSignInRefusal = "invalid_credentials" | "no_booth";
export type ConfirmCheckoutRefusal = "order_not_found" | "payment_not_verified";
export type StartCheckoutRefusal = OrderRequestRefusal | "checkout_unavailable";
