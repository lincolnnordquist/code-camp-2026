import {
  type PaymentProvider,
  ProviderError,
  type SellerConnection,
} from "../_shared/providers/types.ts";

export type ServiceRefusal = {
  ok: false;
  reason: string;
  productIds?: string[];
};

type PendingOrder = {
  ok: true;
  orderId: string;
  status: string;
  currency: string;
  buyerEmail: string;
  items: {
    productId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
  }[];
  checkoutLinkId: string | null;
  providerOrderId: string | null;
  connection: { tokenSecretName: string; locationId: string };
  [field: string]: unknown;
};

export type CreateCheckoutDeps = {
  getUserId(accessToken: string): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  provider: PaymentProvider;
  readSecret(name: string): string | undefined;
  appUrl: string;
};

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function orderPageUrl(appUrl: string, orderId: string): string {
  return `${appUrl.replace(/\/+$/, "")}/orders/${orderId}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CheckoutRequest = {
  boothId: string;
  items: { productId: string; quantity: number }[];
  email: string;
  requestId: string;
};

function parseRequest(body: unknown): CheckoutRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { boothId, items, email, requestId } = body as Record<string, unknown>;
  if (typeof boothId !== "string" || !UUID.test(boothId)) return null;
  if (typeof email !== "string") return null;
  if (typeof requestId !== "string" || requestId === "") return null;
  if (!Array.isArray(items)) return null;
  const itemsValid = items.every((item) =>
    typeof item === "object" && item !== null &&
    typeof item.productId === "string" && UUID.test(item.productId) &&
    Number.isInteger(item.quantity)
  );
  if (!itemsValid) return null;
  return {
    boothId,
    email,
    requestId,
    items: items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    })),
  };
}

function refuse(reason: string): Response {
  return json(200, { ok: false, reason });
}

// A null provider order id releases only an order with no link stored. An order
// with a link is refused with provider_order_mismatch and stays pending, because
// that link can still be paid.
async function releaseHold(
  deps: CreateCheckoutDeps,
  orderId: string,
): Promise<void> {
  const reply = await deps.rpc("svc_release_checkout", {
    p_order_id: orderId,
    p_provider_order_id: null,
  }) as { ok: boolean; reason?: string };
  if (!reply.ok) {
    console.error(JSON.stringify({
      event: "checkout_hold_not_released",
      orderId,
      reason: reply.reason,
    }));
  }
}

async function closeUnattachedLink(
  deps: CreateCheckoutDeps,
  connection: SellerConnection,
  checkoutLinkId: string,
  orderId: string,
): Promise<void> {
  try {
    await deps.provider.closeCheckout(connection, checkoutLinkId);
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    console.error(JSON.stringify({
      event: "checkout_link_not_closed",
      orderId,
      checkoutLinkId,
      providerCode: error.providerCode,
    }));
  }
}

export async function handleCreateCheckout(
  request: Request,
  deps: CreateCheckoutDeps,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { ok: false, reason: "method_not_allowed" });
  }

  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)
    ?.[1];
  const userId = token ? await deps.getUserId(token) : null;
  if (!userId) return json(401, { ok: false, reason: "not_signed_in" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const checkout = parseRequest(body);
  if (!checkout) return json(400, { ok: false, reason: "invalid_request" });

  const order = await deps.rpc("svc_create_pending_order", {
    p_user_id: userId,
    p_booth_id: checkout.boothId,
    p_items: checkout.items,
    p_email: checkout.email,
    p_request_id: checkout.requestId,
  }) as PendingOrder | ServiceRefusal;
  if (!order.ok) return json(200, order);

  const {
    connection,
    checkoutLinkId: _storedLinkId,
    providerOrderId: _storedProviderOrderId,
    ...publicOrder
  } = order;

  // A repeated request id returns the first order, whatever its status is now.
  if (order.status !== "pending_payment") return refuse("checkout_unavailable");

  const accessToken = deps.readSecret(connection.tokenSecretName);
  if (!accessToken) {
    console.error(JSON.stringify({
      event: "checkout_secret_missing",
      orderId: order.orderId,
      secretName: connection.tokenSecretName,
    }));
    await releaseHold(deps, order.orderId);
    return refuse("checkout_unavailable");
  }

  // The order id is the idempotency key, so a repeated request for an order
  // that already has a link gets the same link back from the provider.
  let checkoutResult;
  try {
    checkoutResult = await deps.provider.createCheckout({
      connection: { accessToken, locationId: connection.locationId },
      lineItems: order.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      })),
      currency: order.currency,
      returnUrl: orderPageUrl(deps.appUrl, order.orderId),
      buyerEmail: order.buyerEmail,
      idempotencyKey: order.orderId,
    });
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    console.error(JSON.stringify({
      event: "checkout_provider_failed",
      orderId: order.orderId,
      reason: error.reason,
      providerCode: error.providerCode,
      message: error.message,
    }));
    await releaseHold(deps, order.orderId);
    return refuse(
      error.reason === "invalid_buyer_email"
        ? "invalid_email"
        : "checkout_unavailable",
    );
  }

  // A link the order does not store is closed by nothing else, and the order's
  // stock can be released while that link is still payable.
  const closeLink = () =>
    closeUnattachedLink(
      deps,
      { accessToken, locationId: connection.locationId },
      checkoutResult.checkoutLinkId,
      order.orderId,
    );
  let attached: { ok: boolean; reason?: string };
  try {
    attached = await deps.rpc("svc_attach_checkout", {
      p_order_id: order.orderId,
      p_checkout_link_id: checkoutResult.checkoutLinkId,
      p_provider_order_id: checkoutResult.providerOrderId,
    }) as { ok: boolean; reason?: string };
  } catch (error) {
    await closeLink();
    throw error;
  }
  if (!attached.ok) {
    console.error(JSON.stringify({
      event: "checkout_not_attached",
      orderId: order.orderId,
      reason: attached.reason,
      checkoutLinkId: checkoutResult.checkoutLinkId,
    }));
    await closeLink();
    return refuse("checkout_unavailable");
  }

  return json(200, { ...publicOrder, checkoutUrl: checkoutResult.url });
}
