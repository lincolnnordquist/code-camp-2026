import type {
  ConfirmCheckoutRefusal,
  Order,
  OrderChangeRefusal,
  OrderLookupRefusal,
  OrderRequest,
  OrderRequestRefusal,
  Result,
  StartCheckoutRefusal,
} from "../types";
import {
  catalog,
  notifyChange,
  orders,
  ordersByRequestId,
} from "./sample-store";

function placeOrder(
  request: OrderRequest,
  type: Order["type"],
): Result<Order, OrderRequestRefusal> {
  const earlier = ordersByRequestId.get(request.requestId);
  if (earlier) return { ok: true, value: structuredClone(earlier) };

  const booth = catalog.booths.find((b) => b.id === request.boothId);
  if (
    !booth ||
    booth.mode === "discovery" ||
    booth.mode !== (type === "prepaid" ? "prepay" : "reservation")
  ) {
    return { ok: false, reason: "booth_not_accepting_orders" };
  }
  if (booth.orderingPaused) return { ok: false, reason: "ordering_paused" };
  if (request.items.length === 0) return { ok: false, reason: "empty_cart" };

  const lines = request.items.map((item) => ({
    item,
    product: catalog.products.find(
      (p) => p.id === item.productId && p.boothId === booth.id,
    ),
  }));
  const over = lines.filter(
    (l) => !l.product || l.item.quantity > l.product.maxPerOrder,
  );
  if (over.length > 0)
    return {
      ok: false,
      reason: "over_max_per_order",
      productIds: over.map((l) => l.item.productId),
    };
  const short = lines.filter(
    (l) => l.product && l.item.quantity > l.product.availableQty,
  );
  if (short.length > 0)
    return {
      ok: false,
      reason: "insufficient_stock",
      productIds: short.map((l) => l.item.productId),
    };

  const orderItems = lines.map(({ item, product }) => {
    product!.availableQty -= item.quantity;
    return {
      productId: item.productId,
      name: product!.name,
      quantity: item.quantity,
      unitPriceCents: product!.priceCents,
    };
  });
  const holdMinutes =
    type === "prepaid" ? 15 : catalog.event.reservationHoldMinutes;
  const order: Order = {
    id: crypto.randomUUID(),
    boothId: booth.id,
    eventId: catalog.event.id,
    boothCode: booth.code,
    boothName: booth.vendorName,
    type,
    status: type === "prepaid" ? "pending_payment" : "confirmed",
    items: orderItems,
    totalCents: orderItems.reduce(
      (sum, i) => sum + i.unitPriceCents * i.quantity,
      0,
    ),
    currency: catalog.event.currency,
    pickupCode: String(Math.floor(1000 + Math.random() * 9000)),
    holdEndsAt: new Date(Date.now() + holdMinutes * 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    collectedAt: null,
    cancelReason: null,
    refundStatus: "none",
  };
  orders.push(order);
  ordersByRequestId.set(request.requestId, order);
  notifyChange();
  return { ok: true, value: structuredClone(order) };
}

export async function createReservation(
  request: OrderRequest,
): Promise<Result<Order, OrderRequestRefusal>> {
  return placeOrder(request, "reservation");
}

// Real version: calls the create-checkout Edge Function. The stub returns a fake Square page address.
export async function startCheckout(
  request: OrderRequest,
): Promise<
  Result<{ order: Order; checkoutUrl: string }, StartCheckoutRefusal>
> {
  const placed = placeOrder(request, "prepaid");
  if (!placed.ok) return placed;
  return {
    ok: true,
    value: {
      order: placed.value,
      checkoutUrl: `https://example.com/square-checkout/${placed.value.id}`,
    },
  };
}

// Real version: calls the confirm-checkout Edge Function, which verifies the payment with Square.
export async function confirmCheckout(
  orderId: string,
): Promise<Result<Order, ConfirmCheckoutRefusal>> {
  const order = orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, reason: "order_not_found" };
  if (order.status !== "pending_payment")
    return { ok: true, value: structuredClone(order) };
  order.status = "confirmed";
  notifyChange();
  return { ok: true, value: structuredClone(order) };
}

// Cancels the attendee's own order, unpaid or prepaid. A cancelled prepaid order is owed a
// refund, which the vendor makes in Square.
export async function cancelMyOrder(
  orderId: string,
): Promise<Result<Order, OrderChangeRefusal>> {
  const order = orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, reason: "order_not_found" };
  if (order.status !== "confirmed" && order.status !== "ready")
    return { ok: false, reason: "not_allowed_in_status" };
  order.status = "cancelled";
  order.cancelReason = "Cancelled by the attendee";
  if (order.type === "prepaid") order.refundStatus = "due";
  for (const item of order.items) {
    const product = catalog.products.find((p) => p.id === item.productId);
    if (product) product.availableQty += item.quantity;
  }
  notifyChange();
  return { ok: true, value: structuredClone(order) };
}

export async function listMyOrders(): Promise<Order[]> {
  return structuredClone(orders);
}

export async function getOrder(
  orderId: string,
): Promise<Result<Order, OrderLookupRefusal>> {
  const order = orders.find((o) => o.id === orderId);
  return order
    ? { ok: true, value: structuredClone(order) }
    : { ok: false, reason: "order_not_found" };
}

// The private link from the confirmation email. The stub treats the token as the order id.
export async function getOrderByToken(
  token: string,
): Promise<Result<Order, OrderLookupRefusal>> {
  return getOrder(token);
}
