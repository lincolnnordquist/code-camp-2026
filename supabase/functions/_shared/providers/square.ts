import {
  type OrderState,
  type PaymentProvider,
  type PaymentStatus,
  ProviderError,
  type ProviderFailure,
  type RefundStatus,
  type SellerConnection,
} from "./types.ts";

export type SquareEnvironment = "sandbox" | "production";

const BASE_URLS: Record<SquareEnvironment, string> = {
  sandbox: "https://connect.squareupsandbox.com",
  production: "https://connect.squareup.com",
};

const PAYMENT_STATUSES: Record<string, PaymentStatus | undefined> = {
  APPROVED: "pending",
  PENDING: "pending",
  COMPLETED: "completed",
  CANCELED: "cancelled",
  FAILED: "failed",
};

const ORDER_STATES: Record<string, OrderState | undefined> = {
  DRAFT: "draft",
  OPEN: "open",
  COMPLETED: "completed",
  CANCELED: "cancelled",
};

const REFUND_STATUSES: Record<string, RefundStatus | undefined> = {
  PENDING: "pending",
  COMPLETED: "completed",
  REJECTED: "rejected",
  FAILED: "failed",
};

type SquareMoney = { amount?: number; currency?: string };

type SquareErrorReply = { errors?: { code?: string; detail?: string }[] };

type PaymentLinkReply = {
  payment_link?: { id?: string; url?: string; order_id?: string };
};

type OrderReply = {
  order?: { state?: string; tenders?: { payment_id?: string }[] };
};

type PaymentReply = {
  payment?: {
    id?: string;
    status?: string;
    order_id?: string;
    location_id?: string;
    amount_money?: SquareMoney;
  };
};

type RefundReply = {
  refund?: { status?: string; payment_id?: string; amount_money?: SquareMoney };
};

function failureReason(httpStatus: number, code: string): ProviderFailure {
  if (code === "INVALID_EMAIL_ADDRESS") return "invalid_buyer_email";
  if (httpStatus === 404) return "not_found";
  if (httpStatus === 429 || httpStatus >= 500) return "unavailable";
  return "rejected";
}

function unexpectedReply(missing: string): ProviderError {
  return new ProviderError(
    "unavailable",
    "UNEXPECTED_REPLY",
    `Square reply has no usable ${missing}`,
  );
}

export function createSquareProvider(
  environment: SquareEnvironment,
  fetchFn: typeof fetch = fetch,
): PaymentProvider {
  const baseUrl = BASE_URLS[environment];

  async function request<Reply>(
    connection: SellerConnection,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Reply> {
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new ProviderError(
        "unavailable",
        "NETWORK_ERROR",
        `Square request did not complete: ${String(cause)}`,
      );
    }

    let reply: unknown;
    try {
      reply = JSON.parse(await response.text());
    } catch {
      reply = null;
    }

    if (!response.ok) {
      const error = (reply as SquareErrorReply | null)?.errors?.[0];
      const code = error?.code ?? `HTTP_${response.status}`;
      throw new ProviderError(
        failureReason(response.status, code),
        code,
        error?.detail ?? `Square answered HTTP ${response.status}`,
      );
    }
    if (reply === null) throw unexpectedReply("JSON body");
    return reply as Reply;
  }

  return {
    webhookSignatureHeaderName: "x-square-hmacsha256-signature",
    // A card payment shows as APPROVED for about two seconds before it is
    // COMPLETED, and an attendee can land back on the order page inside that time.
    pendingRecheckMs: 2000,

    async createCheckout(input) {
      const reply = await request<PaymentLinkReply>(
        input.connection,
        "POST",
        "/v2/online-checkout/payment-links",
        {
          idempotency_key: input.idempotencyKey,
          order: {
            location_id: input.connection.locationId,
            line_items: input.lineItems.map((item) => ({
              name: item.name,
              quantity: String(item.quantity),
              base_price_money: {
                amount: item.unitPriceCents,
                currency: input.currency,
              },
            })),
          },
          checkout_options: { redirect_url: input.returnUrl },
          pre_populated_data: { buyer_email: input.buyerEmail },
        },
      );
      const link = reply.payment_link;
      if (!link?.url || !link.id || !link.order_id) {
        throw unexpectedReply("payment link");
      }
      return {
        url: link.url,
        checkoutLinkId: link.id,
        providerOrderId: link.order_id,
      };
    },

    async getPayment(connection, providerOrderId) {
      const { order } = await request<OrderReply>(
        connection,
        "GET",
        `/v2/orders/${encodeURIComponent(providerOrderId)}`,
      );
      // A paid checkout order stays OPEN, so the order state says nothing about
      // payment. Only the first tender is read: an order paid with several
      // tenders returns a payment below the order total.
      const paymentId = order?.tenders?.[0]?.payment_id;
      if (!paymentId) return null;

      const { payment } = await request<PaymentReply>(
        connection,
        "GET",
        `/v2/payments/${encodeURIComponent(paymentId)}`,
      );
      const status = PAYMENT_STATUSES[payment?.status ?? ""];
      const amountCents = payment?.amount_money?.amount;
      const currency = payment?.amount_money?.currency;
      if (
        !payment?.id || !payment.order_id || !payment.location_id || !status ||
        !Number.isSafeInteger(amountCents) || !currency
      ) {
        throw unexpectedReply("payment");
      }
      return {
        id: payment.id,
        providerOrderId: payment.order_id,
        status,
        amountCents: amountCents as number,
        currency,
        sellerLocationId: payment.location_id,
      };
    },

    async closeCheckout(connection, checkoutLinkId) {
      const reply = await request<{ cancelled_order_id?: string }>(
        connection,
        "DELETE",
        `/v2/online-checkout/payment-links/${
          encodeURIComponent(checkoutLinkId)
        }`,
      );
      return reply.cancelled_order_id ?? null;
    },

    async getOrderState(connection, providerOrderId) {
      const { order } = await request<OrderReply>(
        connection,
        "GET",
        `/v2/orders/${encodeURIComponent(providerOrderId)}`,
      );
      const state = ORDER_STATES[order?.state ?? ""];
      if (!state) throw unexpectedReply("order state");
      return state;
    },

    async getRefund(connection, refundId) {
      const { refund } = await request<RefundReply>(
        connection,
        "GET",
        `/v2/refunds/${encodeURIComponent(refundId)}`,
      );
      const status = REFUND_STATUSES[refund?.status ?? ""];
      const amountCents = refund?.amount_money?.amount;
      const currency = refund?.amount_money?.currency;
      if (
        !refund?.payment_id || !status || !Number.isSafeInteger(amountCents) ||
        !currency
      ) {
        throw unexpectedReply("refund");
      }
      return {
        status,
        paymentId: refund.payment_id,
        amountCents: amountCents as number,
        currency,
      };
    },

    async verifyWebhookSignature(input) {
      if (input.signatureHeader === null) return false;
      let signature: Uint8Array<ArrayBuffer>;
      try {
        signature = Uint8Array.from(
          atob(input.signatureHeader),
          (character) => character.charCodeAt(0),
        );
      } catch {
        return false;
      }
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(input.signatureKey),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      // crypto.subtle.verify compares in constant time.
      return crypto.subtle.verify(
        "HMAC",
        key,
        signature,
        encoder.encode(input.notificationUrl + input.rawBody),
      );
    },
  };
}
