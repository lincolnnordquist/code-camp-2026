import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import {
  type CreateCheckoutDeps,
  handleCreateCheckout,
} from "../../supabase/functions/create-checkout/handler";
import {
  type Checkout,
  type CreateCheckoutInput,
  type PaymentProvider,
  ProviderError,
} from "../../supabase/functions/_shared/providers/types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BOOTH_ID = "b0000000-0000-0000-0000-00000000000b";
const PRODUCT_ID = "c0000000-0000-0000-0000-000000000001";
const ORDER_ID = "0a000000-0000-4000-8000-000000000001";

const requestBody = {
  boothId: BOOTH_ID,
  items: [{ productId: PRODUCT_ID, quantity: 2 }],
  email: "attendee@squareup.com",
  requestId: "request-1",
};

function pendingOrder(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    orderId: ORDER_ID,
    boothId: BOOTH_ID,
    boothCode: "B4",
    type: "prepaid",
    status: "pending_payment",
    pickupCode: "K7Q2",
    holdEndsAt: "2026-11-13T21:15:00Z",
    totalCents: 3600,
    currency: "USD",
    buyerEmail: "attendee@squareup.com",
    items: [
      { productId: PRODUCT_ID, name: "Mug", quantity: 2, unitPriceCents: 1800 },
    ],
    checkoutLinkId: null,
    providerOrderId: null,
    connection: {
      tokenSecretName: "SQUARE_ACCESS_TOKEN_VENDOR_A",
      locationId: "LOCATION_A",
    },
    ...overrides,
  };
}

const checkout: Checkout = {
  url: "https://sandbox.square.link/u/abc",
  checkoutLinkId: "LINK_1",
  providerOrderId: "SQUARE_ORDER_1",
};

type Setup = {
  userId?: string | null;
  replies?: Record<string, unknown>;
  createCheckout?: (input: CreateCheckoutInput) => Promise<Checkout>;
  closeCheckout?: PaymentProvider["closeCheckout"];
  secrets?: Record<string, string>;
};

function setup(options: Setup = {}) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const checkoutCalls: CreateCheckoutInput[] = [];
  const replies: Record<string, unknown> = {
    svc_create_pending_order: pendingOrder(),
    svc_attach_checkout: { ok: true },
    svc_release_checkout: { ok: true, changed: true },
    ...options.replies,
  };
  const unused = () => Promise.reject(new Error("not used by create-checkout"));
  const provider: PaymentProvider = {
    webhookSignatureHeaderName: "x-test-signature",
    createCheckout(input) {
      checkoutCalls.push(input);
      return options.createCheckout?.(input) ?? Promise.resolve(checkout);
    },
    getPayment: unused,
    closeCheckout: options.closeCheckout ?? unused,
    getOrderState: unused,
    getRefund: unused,
    verifyWebhookSignature: unused,
  };
  const secrets = options.secrets ??
    { SQUARE_ACCESS_TOKEN_VENDOR_A: "seller-token" };
  const deps: CreateCheckoutDeps = {
    getUserId: (token) =>
      Promise.resolve(
        token === "valid-session"
          ? options.userId === undefined ? USER_ID : options.userId
          : null,
      ),
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve(replies[name]);
    },
    provider,
    readSecret: (name) => secrets[name],
    appUrl: "https://app.test/",
  };
  return { deps, rpcCalls, checkoutCalls };
}

