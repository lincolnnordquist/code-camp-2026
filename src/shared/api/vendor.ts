import type {
  CancelOrderRefusal,
  CollectRefusal,
  Order,
  OrderChangeRefusal,
  Result,
  SetStockRefusal,
  VendorSignInRefusal,
} from "../types";
import { supabase } from "./client";
import { check, refusal, type Reply } from "./errors";
import { orderFromPayload, type OrderPayload } from "./mappers";
import { readOrders } from "./orders";

type OrderReply = Reply & Partial<OrderPayload> & { availableQty?: number };

async function rpc(name: string, args: Record<string, unknown>) {
  return check(await supabase.rpc(name, args)) as OrderReply;
}

// Signs the vendor in with email and password, and finds their booth. A vendor with
// several events gets their most recent booth.
export async function signInVendor(
  email: string,
  password: string,
): Promise<Result<{ boothId: string }, VendorSignInRefusal>> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // 400 is a wrong email or password; anything else is a failure to reach the server.
    if (error.status === 400)
      return { ok: false, reason: "invalid_credentials" };
    throw new Error(error.message);
  }

  const staff = check(
    await supabase
      .from("vendor_staff")
      .select("vendor_id")
      .returns<{ vendor_id: string }[]>(),
  );
  const booth = staff.length
    ? check(
        await supabase
          .from("booths")
          .select("id")
          .in(
            "vendor_id",
            staff.map((row) => row.vendor_id),
          )
          .order("created_at", { ascending: false })
          .limit(1)
          .returns<{ id: string }[]>(),
      )[0]
    : undefined;
  if (!booth) {
    await supabase.auth.signOut();
    return { ok: false, reason: "no_booth" };
  }
  return { ok: true, value: { boothId: booth.id } };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

// The booth's orders, newest first. Only staff of the booth can read them.
export async function listBoothOrders(boothId: string): Promise<Order[]> {
  return readOrders({ boothId });
}

export async function markOrderReady(
  orderId: string,
): Promise<Result<Order, OrderChangeRefusal>> {
  const reply = await rpc("mark_order_ready", { p_order_id: orderId });
  if (!reply.ok) {
    return refusal(reply, [
      "order_not_found",
      "not_allowed_in_status",
    ] as const);
  }
  return { ok: true, value: orderFromPayload(reply as OrderPayload) };
}

// Hands an order over against its pickup code. A code from another booth is "not_found".
export async function collectOrder(
  boothId: string,
  pickupCode: string,
): Promise<Result<Order, CollectRefusal>> {
  const reply = await rpc("collect_order", {
    p_booth_id: boothId,
    p_pickup_code: pickupCode,
  });
  if (!reply.ok) {
    return refusal(reply, [
      "not_found",
      "already_collected",
      "cancelled",
      "expired",
    ] as const);
  }
  return { ok: true, value: orderFromPayload(reply as OrderPayload) };
}

export async function cancelOrder(
  orderId: string,
  reason: string,
): Promise<Result<Order, CancelOrderRefusal>> {
  const reply = await rpc("cancel_order", {
    p_order_id: orderId,
    p_reason: reason,
  });
  if (!reply.ok) {
    return refusal(reply, [
      "order_not_found",
      "reason_required",
      "not_allowed_in_status",
    ] as const);
  }
  return { ok: true, value: orderFromPayload(reply as OrderPayload) };
}

export async function setProductStock(
  productId: string,
  availableQty: number,
): Promise<Result<{ availableQty: number }, SetStockRefusal>> {
  const reply = await rpc("set_product_stock", {
    p_product_id: productId,
    p_available_qty: availableQty,
  });
  if (!reply.ok) {
    return refusal(reply, ["product_not_found", "invalid_quantity"] as const);
  }
  return { ok: true, value: { availableQty: reply.availableQty as number } };
}

export async function setOrderingPaused(
  boothId: string,
  paused: boolean,
): Promise<Result<{ paused: boolean }, "booth_not_found">> {
  const reply = await rpc("set_ordering_paused", {
    p_booth_id: boothId,
    p_paused: paused,
  });
  if (!reply.ok) return refusal(reply, ["booth_not_found"] as const);
  return { ok: true, value: { paused } };
}
