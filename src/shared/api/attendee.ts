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
import { supabase } from "./client";
import { check, refusal, type Reply } from "./errors";
import { orderFromPayload, type OrderPayload } from "./mappers";
import { readOrders } from "./orders";
import { currentUserId, ensureSession } from "./session";

const ORDER_REFUSALS = [
  "insufficient_stock",
  "over_max_per_order",
  "ordering_paused",
  "booth_not_accepting_orders",
  "empty_cart",
  "invalid_items",
  "invalid_email",
  "product_not_found",
] as const satisfies readonly OrderRequestRefusal[];

const CHECKOUT_REFUSALS = [
  ...ORDER_REFUSALS,
  "checkout_unavailable",
] as const satisfies readonly StartCheckoutRefusal[];

type OrderReply = Reply & Partial<OrderPayload>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rpc(name: string, args: Record<string, unknown>) {
  return check(await supabase.rpc(name, args)) as OrderReply;
}

// Reserves the items and holds the stock. The first order signs the browser in anonymously.
export async function createReservation(
  request: OrderRequest,
): Promise<Result<Order, OrderRequestRefusal>> {
  await ensureSession();
  const reply = await rpc("create_reservation", {
    p_booth_id: request.boothId,
    p_items: request.items,
    p_email: request.email,
    p_request_id: request.requestId,
  });
  if (!reply.ok) return refusal(reply, ORDER_REFUSALS);
  return { ok: true, value: orderFromPayload(reply as OrderPayload) };
}

// Calls the create-checkout Edge Function, which holds the stock and creates the Square
// checkout. The attendee is then sent to checkoutUrl.
export async function startCheckout(
  request: OrderRequest,
): Promise<
  Result<{ order: Order; checkoutUrl: string }, StartCheckoutRefusal>
> {
  await ensureSession();
  const { data, error } = await supabase.functions.invoke<
    OrderReply & { checkoutUrl?: string }
  >("create-checkout", { body: request });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The server sent no data");
  if (!data.ok) return refusal(data, CHECKOUT_REFUSALS);
  return {
    ok: true,
    value: {
      order: orderFromPayload(data as OrderPayload),
      checkoutUrl: data.checkoutUrl as string,
    },
  };
}

// Calls the confirm-checkout Edge Function, which asks Square whether the payment really
// went through. The order is read back afterwards, so the screen shows its real status.
export async function confirmCheckout(
  orderId: string,
): Promise<Result<Order, ConfirmCheckoutRefusal>> {
  await ensureSession();
  const { data, error } = await supabase.functions.invoke<Reply>(
    "confirm-checkout",
    { body: { orderId } },
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The server sent no data");
  if (!data.ok) {
    return refusal(data, ["order_not_found", "payment_not_verified"] as const);
  }
  return getOrder(orderId);
}

// Cancels the attendee's own order, unpaid or prepaid, and returns its stock. A cancelled
// prepaid order is owed a refund, which the vendor makes in Square.
export async function cancelMyOrder(
  orderId: string,
): Promise<Result<Order, OrderChangeRefusal>> {
  await ensureSession();
  const reply = await rpc("cancel_my_order", { p_order_id: orderId });
  if (!reply.ok) {
    return refusal(reply, [
      "order_not_found",
      "not_allowed_in_status",
    ] as const);
  }
  return { ok: true, value: orderFromPayload(reply as OrderPayload) };
}

// The attendee's orders in this browser, newest first. Without a session there are none,
// and asking does not create one.
export async function listMyOrders(): Promise<Order[]> {
  if (!(await currentUserId())) return [];
  return readOrders("mine");
}

export async function getOrder(
  orderId: string,
): Promise<Result<Order, OrderLookupRefusal>> {
  if (!(await currentUserId())) return { ok: false, reason: "order_not_found" };
  const [order] = await readOrders({ orderId });
  return order
    ? { ok: true, value: order }
    : { ok: false, reason: "order_not_found" };
}

// The private link from the confirmation email. It opens one order on any device, with no
// session, and carries no email address.
export async function getOrderByToken(
  token: string,
): Promise<Result<Order, OrderLookupRefusal>> {
  // A link with a malformed token is simply not an order, and never reaches the database.
  if (!UUID.test(token)) return { ok: false, reason: "order_not_found" };
  const reply = await rpc("get_order_by_token", { p_token: token });
  if (!reply.ok) return refusal(reply, ["order_not_found"] as const);
  return { ok: true, value: orderFromPayload(reply as OrderPayload) };
}
