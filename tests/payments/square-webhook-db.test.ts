import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, test, vi } from "vitest";
import { admin, call, newAttendeeClient, newBooth, stockOf } from "../db/support";
import {
  handleSquareWebhook,
  type SquareWebhookDeps,
} from "../../supabase/functions/square-webhook/handler";
import {
  type ConfirmCheckoutDeps,
  handleConfirmCheckout,
} from "../../supabase/functions/confirm-checkout/handler";
import {
  type ExpireCheckoutsDeps,
  handleExpireCheckouts,
  type OverdueCheckout,
} from "../../supabase/functions/expire-checkouts/handler";
import { createSquareProvider } from "../../supabase/functions/_shared/providers/square";
import type {
  PaymentProvider,
  ProviderPayment,
  RefundStatus,
} from "../../supabase/functions/_shared/providers/types";

const SIGNATURE_KEY = "test-signature-key";
const NOTIFICATION_URL = "https://functions.example.test/square-webhook";
const square = createSquareProvider("sandbox");

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

function paidWith(order: { providerOrderId: string; totalCents: number }): ProviderPayment {
  return {
    id: `PAY_${randomUUID()}`,
    providerOrderId: order.providerOrderId,
    status: "completed",
    amountCents: order.totalCents,
    currency: "USD",
    sellerLocationId: "LOCATION_TEST",
  };
}

function stubProvider(
  payment: ProviderPayment,
  refundStatus: RefundStatus = "completed",
  refundCents: Record<string, number> = {},
): PaymentProvider {
  const unused = () => Promise.reject(new Error("not used"));
  return {
    webhookSignatureHeaderName: square.webhookSignatureHeaderName,
    pendingRecheckMs: 2000,
    createCheckout: unused,
    getPayment: () => Promise.resolve(payment),
    closeCheckout: unused,
    getOrderState: unused,
    getRefund: (_connection, refundId) =>
      Promise.resolve({
        status: refundStatus,
        paymentId: payment.id,
        amountCents: refundCents[refundId] ?? payment.amountCents,
        currency: payment.currency,
      }),
    verifyWebhookSignature: square.verifyWebhookSignature,
    parseWebhookEvent: square.parseWebhookEvent,
  };
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  assert.equal(error, null, error?.message ?? "");
  return data;
}

function webhookDeps(payment: ProviderPayment) {
  const emails: [string, string | null][] = [];
  const deps: SquareWebhookDeps = {
    rpc,
    provider: stubProvider(payment),
    readSecret: (name) =>
      name === "SQUARE_ACCESS_TOKEN_TEST" ? "seller-token" : undefined,
    email: {
      sendConfirmation(orderId, userId) {
        emails.push([orderId, userId]);
        return Promise.resolve("sent");
      },
    },
    signatureKey: SIGNATURE_KEY,
    notificationUrl: NOTIFICATION_URL,
  };
  return { deps, emails };
}

function signed(body: string): Request {
  const signature = createHmac("sha256", SIGNATURE_KEY)
    .update(NOTIFICATION_URL + body)
    .digest("base64");
  return new Request("http://localhost/square-webhook", {
    method: "POST",
    headers: { "x-square-hmacsha256-signature": signature },
    body,
  });
}

function refundMessage(type: string, payment: ProviderPayment, refundId: string): Request {
  return signed(JSON.stringify({
    merchant_id: "MERCHANT_TEST",
    type,
    event_id: randomUUID(),
    data: {
      type: "refund",
      id: refundId,
      object: {
        refund: {
          id: refundId,
          payment_id: payment.id,
          order_id: `SQ_RETURN_${randomUUID()}`,
          location_id: payment.sellerLocationId,
          status: "COMPLETED",
        },
      },
    },
  }));
}

async function refundStatusOf(orderId: string) {
  const { data } = await admin
    .from("order_details")
    .select("refund_status")
    .eq("id", orderId)
    .single();
  return data!.refund_status as string;
}

async function refundedCentsOf(orderId: string) {
  const { data } = await admin
    .from("order_details")
    .select("refunded_cents")
    .eq("id", orderId)
    .single();
  return data!.refunded_cents as number;
}

function paymentMessage(type: string, payment: ProviderPayment, status: string): Request {
  return signed(JSON.stringify({
    merchant_id: "MERCHANT_TEST",
    type,
    event_id: randomUUID(),
    data: {
      type: "payment",
      id: payment.id,
      object: {
        payment: {
          id: payment.id,
          order_id: payment.providerOrderId,
          location_id: payment.sellerLocationId,
          status,
        },
      },
    },
  }));
}

async function deliver(deps: SquareWebhookDeps, request: Request) {
  const response = await handleSquareWebhook(request, deps);
  return { status: response.status, body: await response.json() };
}