function post(body: unknown, token: string | null = "valid-session") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/create-checkout", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function call(request: Request, deps: CreateCheckoutDeps) {
  const response = await handleCreateCheckout(request, deps);
  return { status: response.status, body: await response.json() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("a request without a session is refused before any order is created", async () => {
  const { deps, rpcCalls, checkoutCalls } = setup();
  for (const token of [null, "expired-session"]) {
    const { status, body } = await call(post(requestBody, token), deps);
    assert.equal(status, 401);
    assert.deepEqual(body, { ok: false, reason: "not_signed_in" });
  }
  assert.equal(rpcCalls.length, 0);
  assert.equal(checkoutCalls.length, 0);
});

test("a malformed body is refused before any order is created", async () => {
  const { deps, rpcCalls } = setup();
  const malformed = [
    "not json",
    { ...requestBody, boothId: "B4" },
    { ...requestBody, items: [{ productId: PRODUCT_ID, quantity: "2" }] },
    { ...requestBody, requestId: "" },
    { ...requestBody, email: undefined },
  ];
  for (const body of malformed) {
    const reply = await call(post(body), deps);
    assert.equal(reply.status, 400);
    assert.equal(reply.body.reason, "invalid_request");
  }
  assert.equal(rpcCalls.length, 0);
});

test("a refusal from the database is returned and Square is not called", async () => {
  const { deps, checkoutCalls } = setup({
    replies: {
      svc_create_pending_order: {
        ok: false,
        reason: "insufficient_stock",
        productIds: [PRODUCT_ID],
      },
    },
  });
  const { status, body } = await call(post(requestBody), deps);
  assert.equal(status, 200);
  assert.deepEqual(body, {
    ok: false,
    reason: "insufficient_stock",
    productIds: [PRODUCT_ID],
  });
  assert.equal(checkoutCalls.length, 0);
});

test("a checkout is created from the server's order and attached to it", async () => {
  const { deps, rpcCalls, checkoutCalls } = setup();
  const { status, body } = await call(post(requestBody), deps);

  assert.equal(status, 200);
  assert.deepEqual(rpcCalls[0], {
    name: "svc_create_pending_order",
    args: {
      p_user_id: USER_ID,
      p_booth_id: BOOTH_ID,
      p_items: requestBody.items,
      p_email: requestBody.email,
      p_request_id: requestBody.requestId,
    },
  });
  assert.deepEqual(checkoutCalls, [{
    connection: { accessToken: "seller-token", locationId: "LOCATION_A" },
    lineItems: [{ name: "Mug", quantity: 2, unitPriceCents: 1800 }],
    currency: "USD",
    returnUrl: `https://app.test/orders/${ORDER_ID}`,
    buyerEmail: "attendee@squareup.com",
    idempotencyKey: ORDER_ID,
  }]);
  assert.deepEqual(rpcCalls[1], {
    name: "svc_attach_checkout",
    args: {
      p_order_id: ORDER_ID,
      p_checkout_link_id: "LINK_1",
      p_provider_order_id: "SQUARE_ORDER_1",
    },
  });
  assert.equal(rpcCalls.length, 2);

  assert.equal(body.ok, true);
  assert.equal(body.orderId, ORDER_ID);
  assert.equal(body.status, "pending_payment");
  assert.equal(body.totalCents, 3600);
  assert.equal(body.checkoutUrl, checkout.url);
  assert.equal(body.boothCode, "B4");
  for (const internal of ["connection", "checkoutLinkId", "providerOrderId"]) {
    assert.equal(internal in body, false, `${internal} is not returned`);
  }
});

test("a repeated request for an order with a link returns the same link", async () => {
  const { deps, rpcCalls, checkoutCalls } = setup({
    replies: {
      svc_create_pending_order: pendingOrder({
        checkoutLinkId: "LINK_1",
        providerOrderId: "SQUARE_ORDER_1",
      }),
    },
  });
  const { body } = await call(post(requestBody), deps);
  assert.equal(body.ok, true);
  assert.equal(body.checkoutUrl, checkout.url);
  assert.equal(checkoutCalls[0].idempotencyKey, ORDER_ID);
  assert.equal(rpcCalls[1].name, "svc_attach_checkout");
});

test("a repeated request for an order that is no longer pending is refused", async () => {
  const { deps, rpcCalls, checkoutCalls } = setup({
    replies: {
      svc_create_pending_order: pendingOrder({ status: "expired" }),
    },
  });
  const { body } = await call(post(requestBody), deps);
  assert.deepEqual(body, { ok: false, reason: "checkout_unavailable" });
  assert.equal(checkoutCalls.length, 0);
  assert.equal(rpcCalls.length, 1);
});

const providerFailures = [
  { reason: "invalid_buyer_email", code: "INVALID_EMAIL_ADDRESS", returned: "invalid_email" },
  { reason: "unavailable", code: "SERVICE_UNAVAILABLE", returned: "checkout_unavailable" },
  { reason: "rejected", code: "UNAUTHORIZED", returned: "checkout_unavailable" },
  { reason: "not_found", code: "NOT_FOUND", returned: "checkout_unavailable" },
] as const;

for (const failure of providerFailures) {
  test(`a provider failure (${failure.reason}) releases the hold and returns ${failure.returned}`, async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, rpcCalls } = setup({
      createCheckout: () =>
        Promise.reject(new ProviderError(failure.reason, failure.code, "refused")),
    });
    const { status, body } = await call(post(requestBody), deps);

    assert.equal(status, 200);
    assert.deepEqual(body, { ok: false, reason: failure.returned });
    assert.deepEqual(rpcCalls.map((c) => c.name), [
      "svc_create_pending_order",
      "svc_release_checkout",
    ]);
    assert.deepEqual(rpcCalls[1].args, {
      p_order_id: ORDER_ID,
      p_provider_order_id: null,
    });
    assert.ok(
      logged.mock.calls.some(([line]) => String(line).includes(failure.code)),
      "Square's own error code is logged",
    );
  });
}

