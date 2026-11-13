import assert from "node:assert/strict";
import { test } from "vitest";
import { createSquareProvider } from "../../supabase/functions/_shared/providers/square";
import {
  type CreateCheckoutInput,
  ProviderError,
  type SellerConnection,
} from "../../supabase/functions/_shared/providers/types";

type RecordedCall = {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
};

function stubFetch(...replies: { status: number; body: unknown }[]) {
  const calls: RecordedCall[] = [];
  const fetchStub: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: headers.get("Authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const reply = replies[calls.length - 1];
    const text = typeof reply.body === "string"
      ? reply.body
      : JSON.stringify(reply.body);
    return Promise.resolve(new Response(text, { status: reply.status }));
  };
  return { fetchStub, calls };
}

const connection: SellerConnection = {
  accessToken: "test-token",
  locationId: "LOCATION_A",
};

const checkoutInput: CreateCheckoutInput = {
  connection,
  lineItems: [
    { name: "Enamel pin", quantity: 2, unitPriceCents: 350 },
    { name: "Sticker", quantity: 1, unitPriceCents: 125 },
  ],
  currency: "USD",
  returnUrl: "https://app.example.test/orders/ORDER_ID",
  buyerEmail: "buyer@mail.example.test",
  idempotencyKey: "our-order-id",
};

const paymentLinkReply = {
  payment_link: {
    id: "LINK_1",
    version: 1,
    order_id: "ORDER_1",
    url: "https://sandbox.square.link/u/abc",
  },
};

const paidOrderReply = {
  order: {
    id: "ORDER_1",
    location_id: "LOCATION_A",
    state: "OPEN",
    tenders: [{
      id: "PAYMENT_1",
      type: "THIRD_PARTY_CARD",
      payment_id: "PAYMENT_1",
    }],
  },
};

function paymentReply(status: string) {
  return {
    payment: {
      id: "PAYMENT_1",
      status,
      source_type: "EXTERNAL",
      location_id: "LOCATION_A",
      order_id: "ORDER_1",
      amount_money: { amount: 825, currency: "USD" },
      total_money: { amount: 825, currency: "USD" },
    },
  };
}

function squareError(code: string, detail: string) {
  return { errors: [{ category: "INVALID_REQUEST_ERROR", code, detail }] };
}

async function assertProviderError(
  call: Promise<unknown>,
  reason: string,
  providerCode: string,
) {
  await assert.rejects(call, (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.reason, reason);
    assert.equal(error.providerCode, providerCode);
    return true;
  });
}

test("createCheckout sends the order, return address, buyer email and idempotency key to the sandbox", async () => {
  const { fetchStub, calls } = stubFetch({
    status: 200,
    body: paymentLinkReply,
  });
  const provider = createSquareProvider("sandbox", fetchStub);

  const checkout = await provider.createCheckout(checkoutInput);

  assert.deepEqual(checkout, {
    url: "https://sandbox.square.link/u/abc",
    checkoutLinkId: "LINK_1",
    providerOrderId: "ORDER_1",
  });
  assert.deepEqual(calls, [{
    url: "https://connect.squareupsandbox.com/v2/online-checkout/payment-links",
    method: "POST",
    authorization: "Bearer test-token",
    body: {
      idempotency_key: "our-order-id",
      order: {
        location_id: "LOCATION_A",
        line_items: [
          {
            name: "Enamel pin",
            quantity: "2",
            base_price_money: { amount: 350, currency: "USD" },
          },
          {
            name: "Sticker",
            quantity: "1",
            base_price_money: { amount: 125, currency: "USD" },
          },
        ],
      },
      checkout_options: {
        redirect_url: "https://app.example.test/orders/ORDER_ID",
      },
      pre_populated_data: { buyer_email: "buyer@mail.example.test" },
    },
  }]);
});

test("the production environment calls the production address", async () => {
  const { fetchStub, calls } = stubFetch({
    status: 200,
    body: paymentLinkReply,
  });

  await createSquareProvider("production", fetchStub).createCheckout(
    checkoutInput,
  );

  assert.equal(
    calls[0].url,
    "https://connect.squareup.com/v2/online-checkout/payment-links",
  );
});

