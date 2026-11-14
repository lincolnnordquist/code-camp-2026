import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  type ConfirmCheckoutDeps,
  handleConfirmCheckout,
} from "../../supabase/functions/confirm-checkout/handler";
import type { ConfirmationOutcome } from "../../supabase/functions/_shared/order-email";
import {
  type PaymentProvider,
  type PaymentStatus,
  ProviderError,
  type ProviderPayment,
} from "../../supabase/functions/_shared/providers/types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "0a000000-0000-4000-8000-000000000001";
const LOCATION = "LOCATION_A";

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

function payment(
  status: PaymentStatus,
  overrides: Partial<ProviderPayment> = {},
): ProviderPayment {
  return {
    id: "SQ_PAYMENT_1",
    providerOrderId: "SQ_ORDER_1",
    status,
    amountCents: 3200,
    currency: "USD",
    sellerLocationId: LOCATION,
    ...overrides,
  };
}

type Setup = {
  found?: unknown;
  payments?: (ProviderPayment | null | Error)[];
  confirmReply?: unknown;
  secrets?: Record<string, string>;
  emailResult?: ConfirmationOutcome;
};

function setup(options: Setup = {}) {
  const calls: string[] = [];
  const confirmCalls: Record<string, unknown>[] = [];
  const emails: [string, string | null][] = [];
  const waits: number[] = [];
  const payments = [...(options.payments ?? [null])];
  const unused = () => Promise.reject(new Error("not used by confirm-checkout"));
  const provider: PaymentProvider = {
    webhookSignatureHeaderName: "x-test-signature",
    pendingRecheckMs: 2000,
    createCheckout: unused,
    getPayment(_connection, providerOrderId) {
      calls.push(`getPayment ${providerOrderId}`);
      const next = payments.length > 0 ? payments.shift()! : null;
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    closeCheckout: unused,
    getOrderState: unused,
    getRefund: unused,
    verifyWebhookSignature: unused,
  };
  const deps: ConfirmCheckoutDeps = {
    getUserId: (token) =>
      Promise.resolve(token === "valid-session" ? USER_ID : null),
    rpc(name, args) {
      calls.push(name);
      if (name === "svc_get_checkout") {
        return Promise.resolve(options.found ?? checkout());
      }
      confirmCalls.push(args);
      return Promise.resolve(
        options.confirmReply ??
          { ok: true, outcome: "confirmed", status: "confirmed", changed: true },
      );
    },
    provider,
    readSecret: (name) =>
      (options.secrets ?? { SQUARE_ACCESS_TOKEN_VENDOR_A: "seller-token" })[name],
    email: {
      sendConfirmation(orderId, userId) {
        emails.push([orderId, userId]);
        return Promise.resolve(options.emailResult ?? "sent");
      },
    },
    wait(milliseconds) {
      waits.push(milliseconds);
      return Promise.resolve();
    },
  };
  return { deps, calls, confirmCalls, emails, waits };
}

function post(body: unknown, token: string | null = "valid-session") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/confirm-checkout", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function call(deps: ConfirmCheckoutDeps, request = post({ orderId: ORDER_ID })) {
  const response = await handleConfirmCheckout(request, deps);
  return { status: response.status, body: await response.json() };
}

