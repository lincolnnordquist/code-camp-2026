import type {
  CollectRefusal,
  Order,
  OrderChangeRefusal,
  Result,
} from "../types";
import { catalog, notifyChange, orders } from "./sample-store";

export async function signInVendor(
  email: string,
  password: string,
): Promise<Result<{ boothId: string }, "invalid_credentials">> {
  if (!email || !password) return { ok: false, reason: "invalid_credentials" };
  return { ok: true, value: { boothId: "booth-a" } };
}

export async function signOut(): Promise<void> {}

export async function listBoothOrders(boothId: string): Promise<Order[]> {
  return structuredClone(orders.filter((o) => o.boothId === boothId));
}

export async function markOrderReady(
  orderId: string,
): Promise<Result<Order, OrderChangeRefusal>> {
  const order = orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, reason: "order_not_found" };
  if (order.status !== "confirmed")
    return { ok: false, reason: "not_allowed_in_status" };
  order.status = "ready";
  notifyChange();
  return { ok: true, value: structuredClone(order) };
}

export async function collectOrder(
  boothId: string,
  pickupCode: string,
): Promise<Result<Order, CollectRefusal>> {
  const order = orders.find(
    (o) => o.boothId === boothId && o.pickupCode === pickupCode,
  );
  if (!order) return { ok: false, reason: "not_found" };
  if (order.status === "collected")
    return {
      ok: false,
      reason: "already_collected",
      at: order.collectedAt ?? undefined,
    };
  if (order.status === "cancelled") return { ok: false, reason: "cancelled" };
  if (order.status === "expired") return { ok: false, reason: "expired" };
  if (order.status === "pending_payment")
    return { ok: false, reason: "not_found" };
  order.status = "collected";
  order.collectedAt = new Date().toISOString();
  notifyChange();
  return { ok: true, value: structuredClone(order) };
}

export async function cancelOrder(
  orderId: string,
  reason: string,
): Promise<Result<Order, OrderChangeRefusal>> {
  const order = orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, reason: "order_not_found" };
  if (order.status !== "confirmed" && order.status !== "ready")
    return { ok: false, reason: "not_allowed_in_status" };
  order.status = "cancelled";
  order.cancelReason = reason;
  if (order.type === "prepaid") order.refundStatus = "due";
  notifyChange();
  return { ok: true, value: structuredClone(order) };
}

export async function setProductStock(
  productId: string,
  availableQty: number,
): Promise<Result<{ availableQty: number }, "product_not_found">> {
  const product = catalog.products.find((p) => p.id === productId);
  if (!product) return { ok: false, reason: "product_not_found" };
  product.availableQty = availableQty;
  return { ok: true, value: { availableQty } };
}

export async function setOrderingPaused(
  boothId: string,
  paused: boolean,
): Promise<Result<{ paused: boolean }, "booth_not_found">> {
  const booth = catalog.booths.find((b) => b.id === boothId);
  if (!booth) return { ok: false, reason: "booth_not_found" };
  booth.orderingPaused = paused;
  return { ok: true, value: { paused } };
}
