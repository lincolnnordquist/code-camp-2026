import {
  type PaymentProvider,
  type ProviderPayment,
  ProviderError,
  type SellerConnection,
} from "../_shared/providers/types.ts";
import { verifyPayment } from "../_shared/verify-payment.ts";
import { recordVerifiedPayment } from "../_shared/confirm-payment.ts";
import type { OrderEmailSender } from "../_shared/order-email.ts";
import { bearerToken, corsHeaders, isUuid, json } from "../_shared/http.ts";

export type ConfirmCheckoutDeps = {
  getUserId(accessToken: string): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  provider: PaymentProvider;
  readSecret(name: string): string | undefined;
  email: OrderEmailSender;
  wait(milliseconds: number): Promise<void>;
};

type Checkout = {
  orderId: string;
  status: string;
  providerOrderId: string | null;
  totalCents: number;
  currency: string;
  connection: { tokenSecretName: string; locationId: string };
};

const ALREADY_PAID = new Set(["confirmed", "ready", "collected"]);

function log(event: string, details: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, ...details }));
}

function unchanged(checkout: Checkout): Response {
  if (checkout.status === "pending_payment") {
    return json(200, { ok: false, reason: "payment_not_verified" });
  }
  return json(200, {
    ok: true,
    orderId: checkout.orderId,
    status: checkout.status,
    outcome: "unchanged",
  });
}

async function lookUpPayment(
  deps: ConfirmCheckoutDeps,
  connection: SellerConnection,
  providerOrderId: string,
): Promise<ProviderPayment | null> {
  const payment = await deps.provider.getPayment(connection, providerOrderId);
  if (payment?.status !== "pending") return payment;
  await deps.wait(deps.provider.pendingRecheckMs);
  return deps.provider.getPayment(connection, providerOrderId);
}

export async function handleConfirmCheckout(
  request: Request,
  deps: ConfirmCheckoutDeps,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { ok: false, reason: "method_not_allowed" });
  }

  const token = bearerToken(request);
  const userId = token ? await deps.getUserId(token) : null;
  if (!userId) return json(401, { ok: false, reason: "not_signed_in" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const orderId = (body as { orderId?: unknown } | null)?.orderId;
  if (!isUuid(orderId)) {
    return json(400, { ok: false, reason: "invalid_request" });
  }

  const found = await deps.rpc("svc_get_checkout", {
    p_order_id: orderId,
    p_user_id: userId,
  }) as ({ ok: true } & Checkout) | { ok: false };
  if (!found.ok) return json(200, { ok: false, reason: "order_not_found" });
  const checkout: Checkout = found;

  if (ALREADY_PAID.has(checkout.status)) {
    await deps.email.sendConfirmation(orderId, userId);
    return unchanged(checkout);
  }
  if (checkout.providerOrderId === null) return unchanged(checkout);

  const accessToken = deps.readSecret(checkout.connection.tokenSecretName);
  if (!accessToken) {
    log("confirm_checkout_secret_missing", {
      orderId,
      secretName: checkout.connection.tokenSecretName,
    });
    return unchanged(checkout);
  }
  const connection: SellerConnection = {
    accessToken,
    locationId: checkout.connection.locationId,
  };

  // An expired or cancelled order still gets the lookup, so a payment that did
  // land is recorded as refund due (FR-15).
  let payment: ProviderPayment | null;
  try {
    payment = await lookUpPayment(deps, connection, checkout.providerOrderId);
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    log("confirm_checkout_provider_failed", {
      orderId,
      reason: error.reason,
      providerCode: error.providerCode,
    });
    return unchanged(checkout);
  }

  const verification = verifyPayment({
    sellerLocationId: checkout.connection.locationId,
    providerOrderId: checkout.providerOrderId,
    totalCents: checkout.totalCents,
    currency: checkout.currency,
  }, payment);
  if (!verification.verified) {
    log("confirm_checkout_not_verified", {
      orderId,
      reason: verification.reason,
    });
    return unchanged(checkout);
  }

  const recorded = await recordVerifiedPayment(deps.rpc, verification);
  if (!recorded.ok) {
    log("confirm_checkout_not_recorded", { orderId, reason: recorded.reason });
    return unchanged(checkout);
  }
  if (recorded.outcome !== "refund_due") {
    await deps.email.sendConfirmation(orderId, userId);
  }
  return json(200, {
    ok: true,
    orderId,
    status: recorded.status,
    outcome: recorded.outcome,
  });
}