const notVerified = { ok: false, reason: "payment_not_verified" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("a request without a session is refused before the order is read", async () => {
  const { deps, calls } = setup();
  for (const token of [null, "expired-session"]) {
    const { status, body } = await call(deps, post({ orderId: ORDER_ID }, token));
    assert.equal(status, 401);
    assert.deepEqual(body, { ok: false, reason: "not_signed_in" });
  }
  assert.deepEqual(calls, []);
});

test("a body without an order id is refused before the order is read", async () => {
  const { deps, calls } = setup();
  for (const body of ["not json", {}, { orderId: "B4" }, { orderId: 7 }]) {
    const reply = await call(deps, post(body));
    assert.equal(reply.status, 400);
    assert.equal(reply.body.reason, "invalid_request");
  }
  assert.deepEqual(calls, []);
});

test("an order that is not the caller's is not found and Square is not called", async () => {
  const { deps, calls } = setup({ found: { ok: false, reason: "order_not_found" } });
  const { body } = await call(deps);
  assert.deepEqual(body, { ok: false, reason: "order_not_found" });
  assert.deepEqual(calls, ["svc_get_checkout"]);
});

test("the order is read for the session's user", async () => {
  const calls: Record<string, unknown>[] = [];
  const { deps } = setup();
  const rpc = deps.rpc;
  deps.rpc = (name, args) => {
    if (name === "svc_get_checkout") calls.push(args);
    return rpc(name, args);
  };
  await call(deps);
  assert.deepEqual(calls, [{ p_order_id: ORDER_ID, p_user_id: USER_ID }]);
});

test("a verified payment is recorded and the email is sent for the session's user", async () => {
  const { deps, calls, confirmCalls, emails } = setup({
    payments: [payment("completed")],
  });
  const { body } = await call(deps);

  assert.deepEqual(body, {
    ok: true,
    orderId: ORDER_ID,
    status: "confirmed",
    outcome: "confirmed",
  });
  assert.deepEqual(calls, [
    "svc_get_checkout",
    "getPayment SQ_ORDER_1",
    "svc_confirm_paid_order",
  ]);
  assert.deepEqual(confirmCalls, [{
    p_provider_order_id: "SQ_ORDER_1",
    p_provider_payment_id: "SQ_PAYMENT_1",
    p_amount_cents: 3200,
    p_currency: "USD",
    p_location_id: LOCATION,
  }]);
  assert.deepEqual(emails, [[ORDER_ID, USER_ID]]);
});

test("the reply's status comes from the database", async () => {
  const { deps, emails } = setup({
    payments: [payment("completed")],
    confirmReply: { ok: true, outcome: "already_confirmed", status: "ready", changed: false },
  });
  const { body } = await call(deps);
  assert.deepEqual(body, {
    ok: true,
    orderId: ORDER_ID,
    status: "ready",
    outcome: "already_confirmed",
  });
  assert.deepEqual(emails, [[ORDER_ID, USER_ID]]);
});

test("a payment recorded as refund due sends no email", async () => {
  const { deps, emails } = setup({
    found: checkout({ status: "expired" }),
    payments: [payment("completed")],
    confirmReply: { ok: true, outcome: "refund_due", status: "expired", changed: true },
  });
  const { body } = await call(deps);
  assert.deepEqual(body, {
    ok: true,
    orderId: ORDER_ID,
    status: "expired",
    outcome: "refund_due",
  });
  assert.deepEqual(emails, []);
});

for (const status of ["confirmed", "ready", "collected"]) {
  test(`an order already ${status} asks for the email and does not call Square`, async () => {
    const { deps, calls, emails } = setup({ found: checkout({ status }) });
    const { body } = await call(deps);
    assert.deepEqual(body, { ok: true, orderId: ORDER_ID, status, outcome: "unchanged" });
    assert.deepEqual(calls, ["svc_get_checkout"]);
    assert.deepEqual(emails, [[ORDER_ID, USER_ID]]);
  });
}

for (const status of ["expired", "cancelled"]) {
  test(`an ${status} order with no payment is unchanged, after asking Square`, async () => {
    const { deps, calls, emails } = setup({ found: checkout({ status }) });
    const { body } = await call(deps);
    assert.deepEqual(body, { ok: true, orderId: ORDER_ID, status, outcome: "unchanged" });
    assert.ok(calls.includes("getPayment SQ_ORDER_1"));
    assert.deepEqual(emails, []);
  });
}

test("an order that never reached Square is not verified and Square is not called", async () => {
  const { deps, calls } = setup({
    found: checkout({ checkoutLinkId: null, providerOrderId: null }),
  });
  assert.deepEqual((await call(deps)).body, notVerified);
  assert.deepEqual(calls, ["svc_get_checkout"]);
});

test("a missing seller token is not verified and Square is not called", async () => {
  const { deps, calls } = setup({ secrets: {} });
  assert.deepEqual((await call(deps)).body, notVerified);
  assert.deepEqual(calls, ["svc_get_checkout"]);
});

test("a pending payment is read once more after two seconds", async () => {
  const { deps, calls, waits, emails } = setup({
    payments: [payment("pending"), payment("completed")],
  });
  const { body } = await call(deps);
  assert.equal(body.status, "confirmed");
  assert.deepEqual(waits, [2000]);
  assert.equal(calls.filter((c) => c.startsWith("getPayment")).length, 2);
  assert.deepEqual(emails, [[ORDER_ID, USER_ID]]);
});

test("a payment still pending after the second read is not verified", async () => {
  const { deps, confirmCalls, waits } = setup({
    payments: [payment("pending"), payment("pending")],
  });
  assert.deepEqual((await call(deps)).body, notVerified);
  assert.deepEqual(waits, [2000]);
  assert.deepEqual(confirmCalls, []);
});

const unverified: [string, (ProviderPayment | null | Error)[]][] = [
  ["no payment", [null]],
  ["a failed payment", [payment("failed")]],
  ["another amount", [payment("completed", { amountCents: 3100 })]],
  ["another currency", [payment("completed", { currency: "CAD" })]],
  ["another seller", [payment("completed", { sellerLocationId: "LOCATION_B" })]],
  ["another Square order", [payment("completed", { providerOrderId: "SQ_OTHER" })]],
  ["Square unavailable", [new ProviderError("unavailable", "HTTP_503", "down")]],
  ["Square refusing the token", [new ProviderError("rejected", "UNAUTHORIZED", "no")]],
];

for (const [name, payments] of unverified) {
  test(`${name} is not verified and nothing is recorded`, async () => {
    const { deps, confirmCalls, emails, waits } = setup({ payments });
    assert.deepEqual((await call(deps)).body, notVerified);
    assert.deepEqual(confirmCalls, []);
    assert.deepEqual(emails, []);
    assert.deepEqual(waits, []);
  });
}

for (const reason of ["amount_mismatch", "payment_belongs_to_other_order", "order_not_found"]) {
  test(`a ${reason} refusal from the database is not verified and sends no email`, async () => {
    const { deps, emails } = setup({
      payments: [payment("completed")],
      confirmReply: { ok: false, reason },
    });
    assert.deepEqual((await call(deps)).body, notVerified);
    assert.deepEqual(emails, []);
  });
}

for (const emailResult of ["failed", "already_sent", "not_confirmed"] as const) {
  test(`an email result of ${emailResult} leaves the reply confirmed`, async () => {
    const { deps } = setup({ payments: [payment("completed")], emailResult });
    const { body } = await call(deps);
    assert.equal(body.status, "confirmed");
    assert.equal(body.outcome, "confirmed");
  });
}

test("an error that is not a provider failure is not turned into a reply", async () => {
  const { deps } = setup({ payments: [new TypeError("bug")] });
  await assert.rejects(handleConfirmCheckout(post({ orderId: ORDER_ID }), deps), TypeError);
});

test("the browser's preflight is answered and other methods are refused", async () => {
  const { deps } = setup();
  const preflight = await handleConfirmCheckout(
    new Request("http://localhost/confirm-checkout", { method: "OPTIONS" }),
    deps,
  );
  assert.equal(preflight.status, 200);
  assert.match(preflight.headers.get("Access-Control-Allow-Headers") ?? "", /authorization/);
  const get = await handleConfirmCheckout(
    new Request("http://localhost/confirm-checkout", { method: "GET" }),
    deps,
  );
  assert.equal(get.status, 405);
});
