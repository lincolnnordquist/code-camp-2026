import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, test, vi } from "vitest";
import { admin, call, newAttendeeClient, newBooth, stockOf } from "../db/support";
import {
  type ConfirmCheckoutDeps,
  handleConfirmCheckout,
} from "../../supabase/functions/confirm-checkout/handler";
import type {
  PaymentProvider,
  ProviderPayment,
} from "../../supabase/functions/_shared/providers/types";

async function attendee() {
  const { client, userId } = await newAttendeeClient();
  const { data } = await client.auth.getSession();
  return { userId, token: data.session!.access_token };
}

async function pendingCheckout(userId: string, boothId: string, mugId: string) {
  const placed = await call("svc_create_pending_order", {
    p_user_id: userId,
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
  return {
    orderId: placed.orderId!,
    providerOrderId,
    totalCents: placed.totalCents!,
  };
}

function paidWith(
  order: { providerOrderId: string; totalCents: number },
  overrides: Partial<ProviderPayment> = {},
): ProviderPayment {
  return {
    id: `PAY_${randomUUID()}`,
    providerOrderId: order.providerOrderId,
    status: "completed",
    amountCents: order.totalCents,
    currency: "USD",
    sellerLocationId: "LOCATION_TEST",
    ...overrides,
  };
}

function depsWith(payment: ProviderPayment | null) {
  const squareCalls: string[] = [];
  const emails: [string, string | null][] = [];
  const unused = () => Promise.reject(new Error("not used"));
  const provider: PaymentProvider = {
    webhookSignatureHeaderName: "x-test-signature",
    pendingRecheckMs: 2000,
    createCheckout: unused,
    getPayment(_connection, providerOrderId) {
      squareCalls.push(providerOrderId);
      return Promise.resolve(payment);
    },
    closeCheckout: unused,
    getOrderState: unused,
    getRefund: unused,
    verifyWebhookSignature: unused,
  };
  const deps: ConfirmCheckoutDeps = {
    async getUserId(accessToken) {
      const { data, error } = await admin.auth.getUser(accessToken);
      return error ? null : data.user.id;
    },
    async rpc(name, args) {
      const { data, error } = await admin.rpc(name, args);
      assert.equal(error, null, error?.message ?? "");
      return data;
    },
    provider,
    readSecret: (name) =>
      name === "SQUARE_ACCESS_TOKEN_TEST" ? "seller-token" : undefined,
    email: {
      sendConfirmation(orderId, userId) {
        emails.push([orderId, userId]);
        return Promise.resolve("sent");
      },
    },
    wait: () => Promise.resolve(),
  };
  return { deps, squareCalls, emails };
}

async function confirm(deps: ConfirmCheckoutDeps, token: string, orderId: string) {
  const response = await handleConfirmCheckout(
    new Request("http://localhost/confirm-checkout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    }),
    deps,
  );
  return response.json();
}

async function orderRow(orderId: string) {
  const { data } = await admin.from("orders").select("status").eq("id", orderId).single();
  return data!.status as string;
}

async function paymentRows(orderId: string) {
  const { data } = await admin
    .from("payments")
    .select("provider_payment_id, refund_status")
    .eq("order_id", orderId);
  return data ?? [];
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("two return-page calls at the same moment confirm the order once", async () => {
  const { boothId, mugId } = await newBooth();
  const { userId, token } = await attendee();
  const order = await pendingCheckout(userId, boothId, mugId);
  const paid = paidWith(order);
  const { deps, emails } = depsWith(paid);

  const replies = await Promise.all([
    confirm(deps, token, order.orderId),
    confirm(deps, token, order.orderId),
  ]);

  for (const reply of replies) {
    assert.equal(reply.ok, true, JSON.stringify(reply));
    assert.equal(reply.status, "confirmed");
  }
  assert.equal(await orderRow(order.orderId), "confirmed");
  assert.deepEqual(await paymentRows(order.orderId), [
    { provider_payment_id: paid.id, refund_status: "none" },
  ]);
  assert.equal(await stockOf(mugId), 3);
  assert.ok(emails.length >= 1);
  assert.ok(emails.every(([id, user]) => id === order.orderId && user === userId));
});

test("a later call for a confirmed order calls neither Square nor the confirm function", async () => {
  const { boothId, mugId } = await newBooth();
  const { userId, token } = await attendee();
  const order = await pendingCheckout(userId, boothId, mugId);
  const first = depsWith(paidWith(order));
  assert.equal((await confirm(first.deps, token, order.orderId)).status, "confirmed");

  const later = depsWith(paidWith(order));
  const reply = await confirm(later.deps, token, order.orderId);

  assert.deepEqual(reply, {
    ok: true,
    orderId: order.orderId,
    status: "confirmed",
    outcome: "unchanged",
  });
  assert.deepEqual(later.squareCalls, []);
  assert.equal((await paymentRows(order.orderId)).length, 1);
});

test("a payment for another amount leaves the order pending and records nothing", async () => {
  const { boothId, mugId } = await newBooth();
  const { userId, token } = await attendee();
  const order = await pendingCheckout(userId, boothId, mugId);
  const { deps, emails } = depsWith(paidWith(order, { amountCents: order.totalCents - 1 }));

  const reply = await confirm(deps, token, order.orderId);

  assert.deepEqual(reply, { ok: false, reason: "payment_not_verified" });
  assert.equal(await orderRow(order.orderId), "pending_payment");
  assert.deepEqual(await paymentRows(order.orderId), []);
  assert.deepEqual(emails, []);
});

test("a payment for an expired order leaves it expired and is recorded as refund due", async () => {
  const { boothId, mugId } = await newBooth();
  const { userId, token } = await attendee();
  const order = await pendingCheckout(userId, boothId, mugId);
  const { error } = await admin
    .from("orders")
    .update({ hold_ends_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", order.orderId);
  assert.equal(error, null, error?.message ?? "");
  const expired = await call("svc_expire_checkout", {
    p_order_id: order.orderId,
    p_provider_order_id: order.providerOrderId,
  });
  assert.equal(expired.changed, true);
  const paid = paidWith(order);
  const { deps, emails } = depsWith(paid);

  const reply = await confirm(deps, token, order.orderId);

  assert.deepEqual(reply, {
    ok: true,
    orderId: order.orderId,
    status: "expired",
    outcome: "refund_due",
  });
  assert.equal(await orderRow(order.orderId), "expired");
  assert.equal(await stockOf(mugId), 5);
  assert.deepEqual(await paymentRows(order.orderId), [
    { provider_payment_id: paid.id, refund_status: "due" },
  ]);
  const { data: details } = await admin
    .from("order_details")
    .select("refund_status")
    .eq("id", order.orderId)
    .single();
  assert.equal(details!.refund_status, "due");
  assert.deepEqual(emails, []);
});

test("another attendee's session cannot confirm or see the order", async () => {
  const { boothId, mugId } = await newBooth();
  const owner = await attendee();
  const stranger = await attendee();
  const order = await pendingCheckout(owner.userId, boothId, mugId);
  const { deps, squareCalls } = depsWith(paidWith(order));

  const reply = await confirm(deps, stranger.token, order.orderId);

  assert.deepEqual(reply, { ok: false, reason: "order_not_found" });
  assert.deepEqual(squareCalls, []);
  assert.equal(await orderRow(order.orderId), "pending_payment");
});