test("a failed retry for an order with a link still returns the refusal", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { deps } = setup({
    createCheckout: () =>
      Promise.reject(new ProviderError("unavailable", "HTTP_503", "down")),
    replies: {
      svc_create_pending_order: pendingOrder({
        checkoutLinkId: "LINK_1",
        providerOrderId: "SQUARE_ORDER_1",
      }),
      svc_release_checkout: { ok: false, reason: "provider_order_mismatch" },
    },
  });
  const { body } = await call(post(requestBody), deps);
  assert.deepEqual(body, { ok: false, reason: "checkout_unavailable" });
});

test("an error that is not a provider failure is not turned into a refusal", async () => {
  const { deps, rpcCalls } = setup({
    createCheckout: () => Promise.reject(new TypeError("bug")),
  });
  await assert.rejects(handleCreateCheckout(post(requestBody), deps), TypeError);
  assert.equal(rpcCalls.length, 1);
});

test("a missing seller token releases the hold and returns checkout_unavailable", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { deps, rpcCalls, checkoutCalls } = setup({ secrets: {} });
  const { body } = await call(post(requestBody), deps);
  assert.deepEqual(body, { ok: false, reason: "checkout_unavailable" });
  assert.equal(checkoutCalls.length, 0);
  assert.equal(rpcCalls[1].name, "svc_release_checkout");
});

test("a link created for an order released meanwhile is closed and not returned", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const closed: { connection: unknown; linkId: string }[] = [];
  const { deps } = setup({
    replies: {
      svc_attach_checkout: { ok: false, reason: "not_pending", status: "expired" },
    },
    closeCheckout(connection, linkId) {
      closed.push({ connection, linkId });
      return Promise.resolve("SQUARE_ORDER_1");
    },
  });
  const { body } = await call(post(requestBody), deps);
  assert.deepEqual(body, { ok: false, reason: "checkout_unavailable" });
  assert.deepEqual(closed, [{
    connection: { accessToken: "seller-token", locationId: "LOCATION_A" },
    linkId: "LINK_1",
  }]);
});

test("a link the database refuses to attach is closed and not returned", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const closed: string[] = [];
  const { deps } = setup({
    replies: { svc_attach_checkout: { ok: false, reason: "already_attached" } },
    closeCheckout(_connection, linkId) {
      closed.push(linkId);
      return Promise.resolve(null);
    },
  });
  const { body } = await call(post(requestBody), deps);
  assert.deepEqual(body, { ok: false, reason: "checkout_unavailable" });
  assert.deepEqual(closed, ["LINK_1"]);
});

test("a link is closed when attaching it fails with an error", async () => {
  const closed: string[] = [];
  const { deps } = setup({
    closeCheckout(_connection, linkId) {
      closed.push(linkId);
      return Promise.resolve(null);
    },
  });
  deps.rpc = (name) =>
    name === "svc_attach_checkout"
      ? Promise.reject(new Error("database unreachable"))
      : Promise.resolve(pendingOrder());
  await assert.rejects(
    handleCreateCheckout(post(requestBody), deps),
    /database unreachable/,
  );
  assert.deepEqual(closed, ["LINK_1"]);
});

test("the browser's preflight request is answered without a session", async () => {
  const { deps } = setup();
  const response = await handleCreateCheckout(
    new Request("http://localhost/create-checkout", { method: "OPTIONS" }),
    deps,
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("Access-Control-Allow-Headers") ?? "",
    /authorization/,
  );
});
