import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, test, vi } from "vitest";
import { admin, call, newBooth, newUser, stockOf } from "../db/support";
import {
  type ExpireCheckoutsDeps,
  handleExpireCheckouts,
  type OverdueCheckout,
} from "../../supabase/functions/expire-checkouts/handler";
import type {
  PaymentProvider,
  ProviderPayment,
} from "../../supabase/functions/_shared/providers/types";

async function overdueCheckout(boothId: string, mugId: string) {
  const placed = await call("svc_create_pending_order", {
    p_user_id: await newUser(),
    p_booth_id: boothId,
    p_items: [{ productId: mugId, quantity: 2 }],
    p_email: "attendee@squareup.com",
    p_request_id: randomUUID(),
  });
  assert.equal(placed.ok, true, placed.reason ?? "");
  const providerOrderId = `SQ_${randomUUID()}`;
  const attached = await call("svc_attach_checkout", {
    p_order_id: placed.orderId,
    p_checkout_link_id: `LINK_${randomUUID()}`,
    p_provider_order_id: providerOrderId,
  });
  assert.equal(attached.ok, true, attached.reason ?? "");
  const { error } = await admin
    .from("orders")
    .update({ hold_ends_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", placed.orderId!);
  assert.equal(error, null, error?.message ?? "");
  return { orderId: placed.orderId!, providerOrderId, totalCents: placed.totalCents! };
}

function depsFor(
  orderIds: string[],
  provider: Partial<PaymentProvider>,
): ExpireCheckoutsDeps {
  const unused = () => Promise.reject(new Error("not used"));
  return {
    serviceKey: "service-key",
    async rpc(name, args) {
      const { data, error } = await admin.rpc(name, args);
      assert.equal(error, null, error?.message ?? "");
      // The list holds every overdue order in the database, including those of
      // test files running in parallel, so the run only sees this test's orders.
      if (name === "svc_list_overdue_checkouts") {
        const orders = (data as { orders: OverdueCheckout[] }).orders;
        return { ...data, orders: orders.filter((o) => orderIds.includes(o.orderId)) };
      }
      return data;
    },
    provider: {
      webhookSignatureHeaderName: "x-test-signature",
      pendingRecheckMs: 2000,
      createCheckout: unused,
      getPayment: () => Promise.resolve(null),
      closeCheckout: unused,
      getOrderState: unused,
      getRefund: unused,
      verifyWebhookSignature: unused,
      parseWebhookEvent: () => {
        throw new Error("not used");
      },
      ...provider,
    },
    readSecret: (name) =>
      name === "SQUARE_ACCESS_TOKEN_TEST" ? "seller-token" : undefined,
    email: { sendConfirmation: () => Promise.resolve("sent") },
  };
}

function run(deps: ExpireCheckoutsDeps) {
  return handleExpireCheckouts(
    new Request("http://localhost/expire-checkouts", {
      method: "POST",
      headers: { Authorization: "Bearer service-key" },
    }),
    deps,
  );
}

async function statusOf(orderId: string): Promise<string> {
  const { data } = await admin.from("orders").select("status").eq("id", orderId)
    .single();
  return data!.status as string;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("an overdue unpaid checkout is expired and its stock returns", async () => {
  const { boothId, mugId } = await newBooth();
  const order = await overdueCheckout(boothId, mugId);
  assert.equal(await stockOf(mugId), 3);

  const body = await (await run(depsFor([order.orderId], {
    closeCheckout: () => Promise.resolve(order.providerOrderId),
  }))).json();

  assert.equal(body.expired, 1, JSON.stringify(body));
  assert.equal(await statusOf(order.orderId), "expired");
  assert.equal(await stockOf(mugId), 5);
});

test("an overdue checkout whose link an earlier run deleted is expired once Square shows the order cancelled", async () => {
  const { boothId, mugId } = await newBooth();
  const order = await overdueCheckout(boothId, mugId);

  const body = await (await run(depsFor([order.orderId], {
    closeCheckout: () => Promise.resolve(null),
    getOrderState: () => Promise.resolve("cancelled"),
  }))).json();

  assert.equal(body.expired, 1, JSON.stringify(body));
  assert.equal(await statusOf(order.orderId), "expired");
  assert.equal(await stockOf(mugId), 5);
});

test("an overdue paid checkout is confirmed, keeps its stock, and records its payment once", async () => {
  const { boothId, mugId } = await newBooth();
  const order = await overdueCheckout(boothId, mugId);
  const lookedUp: string[] = [];
  const paid: ProviderPayment = {
    id: `PAY_${randomUUID()}`,
    providerOrderId: order.providerOrderId,
    status: "completed",
    amountCents: order.totalCents,
    currency: "USD",
    sellerLocationId: "LOCATION_TEST",
  };

  const body = await (await run(depsFor([order.orderId], {
    getPayment(_connection, providerOrderId) {
      lookedUp.push(providerOrderId);
      return Promise.resolve(paid);
    },
  }))).json();

  assert.deepEqual(lookedUp, [order.providerOrderId]);
  assert.equal(body.confirmed, 1, JSON.stringify(body));
  assert.equal(await statusOf(order.orderId), "confirmed");
  assert.equal(await stockOf(mugId), 3);
  const { data: payments } = await admin
    .from("payments")
    .select("provider_payment_id, refund_status")
    .eq("order_id", order.orderId);
  assert.deepEqual(payments, [
    { provider_payment_id: paid.id, refund_status: "none" },
  ]);
});
