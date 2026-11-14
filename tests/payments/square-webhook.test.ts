import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  handleSquareWebhook,
  type SquareWebhookDeps,
} from "../../supabase/functions/square-webhook/handler";
import type { ConfirmationOutcome } from "../../supabase/functions/_shared/order-email";
import { createSquareProvider } from "../../supabase/functions/_shared/providers/square";
import {
  ProviderError,
  type ProviderPayment,
} from "../../supabase/functions/_shared/providers/types";

const ORDER_ID = "0a000000-0000-4000-8000-000000000001";
const LOCATION = "LOCATION_A";
const SIGNATURE_KEY = "test-signature-key";
const NOTIFICATION_URL = "https://functions.example.test/square-webhook";
const HEADER = "x-square-hmacsha256-signature";

function checkout(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    orderId: ORDER_ID,
    status: "pending_payment",
    checkoutLinkId: "LINK_1",
    providerOrderId: "SQ_ORDER_1",
    totalCents: 3200,
    currency: "USD",
    connection: {
      tokenSecretName: "SQUARE_ACCESS_TOKEN_VENDOR_A",
      locationId: LOCATION,
    },
    ...overrides,
  };
}

function payment(overrides: Partial<ProviderPayment> = {}): ProviderPayment {
  return {
    id: "PAY_1",
    providerOrderId: "SQ_ORDER_1",
    status: "completed",
    amountCents: 3200,
    currency: "USD",
    sellerLocationId: LOCATION,
    ...overrides,
  };
}

function paymentMessage(
  type: string,
  fields: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    merchant_id: "MERCHANT_1",
    type,
    event_id: "EVENT_1",
    data: {
      type: "payment",
      id: "PAY_1",
      object: {
        payment: {
          id: "PAY_1",
          order_id: "SQ_ORDER_1",
          location_id: LOCATION,
          status: "COMPLETED",
          amount_money: { amount: 3200, currency: "USD" },
          ...fields,
        },
      },
    },
  });
}

function refundMessage(type: string): string {
  return JSON.stringify({
    merchant_id: "MERCHANT_1",
    type,
    event_id: "EVENT_2",
    data: {
      type: "refund",
      id: "REFUND_1",
      object: {
        refund: {
          id: "REFUND_1",
          payment_id: "PAY_1",
          order_id: "SQ_RETURN_ORDER_1",
          location_id: LOCATION,
          status: "COMPLETED",
        },
      },
    },
  });
}

// node:crypto computes the signature, so the Web Crypto check under test is
// not checked against itself.
function sign(body: string, url = NOTIFICATION_URL, key = SIGNATURE_KEY) {
  return createHmac("sha256", key).update(url + body).digest("base64");
}

function signedRequest(body: string, signature: string | null = sign(body)) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== null) headers[HEADER] = signature;
  return new Request("http://localhost:54321/functions/v1/square-webhook", {
    method: "POST",
    headers,
    body,
  });
}

type Setup = {
  byOrder?: Record<string, unknown>;
  confirm?: Record<string, unknown>;
  payment?: ProviderPayment | null | Error;
  secret?: string;
  email?: ConfirmationOutcome;
};

