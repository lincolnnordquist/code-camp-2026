import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test, vi } from "vitest";
import {
  admin,
  newAttendeeClient,
  newBooth,
  stockOf,
} from "../db/support";
import {
  type CreateCheckoutDeps,
  handleCreateCheckout,
} from "../../supabase/functions/create-checkout/handler";
import {
  type Checkout,
  type PaymentProvider,
  ProviderError,
} from "../../supabase/functions/_shared/providers/types";

function depsWith(
  createCheckout: PaymentProvider["createCheckout"],
  closeCheckout?: PaymentProvider["closeCheckout"],
): CreateCheckoutDeps {
  const unused = () => Promise.reject(new Error("not used by create-checkout"));
  return {
    async getUserId(accessToken) {
      const { data, error } = await admin.auth.getUser(accessToken);
      return error ? null : data.user.id;
    },
    async rpc(name, args) {
      const { data, error } = await admin.rpc(name, args);
      assert.equal(error, null, error?.message ?? "");
      return data;
    },
    provider: {
      webhookSignatureHeaderName: "x-test-signature",
      pendingRecheckMs: 2000,
      createCheckout,
      getPayment: unused,
      closeCheckout: closeCheckout ?? unused,
      getOrderState: unused,
      getRefund: unused,
      verifyWebhookSignature: unused,
    },
    readSecret: (name) =>
      name === "SQUARE_ACCESS_TOKEN_TEST" ? "seller-token" : undefined,
    appUrl: "https://app.test",
  };
}

async function attendeeToken(): Promise<string> {
  const { client } = await newAttendeeClient();
  const { data } = await client.auth.getSession();
  return data.session!.access_token;
}

function checkoutRequest(
  token: string,
  boothId: string,
  productId: string,
  requestId: string = randomUUID(),
) {
  return new Request("http://localhost/create-checkout", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      boothId,
      items: [{ productId, quantity: 2 }],
      email: "attendee@squareup.com",
      requestId,
    }),
  });
}

async function onlyOrderAt(boothId: string) {
  const { data } = await admin
    .from("orders")
    .select("status, checkout_link_id, provider_order_id")
    .eq("booth_id", boothId);
  assert.equal(data!.length, 1);
  return data![0];
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("a created checkout holds the stock and is stored on the order", async () => {
  const { boothId, mugId } = await newBooth();
  const link: Checkout = {
    url: "https://sandbox.square.link/u/test",
    checkoutLinkId: `LINK_${randomUUID()}`,
    providerOrderId: `ORDER_${randomUUID()}`,
  };

  const response = await handleCreateCheckout(
    checkoutRequest(await attendeeToken(), boothId, mugId),
    depsWith(() => Promise.resolve(link)),
  );
  const body = await response.json();

  assert.equal(body.ok, true, JSON.stringify(body));
  assert.equal(body.checkoutUrl, link.url);
  assert.equal(body.totalCents, 6400);
  assert.equal(await stockOf(mugId), 3);
  assert.deepEqual(await onlyOrderAt(boothId), {
    status: "pending_payment",
    checkout_link_id: link.checkoutLinkId,
    provider_order_id: link.providerOrderId,
  });
});

test("a failed Square call releases the stock right away", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { boothId, mugId } = await newBooth();

  const response = await handleCreateCheckout(
    checkoutRequest(await attendeeToken(), boothId, mugId),
    depsWith(() =>
      Promise.reject(
        new ProviderError("unavailable", "SERVICE_UNAVAILABLE", "down"),
      )
    ),
  );

  assert.deepEqual(await response.json(), {
    ok: false,
    reason: "checkout_unavailable",
  });
  assert.deepEqual(await onlyOrderAt(boothId), {
    status: "expired",
    checkout_link_id: null,
    provider_order_id: null,
  });
  assert.equal(await stockOf(mugId), 5);
});

function newLink(): Checkout {
  return {
    url: `https://sandbox.square.link/u/${randomUUID()}`,
    checkoutLinkId: `LINK_${randomUUID()}`,
    providerOrderId: `ORDER_${randomUUID()}`,
  };
}

const squareDown = () =>
  Promise.reject(new ProviderError("unavailable", "SERVICE_UNAVAILABLE", "down"));

test("a failed Square call on a retry keeps the stored link and the stock", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { boothId, mugId } = await newBooth();
  const token = await attendeeToken();
  const requestId = randomUUID();
  const link = newLink();

  const first = await handleCreateCheckout(
    checkoutRequest(token, boothId, mugId, requestId),
    depsWith(() => Promise.resolve(link)),
  );
  assert.equal((await first.json()).ok, true);

  const retry = await handleCreateCheckout(
    checkoutRequest(token, boothId, mugId, requestId),
    depsWith(squareDown),
  );

  assert.deepEqual(await retry.json(), {
    ok: false,
    reason: "checkout_unavailable",
  });
  assert.deepEqual(await onlyOrderAt(boothId), {
    status: "pending_payment",
    checkout_link_id: link.checkoutLinkId,
    provider_order_id: link.providerOrderId,
  });
  assert.equal(await stockOf(mugId), 3);
});

test("a double submit where the second call fails releases the stock and closes the first call's link", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { boothId, mugId } = await newBooth();
  const token = await attendeeToken();
  const requestId = randomUUID();
  const link = newLink();
  const closed: string[] = [];
  let squareAnswersFirst!: () => void;
  let firstReachedSquare!: () => void;
  const firstAtSquare = new Promise<void>((resolve) => {
    firstReachedSquare = resolve;
  });

  const first = handleCreateCheckout(
    checkoutRequest(token, boothId, mugId, requestId),
    depsWith(
      () =>
        new Promise<Checkout>((resolve) => {
          squareAnswersFirst = () => resolve(link);
          firstReachedSquare();
        }),
      (_connection, linkId) => {
        closed.push(linkId);
        return Promise.resolve(link.providerOrderId);
      },
    ),
  );
  await firstAtSquare;

  const second = await handleCreateCheckout(
    checkoutRequest(token, boothId, mugId, requestId),
    depsWith(squareDown),
  );
  squareAnswersFirst();

  assert.deepEqual(await second.json(), {
    ok: false,
    reason: "checkout_unavailable",
  });
  assert.deepEqual(await (await first).json(), {
    ok: false,
    reason: "checkout_unavailable",
  });
  assert.deepEqual(closed, [link.checkoutLinkId]);
  assert.deepEqual(await onlyOrderAt(boothId), {
    status: "expired",
    checkout_link_id: null,
    provider_order_id: null,
  });
  assert.equal(await stockOf(mugId), 5);
});
