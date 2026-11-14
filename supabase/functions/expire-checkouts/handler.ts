import {
  type PaymentProvider,
  type ProviderPayment,
  ProviderError,
  type SellerConnection,
} from "../_shared/providers/types.ts";
import {
  type ExpectedPayment,
  verifyPayment,
} from "../_shared/verify-payment.ts";

export type OverdueCheckout = {
  orderId: string;
  checkoutLinkId: string | null;
  providerOrderId: string | null;
  totalCents: number;
  currency: string;
  connection: { tokenSecretName: string; locationId: string };
};

export type ExpireCheckoutsDeps = {
  serviceKey: string;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  provider: PaymentProvider;
  readSecret(name: string): string | undefined;
};

type Outcome =
  | "expired"
  | "left"
  | "paidAwaitingConfirmation"
  | "paidNotVerified"
  | "failed";

type PaymentCheck = "unpaid" | Exclude<Outcome, "expired" | "failed">;

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function log(event: string, details: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, ...details }));
}

// Compares every byte so the response time does not reveal how much of the key matched.
function sameKey(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

function checkPayment(
  orderId: string,
  expected: ExpectedPayment,
  payment: ProviderPayment | null,
): PaymentCheck {
  if (
    payment === null || payment.status === "failed" ||
    payment.status === "cancelled"
  ) {
    return "unpaid";
  }
  if (payment.status === "pending") return "left";
  const verification = verifyPayment(expected, payment);
  if (verification.verified) return "paidAwaitingConfirmation";
  log("overdue_payment_not_verified", {
    orderId,
    paymentId: payment.id,
    reason: verification.reason,
  });
  return "paidNotVerified";
}

async function expireOrder(
  deps: ExpireCheckoutsDeps,
  orderId: string,
  providerOrderId: string | null,
): Promise<Outcome> {
  const reply = await deps.rpc("svc_expire_checkout", {
    p_order_id: orderId,
    p_provider_order_id: providerOrderId,
  }) as { ok: boolean; changed?: boolean; reason?: string };
  if (reply.ok && reply.changed) return "expired";
  log("overdue_checkout_not_expired", {
    orderId,
    reason: reply.ok ? "already_expired" : reply.reason,
  });
  return "left";
}

async function settle(
  deps: ExpireCheckoutsDeps,
  order: OverdueCheckout,
): Promise<Outcome> {
  const { orderId, checkoutLinkId, providerOrderId } = order;
  if (checkoutLinkId === null || providerOrderId === null) {
    return expireOrder(deps, orderId, null);
  }

  const accessToken = deps.readSecret(order.connection.tokenSecretName);
  if (!accessToken) {
    log("overdue_checkout_secret_missing", {
      orderId,
      secretName: order.connection.tokenSecretName,
    });
    return "failed";
  }
  const connection: SellerConnection = {
    accessToken,
    locationId: order.connection.locationId,
  };
  const expected: ExpectedPayment = {
    sellerLocationId: order.connection.locationId,
    providerOrderId,
    totalCents: order.totalCents,
    currency: order.currency,
  };

  const before = checkPayment(
    orderId,
    expected,
    await deps.provider.getPayment(connection, providerOrderId),
  );
  if (before !== "unpaid") return before;

  const cancelledId = await deps.provider.closeCheckout(
    connection,
    checkoutLinkId,
  );
  if (cancelledId === providerOrderId) {
    return expireOrder(deps, orderId, providerOrderId);
  }
  if (cancelledId !== null) {
    log("overdue_checkout_other_order_cancelled", {
      orderId,
      providerOrderId,
      cancelledId,
    });
    return "left";
  }

  // No cancelled id: the order was paid while the link was deleted, or an
  // earlier run already deleted the link.
  const after = checkPayment(
    orderId,
    expected,
    await deps.provider.getPayment(connection, providerOrderId),
  );
  if (after !== "unpaid") return after;
  // A cancelled Square order can no longer be paid, so its stock can be
  // released although the delete named no order.
  const state = await deps.provider.getOrderState(connection, providerOrderId);
  if (state === "cancelled") {
    return expireOrder(deps, orderId, providerOrderId);
  }
  log("overdue_checkout_not_cancelled", { orderId, providerOrderId, state });
  return "left";
}

export async function handleExpireCheckouts(
  request: Request,
  deps: ExpireCheckoutsDeps,
): Promise<Response> {
  if (request.method !== "POST") {
    return json(405, { ok: false, reason: "method_not_allowed" });
  }
  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)
    ?.[1];
  if (!token || !sameKey(token, deps.serviceKey)) {
    return json(401, { ok: false, reason: "not_authorized" });
  }

  const list = await deps.rpc("svc_list_overdue_checkouts", {}) as {
    orders: OverdueCheckout[];
  };
  const counts: Record<Outcome, number> = {
    expired: 0,
    left: 0,
    paidAwaitingConfirmation: 0,
    paidNotVerified: 0,
    failed: 0,
  };

  // Each order is settled on its own, so one that keeps failing does not stop
  // the orders after it.
  for (const order of list.orders) {
    let outcome: Outcome;
    try {
      outcome = await settle(deps, order);
    } catch (error) {
      const temporary = error instanceof ProviderError &&
        error.reason === "unavailable";
      log("overdue_checkout_error", {
        orderId: order.orderId,
        reason: error instanceof ProviderError ? error.reason : undefined,
        providerCode: error instanceof ProviderError
          ? error.providerCode
          : undefined,
        message: String(error),
      });
      outcome = temporary ? "left" : "failed";
    }
    counts[outcome] += 1;
  }

  return json(200, { ok: true, listed: list.orders.length, ...counts });
}