async function orderStatus(orderId: string) {
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

test("a signed payment message confirms the pending order, records one payment and keeps the stock held", async () => {
  const { boothId, mugId } = await newBooth();
  const { userId } = await attendee();
  const order = await pendingCheckout(userId, boothId, mugId);
  const paid = paidWith(order);
  const { deps, emails } = webhookDeps(paid);

  const reply = await deliver(deps, paymentMessage("payment.updated", paid, "COMPLETED"));

  assert.deepEqual(reply, {
    status: 200,
    body: { ok: true, outcome: "confirmed", email: "sent" },
  });
  assert.equal(await orderStatus(order.orderId), "confirmed");
  assert.deepEqual(await paymentRows(order.orderId), [
    { provider_payment_id: paid.id, refund_status: "none" },
  ]);
  assert.equal(await stockOf(mugId), 3);
  assert.deepEqual(emails, [[order.orderId, null]]);
});

test("payment.created, payment.updated and a redelivery record the payment once", async () => {
  const { boothId, mugId } = await newBooth();
  const { userId } = await attendee();
  const order = await pendingCheckout(userId, boothId, mugId);
  const paid = paidWith(order);
  const { deps } = webhookDeps(paid);

  const outcomes = [];
  for (const [type, status] of [
    ["payment.created", "APPROVED"],
    ["payment.updated", "COMPLETED"],
    ["payment.updated", "COMPLETED"],
  ]) {
    outcomes.push((await deliver(deps, paymentMessage(type, paid, status))).body.outcome);
  }

  assert.deepEqual(outcomes, ["confirmed", "already_confirmed", "already_confirmed"]);
  assert.equal((await paymentRows(order.orderId)).length, 1);
  assert.equal(await stockOf(mugId), 3);
});

test("two webhook deliveries and the return page at the same moment confirm the order once", async () => {
  const { boothId, mugId } = await newBooth();
  const { userId, token } = await attendee();
  const order = await pendingCheckout(userId, boothId, mugId);
  const paid = paidWith(order);
  const webhook = webhookDeps(paid);
  const returnPage: ConfirmCheckoutDeps = {
    async getUserId(accessToken) {
      const { data, error } = await admin.auth.getUser(accessToken);
      return error ? null : data.user.id;
    },
    rpc,
    provider: stubProvider(paid),
    readSecret: webhook.deps.readSecret,
    email: webhook.deps.email,
    wait: () => Promise.resolve(),
  };

  const [first, second, page] = await Promise.all([
    deliver(webhook.deps, paymentMessage("payment.updated", paid, "COMPLETED")),
    deliver(webhook.deps, paymentMessage("payment.updated", paid, "COMPLETED")),
    handleConfirmCheckout(
      new Request("http://localhost/confirm-checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId }),
      }),
      returnPage,
    ).then((response) => response.json()),
  ]);

  // The return page answers "unchanged" when it reads the order after a
  // webhook delivery has confirmed it, and skips the confirm call.
  const outcomes = [first.body.outcome, second.body.outcome, page.outcome];
  assert.equal(outcomes.filter((outcome) => outcome === "confirmed").length, 1);
  assert.ok(
    outcomes.every((outcome) =>
      ["confirmed", "already_confirmed", "unchanged"].includes(outcome)
    ),
    JSON.stringify(outcomes),
  );
  assert.equal(await orderStatus(order.orderId), "confirmed");
  assert.deepEqual(await paymentRows(order.orderId), [
    { provider_payment_id: paid.id, refund_status: "none" },
  ]);
  assert.equal(await stockOf(mugId), 3);
});