function setup(options: Setup = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  const squareCalls: string[] = [];
  const emails: [string, string | null][] = [];
  const square = createSquareProvider("sandbox");
  const replies: Record<string, unknown> = {
    svc_get_checkout_by_provider_order: options.byOrder ?? checkout(),
    svc_confirm_paid_order: options.confirm ??
      { ok: true, outcome: "confirmed", status: "confirmed", changed: true },
  };
  const unused = () => Promise.reject(new Error("not used"));
  const deps: SquareWebhookDeps = {
    rpc(name, args) {
      calls.push([name, args]);
      return Promise.resolve(replies[name]);
    },
    provider: {
      webhookSignatureHeaderName: square.webhookSignatureHeaderName,
      pendingRecheckMs: 2000,
      createCheckout: unused,
      getPayment(connection, providerOrderId) {
        squareCalls.push(`getPayment ${connection.accessToken} ${providerOrderId}`);
        const result = options.payment === undefined ? payment() : options.payment;
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
      closeCheckout: unused,
      getOrderState: unused,
      getRefund: unused,
      verifyWebhookSignature: square.verifyWebhookSignature,
      parseWebhookEvent: square.parseWebhookEvent,
    },
    readSecret: (name) =>
      name === "SQUARE_ACCESS_TOKEN_VENDOR_A"
        ? options.secret ?? "seller-token"
        : undefined,
    email: {
      sendConfirmation(orderId, userId) {
        emails.push([orderId, userId]);
        return Promise.resolve(options.email ?? "sent");
      },
    },
    signatureKey: SIGNATURE_KEY,
    notificationUrl: NOTIFICATION_URL,
  };
  return { deps, calls, squareCalls, emails };
}

async function deliver(deps: SquareWebhookDeps, request: Request) {
  const response = await handleSquareWebhook(request, deps);
  return { status: response.status, body: await response.json() };
}

function rpcNames(calls: [string, Record<string, unknown>][]) {
  return calls.map(([name]) => name);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const unsigned: [string, (body: string) => string | null][] = [
  ["no signature", () => null],
  ["a signature made with another key", (body) => sign(body, NOTIFICATION_URL, "another-key")],
  ["a signature over the address the request arrived on", (body) =>
    sign(body, "http://localhost:54321/functions/v1/square-webhook")],
  ["a body changed after signing", (body) => sign(body.replace("3200", "1"))],
];

for (const [label, signatureFor] of unsigned) {
  test(`a message with ${label} is refused with 401 and changes nothing`, async () => {
    const { deps, calls, squareCalls, emails } = setup();
    const body = paymentMessage("payment.updated");

    const reply = await deliver(deps, signedRequest(body, signatureFor(body)));

    assert.deepEqual(reply, { status: 401, body: { ok: false, reason: "invalid_signature" } });
    assert.deepEqual(calls, []);
    assert.deepEqual(squareCalls, []);
    assert.deepEqual(emails, []);
  });
}

test("a GET is refused with 405", async () => {
  const { deps } = setup();
  const reply = await deliver(
    deps,
    new Request("http://localhost/square-webhook", { method: "GET" }),
  );
  assert.equal(reply.status, 405);
});

test("a signed body that is not JSON is answered 200 so Square does not redeliver it", async () => {
  const { deps, calls } = setup();
  const reply = await deliver(deps, signedRequest("not json"));
  assert.deepEqual(reply, { status: 200, body: { ok: false, reason: "malformed" } });
  assert.deepEqual(calls, []);
});

test("a signed payment message without an order id is answered 200 and changes nothing", async () => {
  const { deps, calls } = setup();
  const reply = await deliver(
    deps,
    signedRequest(paymentMessage("payment.updated", { order_id: undefined })),
  );
  assert.deepEqual(reply, { status: 200, body: { ok: false, reason: "malformed" } });
  assert.deepEqual(calls, []);
});

test("a refund message is answered 200 and changes nothing", async () => {
  const { deps, calls, squareCalls } = setup();
  const reply = await deliver(deps, signedRequest(refundMessage("refund.updated")));
  assert.deepEqual(reply, { status: 200, body: { ok: true, outcome: "ignored" } });
  assert.deepEqual(calls, []);
  assert.deepEqual(squareCalls, []);
});

test("an event type the function does not handle is answered 200 and changes nothing", async () => {
  const { deps, calls, squareCalls } = setup();
  const reply = await deliver(
    deps,
    signedRequest(JSON.stringify({ type: "order.updated", data: {} })),
  );
  assert.deepEqual(reply, { status: 200, body: { ok: true, outcome: "ignored" } });
  assert.deepEqual(calls, []);
  assert.deepEqual(squareCalls, []);
});

test("a payment for an order that is not ours is answered 200 without asking Square", async () => {
  const { deps, squareCalls } = setup({
    byOrder: { ok: false, reason: "order_not_found" },
  });
  const reply = await deliver(deps, signedRequest(paymentMessage("payment.updated")));
  assert.deepEqual(reply, { status: 200, body: { ok: false, reason: "order_not_found" } });
  assert.deepEqual(squareCalls, []);
});

test("a verified payment is recorded with Square's values, not the message's, and the email is sent", async () => {
  const { deps, calls, squareCalls, emails } = setup();
  const body = paymentMessage("payment.updated", {
    id: "PAY_FROM_MESSAGE",
    location_id: "LOCATION_FROM_MESSAGE",
    amount_money: { amount: 1, currency: "EUR" },
  });

  const reply = await deliver(deps, signedRequest(body));

  assert.deepEqual(reply, {
    status: 200,
    body: { ok: true, outcome: "confirmed", email: "sent" },
  });
  assert.deepEqual(calls[0], [
    "svc_get_checkout_by_provider_order",
    { p_provider_order_id: "SQ_ORDER_1" },
  ]);
  assert.deepEqual(squareCalls, ["getPayment seller-token SQ_ORDER_1"]);
  assert.deepEqual(calls[1], ["svc_confirm_paid_order", {
    p_provider_order_id: "SQ_ORDER_1",
    p_provider_payment_id: "PAY_1",
    p_amount_cents: 3200,
    p_currency: "USD",
    p_location_id: LOCATION,
  }]);
  assert.deepEqual(emails, [[ORDER_ID, null]]);
});

test("a repeated payment message is recorded once by the database and the email call repeats", async () => {
  const { deps, emails } = setup({
    confirm: { ok: true, outcome: "already_confirmed", status: "confirmed", changed: false },
    email: "already_sent",
  });
  const reply = await deliver(deps, signedRequest(paymentMessage("payment.updated")));
  assert.deepEqual(reply, {
    status: 200,
    body: { ok: true, outcome: "already_confirmed", email: "already_sent" },
  });
  assert.deepEqual(emails, [[ORDER_ID, null]]);
});

test("a message saying COMPLETED while Square still shows the payment pending is answered 500 for redelivery", async () => {
  const { deps, calls, emails } = setup({ payment: payment({ status: "pending" }) });
  const reply = await deliver(deps, signedRequest(paymentMessage("payment.updated")));
  assert.deepEqual(reply, { status: 500, body: { ok: false, reason: "payment_not_settled" } });
  assert.deepEqual(rpcNames(calls), ["svc_get_checkout_by_provider_order"]);
  assert.deepEqual(emails, []);
});

test("a message saying COMPLETED while Square has no payment yet is answered 500 for redelivery", async () => {
  const { deps, calls } = setup({ payment: null });
  const reply = await deliver(deps, signedRequest(paymentMessage("payment.updated")));
  assert.equal(reply.status, 500);
  assert.deepEqual(rpcNames(calls), ["svc_get_checkout_by_provider_order"]);
});

test("payment.created with APPROVED while Square shows it pending records nothing and is answered 200", async () => {
  const { deps, calls, emails } = setup({ payment: payment({ status: "pending" }) });
  const reply = await deliver(
    deps,
    signedRequest(paymentMessage("payment.created", { status: "APPROVED" })),
  );
  assert.deepEqual(reply, {
    status: 200,
    body: { ok: false, reason: "payment_not_completed" },
  });
  assert.deepEqual(rpcNames(calls), ["svc_get_checkout_by_provider_order"]);
  assert.deepEqual(emails, []);
});

test("a message saying APPROVED is confirmed when Square's record is already completed", async () => {
  const { deps, emails } = setup();
  const reply = await deliver(
    deps,
    signedRequest(paymentMessage("payment.created", { status: "APPROVED" })),
  );
  assert.equal(reply.body.outcome, "confirmed");
  assert.deepEqual(emails, [[ORDER_ID, null]]);
});

test("a completed payment for another amount is not recorded", async () => {
  const { deps, calls, emails } = setup({ payment: payment({ amountCents: 3199 }) });
  const reply = await deliver(deps, signedRequest(paymentMessage("payment.updated")));
  assert.deepEqual(reply, { status: 200, body: { ok: false, reason: "amount_mismatch" } });
  assert.deepEqual(rpcNames(calls), ["svc_get_checkout_by_provider_order"]);
  assert.deepEqual(emails, []);
});

test("a payment the database records as refund due sends no email", async () => {
  const { deps, emails } = setup({
    byOrder: checkout({ status: "expired" }),
    confirm: { ok: true, outcome: "refund_due", status: "expired", changed: true },
  });
  const reply = await deliver(deps, signedRequest(paymentMessage("payment.updated")));
  assert.deepEqual(reply, { status: 200, body: { ok: true, outcome: "refund_due" } });
  assert.deepEqual(emails, []);
});

test("a payment the database refuses is answered 200 and sends no email", async () => {
  const { deps, emails } = setup({
    confirm: { ok: false, reason: "location_mismatch" },
  });
  const reply = await deliver(deps, signedRequest(paymentMessage("payment.updated")));
  assert.deepEqual(reply, { status: 200, body: { ok: false, reason: "location_mismatch" } });
  assert.deepEqual(emails, []);
});

test("a failed email still answers 200, since the order is confirmed", async () => {
  const { deps } = setup({ email: "failed" });
  const reply = await deliver(deps, signedRequest(paymentMessage("payment.updated")));
  assert.deepEqual(reply, {
    status: 200,
    body: { ok: true, outcome: "confirmed", email: "failed" },
  });
});

test("Square unavailable is answered 500 for redelivery", async () => {
  const { deps, calls } = setup({
    payment: new ProviderError("unavailable", "HTTP_503", "down"),
  });
  const reply = await deliver(deps, signedRequest(paymentMessage("payment.updated")));
  assert.deepEqual(reply, { status: 500, body: { ok: false, reason: "provider_unavailable" } });
  assert.deepEqual(rpcNames(calls), ["svc_get_checkout_by_provider_order"]);
});

test("Square refusing the lookup is answered 500, so a fixed seller token gets the redelivery", async () => {
  const { deps } = setup({
    payment: new ProviderError("rejected", "UNAUTHORIZED", "bad token"),
  });
  const reply = await deliver(deps, signedRequest(paymentMessage("payment.updated")));
  assert.deepEqual(reply, { status: 500, body: { ok: false, reason: "provider_rejected" } });
});

test("a message saying COMPLETED while Square's first tender shows a cancelled payment is answered 500 for redelivery", async () => {
  const { deps, calls } = setup({ payment: payment({ status: "cancelled" }) });
  const reply = await deliver(deps, signedRequest(paymentMessage("payment.updated")));
  assert.deepEqual(reply, { status: 500, body: { ok: false, reason: "payment_not_settled" } });
  assert.deepEqual(rpcNames(calls), ["svc_get_checkout_by_provider_order"]);
});

test("a seller token secret that is not set is answered 500 without asking Square", async () => {
  const { deps, squareCalls } = setup({ secret: "" });
  const reply = await deliver(deps, signedRequest(paymentMessage("payment.updated")));
  assert.deepEqual(reply, { status: 500, body: { ok: false, reason: "secret_missing" } });
  assert.deepEqual(squareCalls, []);
});

test("a database error is thrown to the entry point, which answers 500", async () => {
  const { deps } = setup();
  deps.rpc = () => Promise.reject(new Error("svc_get_checkout_by_provider_order failed"));
  await assert.rejects(
    handleSquareWebhook(signedRequest(paymentMessage("payment.updated")), deps),
    /svc_get_checkout_by_provider_order failed/,
  );
});