test("createCheckout reports an email address that Square refuses as invalid_buyer_email", async () => {
  const { fetchStub } = stubFetch({
    status: 400,
    body: squareError("INVALID_EMAIL_ADDRESS", "Invalid email address."),
  });

  await assertProviderError(
    createSquareProvider("sandbox", fetchStub).createCheckout(checkoutInput),
    "invalid_buyer_email",
    "INVALID_EMAIL_ADDRESS",
  );
});

test("createCheckout reports an idempotency key reused with a different order as rejected", async () => {
  const { fetchStub } = stubFetch({
    status: 400,
    body: squareError(
      "IDEMPOTENCY_KEY_REUSED",
      "This idempotency key has already been used to create a Payment Link",
    ),
  });

  await assertProviderError(
    createSquareProvider("sandbox", fetchStub).createCheckout(checkoutInput),
    "rejected",
    "IDEMPOTENCY_KEY_REUSED",
  );
});

test("createCheckout reports a reply without a payment link as unavailable", async () => {
  const { fetchStub } = stubFetch({ status: 200, body: {} });

  await assertProviderError(
    createSquareProvider("sandbox", fetchStub).createCheckout(checkoutInput),
    "unavailable",
    "UNEXPECTED_REPLY",
  );
});

test("getPayment returns null for an order with no tender and does not request a payment", async () => {
  const { fetchStub, calls } = stubFetch({
    status: 200,
    body: { order: { id: "ORDER_1", state: "DRAFT" } },
  });

  const payment = await createSquareProvider("sandbox", fetchStub).getPayment(
    connection,
    "ORDER_1",
  );

  assert.equal(payment, null);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    "GET https://connect.squareupsandbox.com/v2/orders/ORDER_1",
  ]);
});

test("getPayment reads the payment named by the tender of an OPEN order", async () => {
  const { fetchStub, calls } = stubFetch(
    { status: 200, body: paidOrderReply },
    { status: 200, body: paymentReply("COMPLETED") },
  );

  const payment = await createSquareProvider("sandbox", fetchStub).getPayment(
    connection,
    "ORDER_1",
  );

  assert.deepEqual(payment, {
    id: "PAYMENT_1",
    providerOrderId: "ORDER_1",
    status: "completed",
    amountCents: 825,
    currency: "USD",
    sellerLocationId: "LOCATION_A",
  });
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    "GET https://connect.squareupsandbox.com/v2/orders/ORDER_1",
    "GET https://connect.squareupsandbox.com/v2/payments/PAYMENT_1",
  ]);
  assert.equal(calls[1].authorization, "Bearer test-token");
});

for (
  const [squareStatus, status] of [
    ["APPROVED", "pending"],
    ["PENDING", "pending"],
    ["CANCELED", "cancelled"],
    ["FAILED", "failed"],
  ]
) {
  test(`getPayment maps the Square payment status ${squareStatus} to ${status}`, async () => {
    const { fetchStub } = stubFetch(
      { status: 200, body: paidOrderReply },
      { status: 200, body: paymentReply(squareStatus) },
    );

    const payment = await createSquareProvider("sandbox", fetchStub)
      .getPayment(connection, "ORDER_1");

    assert.equal(payment?.status, status);
  });
}

test("getPayment reports a payment status it does not recognise as unavailable", async () => {
  const { fetchStub } = stubFetch(
    { status: 200, body: paidOrderReply },
    { status: 200, body: paymentReply("SOMETHING_NEW") },
  );

  await assertProviderError(
    createSquareProvider("sandbox", fetchStub).getPayment(
      connection,
      "ORDER_1",
    ),
    "unavailable",
    "UNEXPECTED_REPLY",
  );
});

test("getPayment reports an order Square does not have as not_found", async () => {
  const { fetchStub } = stubFetch({
    status: 404,
    body: squareError("NOT_FOUND", "Order not found for id ORDER_1"),
  });

  await assertProviderError(
    createSquareProvider("sandbox", fetchStub).getPayment(
      connection,
      "ORDER_1",
    ),
    "not_found",
    "NOT_FOUND",
  );
});