test("a webhook delivery and expire-checkouts at the same moment confirm an overdue paid order once", async () => {
  const { boothId, mugId } = await newBooth();
  const { userId } = await attendee();
  const order = await pendingCheckout(userId, boothId, mugId);
  const { error } = await admin
    .from("orders")
    .update({ hold_ends_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", order.orderId);
  assert.equal(error, null, error?.message ?? "");
  const paid = paidWith(order);
  const webhook = webhookDeps(paid);
  const expiry: ExpireCheckoutsDeps = {
    serviceKey: "service-key",
    async rpc(name, args) {
      const data = await rpc(name, args);
      // The list holds every overdue order in the shared database, so the run
      // only sees this test's order.
      if (name === "svc_list_overdue_checkouts") {
        const orders = (data as { orders: OverdueCheckout[] }).orders;
        return { ...data, orders: orders.filter((o) => o.orderId === order.orderId) };
      }
      return data;
    },
    provider: stubProvider(paid),
    readSecret: webhook.deps.readSecret,
    email: webhook.deps.email,
  };

  const [delivered, expired] = await Promise.all([
    deliver(webhook.deps, paymentMessage("payment.updated", paid, "COMPLETED")),
    handleExpireCheckouts(
      new Request("http://localhost/expire-checkouts", {
        method: "POST",
        headers: { Authorization: "Bearer service-key" },
      }),
      expiry,
    ).then((response) => response.json()),
  ]);

  assert.equal(delivered.status, 200);
  assert.ok(
    ["confirmed", "already_confirmed"].includes(delivered.body.outcome),
    JSON.stringify(delivered.body),
  );
  assert.equal(expired.ok, true, JSON.stringify(expired));
  assert.equal(await orderStatus(order.orderId), "confirmed");
  assert.deepEqual(await paymentRows(order.orderId), [
    { provider_payment_id: paid.id, refund_status: "none" },
  ]);
  assert.equal(await stockOf(mugId), 3);
});

test("a payment message for an expired order leaves it expired and records refund due", async () => {
  const { boothId, mugId } = await newBooth();
  const { userId } = await attendee();
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
  const { deps, emails } = webhookDeps(paid);

  const reply = await deliver(deps, paymentMessage("payment.updated", paid, "COMPLETED"));

  assert.deepEqual(reply, { status: 200, body: { ok: true, outcome: "refund_due" } });
  assert.equal(await orderStatus(order.orderId), "expired");
  assert.equal(await stockOf(mugId), 5);
  assert.deepEqual(await paymentRows(order.orderId), [
    { provider_payment_id: paid.id, refund_status: "due" },
  ]);
  assert.deepEqual(emails, []);
});

test("a completed refund of a confirmed order shows refunded once and leaves the order as it is", async () => {
  const { boothId, mugId } = await newBooth();
  const { userId } = await attendee();
  const order = await pendingCheckout(userId, boothId, mugId);
  const paid = paidWith(order);
  const { deps } = webhookDeps(paid);
  assert.equal(
    (await deliver(deps, paymentMessage("payment.updated", paid, "COMPLETED"))).body.outcome,
    "confirmed",
  );
  const refundId = `REFUND_${randomUUID()}`;

  const first = await deliver(deps, refundMessage("refund.updated", paid, refundId));
  const again = await deliver(deps, refundMessage("refund.updated", paid, refundId));

  assert.deepEqual(first, { status: 200, body: { ok: true, outcome: "refunded" } });
  assert.deepEqual(again, { status: 200, body: { ok: true, outcome: "already_refunded" } });
  assert.deepEqual(await paymentRows(order.orderId), [
    { provider_payment_id: paid.id, refund_status: "refunded" },
  ]);
  assert.equal(await refundStatusOf(order.orderId), "refunded");
  assert.equal(await refundedCentsOf(order.orderId), order.totalCents);
  assert.equal(await orderStatus(order.orderId), "confirmed");
});

test("two partial refunds mark the payment refunded and add up to the refunded total", async () => {
  const { boothId, mugId } = await newBooth();
  const { userId } = await attendee();
  const order = await pendingCheckout(userId, boothId, mugId);
  const paid = paidWith(order);
  const first = `REFUND_${randomUUID()}`;
  const second = `REFUND_${randomUUID()}`;
  const { deps } = webhookDeps(paid);
  deps.provider = stubProvider(paid, "completed", { [first]: 500, [second]: 700 });
  await deliver(deps, paymentMessage("payment.updated", paid, "COMPLETED"));

  await deliver(deps, refundMessage("refund.updated", paid, first));
  assert.equal(await refundStatusOf(order.orderId), "refunded");
  assert.equal(await refundedCentsOf(order.orderId), 500);

  await deliver(deps, refundMessage("refund.updated", paid, second));
  assert.equal(await refundedCentsOf(order.orderId), 1200);
  assert.equal(await orderStatus(order.orderId), "confirmed");
});

test("a refund that arrives before its payment is recorded is answered 500, then recorded on redelivery", async () => {
  const { boothId, mugId } = await newBooth();
  const { userId } = await attendee();
  const order = await pendingCheckout(userId, boothId, mugId);
  const paid = paidWith(order);
  const { deps } = webhookDeps(paid);
  const refundId = `REFUND_${randomUUID()}`;

  const early = await deliver(deps, refundMessage("refund.updated", paid, refundId));
  assert.deepEqual(early, { status: 500, body: { ok: false, reason: "payment_not_found" } });
  assert.deepEqual(await paymentRows(order.orderId), []);

  await deliver(deps, paymentMessage("payment.updated", paid, "COMPLETED"));
  const redelivered = await deliver(deps, refundMessage("refund.updated", paid, refundId));

  assert.deepEqual(redelivered, { status: 200, body: { ok: true, outcome: "refunded" } });
  assert.equal(await refundStatusOf(order.orderId), "refunded");
});

test("a completed refund of a payment due back on an expired order changes refund due to refunded", async () => {
  const { boothId, mugId } = await newBooth();
  const { userId } = await attendee();
  const order = await pendingCheckout(userId, boothId, mugId);
  const { error } = await admin
    .from("orders")
    .update({ hold_ends_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", order.orderId);
  assert.equal(error, null, error?.message ?? "");
  assert.equal(
    (await call("svc_expire_checkout", {
      p_order_id: order.orderId,
      p_provider_order_id: order.providerOrderId,
    })).changed,
    true,
  );
  const paid = paidWith(order);
  const { deps } = webhookDeps(paid);
  await deliver(deps, paymentMessage("payment.updated", paid, "COMPLETED"));
  assert.equal(await refundStatusOf(order.orderId), "due");

  const reply = await deliver(deps, refundMessage("refund.updated", paid, `REFUND_${randomUUID()}`));

  assert.deepEqual(reply, { status: 200, body: { ok: true, outcome: "refunded" } });
  assert.equal(await refundStatusOf(order.orderId), "refunded");
  assert.equal(await orderStatus(order.orderId), "expired");
});
