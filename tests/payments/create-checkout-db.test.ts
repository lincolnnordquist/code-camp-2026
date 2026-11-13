import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  admin,
  authOptions,
  newBooth,
  stack,
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

const userIds: string[] = [];

function depsWith(
  createCheckout: PaymentProvider["createCheckout"],
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
      createCheckout,
      getPayment: unused,
      closeCheckout: unused,
      getRefund: unused,
      verifyWebhookSignature: unused,
    },
    readSecret: (name) =>
      name === "SQUARE_ACCESS_TOKEN_TEST" ? "seller-token" : undefined,
    appUrl: "https://app.test",
  };
}

async function attendeeToken(): Promise<string> {
  const client = createClient(stack.url, stack.publishableKey, authOptions);
  const { data, error } = await client.auth.signInAnonymously();
  assert.equal(error, null);
  userIds.push(data.user!.id);
  return data.session!.access_token;
}

function checkoutRequest(
  token: string,
  boothId: string,
  productId: string,
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
      requestId: randomUUID(),
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

afterEach(async () => {
  vi.restoreAllMocks();
  for (const id of userIds.splice(0)) await admin.auth.admin.deleteUser(id);
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