test("a Square server error with a body that is not JSON is reported as unavailable", async () => {
  const { fetchStub } = stubFetch({ status: 502, body: "<html>Bad Gateway" });

  await assertProviderError(
    createSquareProvider("sandbox", fetchStub).getPayment(
      connection,
      "ORDER_1",
    ),
    "unavailable",
    "HTTP_502",
  );
});

test("a rejected access token is reported as rejected", async () => {
  const { fetchStub } = stubFetch({
    status: 401,
    body: {
      errors: [{
        category: "AUTHENTICATION_ERROR",
        code: "UNAUTHORIZED",
        detail: "This request could not be authorized.",
      }],
    },
  });

  await assertProviderError(
    createSquareProvider("sandbox", fetchStub).getPayment(
      connection,
      "ORDER_1",
    ),
    "rejected",
    "UNAUTHORIZED",
  );
});

test("a request that never reaches Square is reported as unavailable", async () => {
  const failingFetch: typeof fetch = () =>
    Promise.reject(new TypeError("connection refused"));

  await assertProviderError(
    createSquareProvider("sandbox", failingFetch).getPayment(
      connection,
      "ORDER_1",
    ),
    "unavailable",
    "NETWORK_ERROR",
  );
});

test("closeCheckout returns the order id Square cancelled for an unpaid link", async () => {
  const { fetchStub, calls } = stubFetch({
    status: 200,
    body: { id: "LINK_1", cancelled_order_id: "ORDER_1" },
  });

  const cancelled = await createSquareProvider("sandbox", fetchStub)
    .closeCheckout(connection, "LINK_1");

  assert.equal(cancelled, "ORDER_1");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    "DELETE https://connect.squareupsandbox.com/v2/online-checkout/payment-links/LINK_1",
  ]);
});

test("closeCheckout returns null when Square names no cancelled order", async () => {
  const { fetchStub } = stubFetch({ status: 200, body: { id: "LINK_1" } });

  const cancelled = await createSquareProvider("sandbox", fetchStub)
    .closeCheckout(connection, "LINK_1");

  assert.equal(cancelled, null);
});

test("getRefund returns the status, payment id and amount of a completed refund", async () => {
  const { fetchStub, calls } = stubFetch({
    status: 200,
    body: {
      refund: {
        id: "REFUND_1",
        status: "COMPLETED",
        payment_id: "PAYMENT_1",
        order_id: "ORDER_1",
        location_id: "LOCATION_A",
        amount_money: { amount: 825, currency: "USD" },
      },
    },
  });

  const refund = await createSquareProvider("sandbox", fetchStub).getRefund(
    connection,
    "REFUND_1",
  );

  assert.deepEqual(refund, {
    status: "completed",
    paymentId: "PAYMENT_1",
    amountCents: 825,
    currency: "USD",
  });
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    "GET https://connect.squareupsandbox.com/v2/refunds/REFUND_1",
  ]);
});

for (
  const [squareStatus, status] of [
    ["PENDING", "pending"],
    ["REJECTED", "rejected"],
    ["FAILED", "failed"],
  ]
) {
  test(`getRefund maps the Square refund status ${squareStatus} to ${status}`, async () => {
    const { fetchStub } = stubFetch({
      status: 200,
      body: {
        refund: {
          id: "REFUND_1",
          status: squareStatus,
          payment_id: "PAYMENT_1",
          amount_money: { amount: 825, currency: "USD" },
        },
      },
    });

    const refund = await createSquareProvider("sandbox", fetchStub).getRefund(
      connection,
      "REFUND_1",
    );

    assert.equal(refund.status, status);
  });
}

test("getRefund reports a refund id Square does not accept as rejected", async () => {
  const { fetchStub } = stubFetch({
    status: 400,
    body: squareError("INVALID_VALUE", "Invalid refund_id: REFUND_1"),
  });

  await assertProviderError(
    createSquareProvider("sandbox", fetchStub).getRefund(
      connection,
      "REFUND_1",
    ),
    "rejected",
    "INVALID_VALUE",
  );
});
