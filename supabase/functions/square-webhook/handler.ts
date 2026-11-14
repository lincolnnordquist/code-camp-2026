import {
  type PaymentProvider,
  ProviderError,
  type SellerConnection,
  type WebhookEvent,
} from "../_shared/providers/types.ts";
import { verifyPayment } from "../_shared/verify-payment.ts";
import { recordVerifiedPayment } from "../_shared/confirm-payment.ts";
import type { OrderEmailSender } from "../_shared/order-email.ts";
import { json } from "../_shared/http.ts";

export type SquareWebhookDeps = {
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  provider: PaymentProvider;
  readSecret(name: string): string | undefined;
  email: OrderEmailSender;
  signatureKey: string;
  notificationUrl: string;
};

type Checkout = {
  orderId: string;
  status: string;
  providerOrderId: string;
  totalCents: number;
  currency: string;
  connection: { tokenSecretName: string; locationId: string };
};

type Found = ({ ok: true } & Checkout) | { ok: false; reason: string };

function log(event: string, details: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, ...details }));
}

// Square redelivers any reply other than 2xx, with backoff, for up to 24 hours.
function retryLater(reason: string): Response {
  return json(500, { ok: false, reason });
}

function connectionFor(
  deps: SquareWebhookDeps,
  checkout: Checkout,
): SellerConnection | null {
  const accessToken = deps.readSecret(checkout.connection.tokenSecretName);
  if (!accessToken) {
    log("square_webhook_secret_missing", {
      orderId: checkout.orderId,
      secretName: checkout.connection.tokenSecretName,
    });
    return null;
  }
  return { accessToken, locationId: checkout.connection.locationId };
}

async function handlePayment(
  deps: SquareWebhookDeps,
  event: Extract<WebhookEvent, { kind: "payment" }>,
): Promise<Response> {
  const found = await deps.rpc("svc_get_checkout_by_provider_order", {
    p_provider_order_id: event.providerOrderId,
  }) as Found;
  if (!found.ok) return json(200, { ok: false, reason: "order_not_found" });
  const connection = connectionFor(deps, found);
  if (!connection) return retryLater("secret_missing");

  const payment = await deps.provider.getPayment(
    connection,
    found.providerOrderId,
  );
  // Square's own record can lag the message. The message never confirms the
  // order; the 500 asks for a redelivery and another lookup.
  if (event.reportedCompleted && payment?.status !== "completed") {
    log("square_webhook_payment_not_settled", { orderId: found.orderId });
    return retryLater("payment_not_settled");
  }

  const verification = verifyPayment({
    sellerLocationId: found.connection.locationId,
    providerOrderId: found.providerOrderId,
    totalCents: found.totalCents,
    currency: found.currency,
  }, payment);
  if (!verification.verified) {
    log("square_webhook_not_verified", {
      orderId: found.orderId,
      reason: verification.reason,
    });
    return json(200, { ok: false, reason: verification.reason });
  }

  const recorded = await recordVerifiedPayment(deps.rpc, verification);
  if (!recorded.ok) {
    log("square_webhook_not_recorded", {
      orderId: found.orderId,
      reason: recorded.reason,
    });
    return json(200, { ok: false, reason: recorded.reason });
  }
  if (recorded.outcome === "refund_due") {
    log("square_webhook_recorded", {
      orderId: found.orderId,
      outcome: recorded.outcome,
    });
    return json(200, { ok: true, outcome: recorded.outcome });
  }
  const email = await deps.email.sendConfirmation(found.orderId, null);
  return json(200, { ok: true, outcome: recorded.outcome, email });
}

export async function handleSquareWebhook(
  request: Request,
  deps: SquareWebhookDeps,
): Promise<Response> {
  if (request.method !== "POST") {
    return json(405, { ok: false, reason: "method_not_allowed" });
  }

  const rawBody = await request.text();
  const signed = await deps.provider.verifyWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get(
      deps.provider.webhookSignatureHeaderName,
    ),
    notificationUrl: deps.notificationUrl,
    signatureKey: deps.signatureKey,
  });
  if (!signed) {
    log("square_webhook_signature_invalid", {});
    return json(401, { ok: false, reason: "invalid_signature" });
  }

  const event = deps.provider.parseWebhookEvent(rawBody);
  try {
    switch (event.kind) {
      case "payment":
        return await handlePayment(deps, event);
      case "other":
        return json(200, { ok: true, outcome: "ignored" });
      case "malformed":
        // A redelivery of the same body cannot succeed either.
        log("square_webhook_malformed", {});
        return json(200, { ok: false, reason: "malformed" });
    }
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    log("square_webhook_provider_failed", {
      kind: event.kind,
      reason: error.reason,
      providerCode: error.providerCode,
    });
    // Each lookup reads an id from a signed Square message, so a refusal comes
    // from the seller token or a lagging record, and either can clear before
    // Square stops redelivering.
    return retryLater(`provider_${error.reason}`);
  }
}
