// Tests confirming a prepaid order, reading it back, refunds, and the confirmation email
// claim, against the local Supabase. Start it first with `supabase start`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import {
  admin,
  call,
  newBooth,
  newAttendeeClient,
  newStaffClient,
  newUser,
  stockOf,
  type Reply,
} from "./support";

// A prepaid order with its Square checkout attached, waiting for payment.
async function pendingOrder(quantity = 2, existingUserId?: string) {
  const booth = await newBooth({ mode: "prepay" });
  const userId = existingUserId ?? (await newUser());
  const providerOrderId = `SQ_${randomUUID()}`;
  const order = await call("svc_create_pending_order", {
    p_user_id: userId,
    p_booth_id: booth.boothId,
    p_items: [{ productId: booth.mugId, quantity }],
    p_email: "buyer@example.com",
    p_request_id: randomUUID(),
  });
  await call("svc_attach_checkout", {
    p_order_id: order.orderId,
    p_checkout_link_id: `LINK_${randomUUID()}`,
    p_provider_order_id: providerOrderId,
  });
  return { ...booth, userId, order, providerOrderId, total: order.totalCents! };
}

const confirm = (
  providerOrderId: string,
  overrides: Record<string, unknown> = {},
): Promise<Reply> =>
  call("svc_confirm_paid_order", {
    p_provider_order_id: providerOrderId,
    p_provider_payment_id: `PAY_${randomUUID()}`,
    p_amount_cents: 6400,
    p_currency: "USD",
    p_location_id: "LOCATION_TEST",
    ...overrides,
  });

const refund = (
  paymentId: string,
  refundId: string,
  amountCents: number | null = 6400,
  currency = "USD",
): Promise<Reply> =>
  call("svc_mark_refunded", {
    p_provider_payment_id: paymentId,
    p_provider_refund_id: refundId,
    p_amount_cents: amountCents,
    p_currency: currency,
  });

async function refundsOf(paymentId: string) {
  const { data: payment } = await admin
    .from("payments")
    .select("id")
    .eq("provider_payment_id", paymentId)
    .single();
  const { data } = await admin
    .from("payment_refunds")
    .select("provider_refund_id, amount_cents")
    .eq("payment_id", payment!.id)
    .order("provider_refund_id");
  return data ?? [];
}

async function paymentsOf(orderId: string) {
  const { data } = await admin
    .from("payments")
    .select("provider_payment_id, refund_status, amount_cents")
    .eq("order_id", orderId);
  return data ?? [];
}

async function statusOf(orderId: string): Promise<string> {
  const { data } = await admin
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .single();
  return data!.status as string;
}

test("a matching payment confirms the order and is recorded once (FR-12)", async () => {
  const { order, providerOrderId } = await pendingOrder();
  const result = await confirm(providerOrderId, {
    p_provider_payment_id: "PAY_ONE",
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, "confirmed");
  assert.equal(result.status, "confirmed");
  assert.equal(await statusOf(order.orderId!), "confirmed");
  assert.deepEqual(await paymentsOf(order.orderId!), [
    {
      provider_payment_id: "PAY_ONE",
      refund_status: "none",
      amount_cents: 6400,
    },
  ]);
});

test("the same payment again changes nothing (FR-13)", async () => {
  const { order, providerOrderId } = await pendingOrder();
  await confirm(providerOrderId, { p_provider_payment_id: "PAY_SAME" });
  const again = await confirm(providerOrderId, {
    p_provider_payment_id: "PAY_SAME",
  });

  assert.equal(again.outcome, "already_confirmed");
  assert.equal(again.changed, false);
  assert.equal((await paymentsOf(order.orderId!)).length, 1);
});

test("the return page and the webhook confirming at the same moment confirm once (FR-13)", async () => {
  // Many orders and many calls each, so the calls really overlap.
  const orders = await Promise.all(
    Array.from({ length: 6 }, () => pendingOrder()),
  );
  const calls = orders.flatMap(({ providerOrderId }, index) =>
    Array.from({ length: 8 }, () =>
      confirm(providerOrderId, {
        p_provider_payment_id: `PAY_RACE_${index}_${orders[0].order.orderId}`,
      }),
    ),
  );
  const results = await Promise.all(calls);

  assert.ok(
    results.every((r) => r.ok),
    JSON.stringify(results.find((r) => !r.ok)),
  );
  assert.equal(results.filter((r) => r.outcome === "confirmed").length, 6);
  assert.equal(
    results.filter((r) => r.outcome === "already_confirmed").length,
    42,
  );
  for (const { order } of orders) {
    assert.equal((await paymentsOf(order.orderId!)).length, 1);
  }
});

test("a second, different payment on a confirmed order is refund due (FR-15)", async () => {
  const { order, providerOrderId } = await pendingOrder();
  await confirm(providerOrderId, { p_provider_payment_id: "PAY_FIRST" });
  const second = await confirm(providerOrderId, {
    p_provider_payment_id: "PAY_SECOND",
  });

  assert.equal(second.outcome, "refund_due");
  assert.equal(await statusOf(order.orderId!), "confirmed");
  const payments = await paymentsOf(order.orderId!);
  assert.deepEqual(
    payments.map((p) => [p.provider_payment_id, p.refund_status]).sort(),
    [
      ["PAY_FIRST", "none"],
      ["PAY_SECOND", "due"],
    ],
  );
  // Sending the second one again records nothing more.
  const repeat = await confirm(providerOrderId, {
    p_provider_payment_id: "PAY_SECOND",
  });
  assert.equal(repeat.outcome, "refund_due");
  assert.equal((await paymentsOf(order.orderId!)).length, 2);
});

test("a payment for an expired or cancelled order is recorded as refund due and does not reactivate it (FR-15)", async () => {
  for (const status of ["expired", "cancelled"]) {
    const { order, providerOrderId, mugId } = await pendingOrder();
    if (status === "expired") {
      await call("svc_release_checkout", {
        p_order_id: order.orderId,
        p_provider_order_id: providerOrderId,
      });
    } else {
      await admin
        .from("orders")
        .update({ status: "cancelled" })
        .eq("id", order.orderId!);
    }
    const stockBefore = await stockOf(mugId);

    const result = await confirm(providerOrderId);
    assert.equal(result.outcome, "refund_due", status);
    assert.equal(await statusOf(order.orderId!), status);
    assert.equal(await stockOf(mugId), stockBefore, "stock changed");
    const payments = await paymentsOf(order.orderId!);
    assert.equal(payments.length, 1);
    assert.equal(payments[0].refund_status, "due");
  }
});

test("a payment that lands after the hold but before expiry still confirms (FR-14)", async () => {
  const { order, providerOrderId } = await pendingOrder();
  await admin
    .from("orders")
    .update({ hold_ends_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", order.orderId!);

  const result = await confirm(providerOrderId);
  assert.equal(result.outcome, "confirmed");
});

test("a payment that does not match is refused and nothing changes", async () => {
  const { order, providerOrderId, mugId } = await pendingOrder();
  const stockBefore = await stockOf(mugId);
  const cases: [string, Record<string, unknown>][] = [
    ["amount_mismatch", { p_amount_cents: 6399 }],
    ["amount_mismatch", { p_amount_cents: 1 }],
    ["currency_mismatch", { p_currency: "EUR" }],
    ["location_mismatch", { p_location_id: "SOMEONE_ELSE" }],
  ];
  for (const [reason, overrides] of cases) {
    const result = await confirm(providerOrderId, overrides);
    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason);
  }
  assert.equal(await statusOf(order.orderId!), "pending_payment");
  assert.deepEqual(await paymentsOf(order.orderId!), []);
  assert.equal(await stockOf(mugId), stockBefore);
});

test("an unknown Square order, or a payment already used by another order, is refused", async () => {
  assert.equal((await confirm(`SQ_${randomUUID()}`)).reason, "order_not_found");

  const first = await pendingOrder();
  const second = await pendingOrder();
  await confirm(first.providerOrderId, { p_provider_payment_id: "PAY_TAKEN" });
  const stolen = await confirm(second.providerOrderId, {
    p_provider_payment_id: "PAY_TAKEN",
  });
  assert.equal(stolen.reason, "payment_belongs_to_other_order");
  assert.equal(await statusOf(second.order.orderId!), "pending_payment");
  assert.deepEqual(await paymentsOf(second.order.orderId!), []);
});

test("the checkout reads give the order only to its owner, or by its Square order", async () => {
  const { order, providerOrderId, userId } = await pendingOrder();

  const mine = await call("svc_get_checkout", {
    p_order_id: order.orderId,
    p_user_id: userId,
  });
  assert.equal(mine.ok, true);
  assert.equal(mine.status, "pending_payment");
  assert.equal(mine.providerOrderId, providerOrderId);
  assert.equal(mine.totalCents, 6400);
  assert.deepEqual(mine.connection, {
    tokenSecretName: "SQUARE_ACCESS_TOKEN_TEST",
    locationId: "LOCATION_TEST",
  });

  const stranger = await call("svc_get_checkout", {
    p_order_id: order.orderId,
    p_user_id: await newUser(),
  });
  assert.equal(stranger.reason, "order_not_found");

  const byProvider = await call("svc_get_checkout_by_provider_order", {
    p_provider_order_id: providerOrderId,
  });
  assert.equal(byProvider.orderId, order.orderId);
  assert.equal(
    (
      await call("svc_get_checkout_by_provider_order", {
        p_provider_order_id: "SQ_NONE",
      })
    ).reason,
    "order_not_found",
  );

  // A reservation is not a checkout.
  const reservation = await newBooth({
    mode: "reservation",
    connection: false,
  });
  const reserved = await call("svc_create_pending_order", {
    p_user_id: userId,
    p_booth_id: reservation.boothId,
    p_items: [{ productId: reservation.mugId, quantity: 1 }],
    p_email: "buyer@example.com",
    p_request_id: randomUUID(),
  });
  assert.equal(reserved.ok, false);
});

test("any completed refund marks its payment refunded, and a repeated refund id changes nothing", async () => {
  const { order, providerOrderId } = await pendingOrder();
  await confirm(providerOrderId, { p_provider_payment_id: "PAY_REFUND" });

  // Refunded without being refund due first, and by a partial refund.
  const first = await refund("PAY_REFUND", "REFUND_1", 1000);
  assert.deepEqual(first, { ok: true, changed: true });
  assert.equal((await paymentsOf(order.orderId!))[0].refund_status, "refunded");

  // The same refund id again changes nothing, even with a different amount.
  const repeat = await refund("PAY_REFUND", "REFUND_1", 5000);
  assert.deepEqual(repeat, { ok: true, changed: false });
  assert.deepEqual(await refundsOf("PAY_REFUND"), [
    { provider_refund_id: "REFUND_1", amount_cents: 1000 },
  ]);

  // A second refund of the same payment is a new refund id.
  const another = await refund("PAY_REFUND", "REFUND_2", 500);
  assert.equal(another.changed, true);

  assert.equal(
    (await refund("PAY_NONE", "REFUND_3")).reason,
    "payment_not_found",
  );
  assert.equal((await refund("PAY_REFUND", " ")).reason, "invalid_refund_id");
});

test("a refund's amount is stored with it, and a bad amount or currency is refused", async () => {
  const { order, providerOrderId } = await pendingOrder();
  await confirm(providerOrderId, { p_provider_payment_id: "PAY_AMOUNT" });

  for (const amount of [null, 0, -1]) {
    const refused = await refund("PAY_AMOUNT", "REFUND_BAD", amount);
    assert.equal(refused.reason, "invalid_amount", String(amount));
  }
  const wrongCurrency = await refund("PAY_AMOUNT", "REFUND_BAD", 100, "EUR");
  assert.equal(wrongCurrency.reason, "currency_mismatch");

  // Nothing was recorded, and the payment is untouched.
  assert.deepEqual(await refundsOf("PAY_AMOUNT"), []);
  assert.equal((await paymentsOf(order.orderId!))[0].refund_status, "none");

  assert.equal((await refund("PAY_AMOUNT", "REFUND_OK", 2500)).changed, true);
  assert.deepEqual(await refundsOf("PAY_AMOUNT"), [
    { provider_refund_id: "REFUND_OK", amount_cents: 2500 },
  ]);

  // The database refuses an amount of zero or less, whatever calls it.
  const { error } = await admin.from("payment_refunds").insert({
    payment_id: (
      await admin
        .from("payments")
        .select("id")
        .eq("provider_payment_id", "PAY_AMOUNT")
        .single()
    ).data!.id,
    provider_refund_id: "REFUND_ZERO",
    amount_cents: 0,
  });
  assert.ok(error);
});

test("an order shows how much was refunded across its payments, to its attendee and to staff only", async () => {
  const attendee = await newAttendeeClient();
  const { order, providerOrderId, vendorId } = await pendingOrder(
    2,
    attendee.userId,
  );
  const stranger = await newAttendeeClient();
  const staff = await newStaffClient(vendorId);
  const id = order.orderId!;

  const refunded = async (client: typeof attendee.client) =>
    (
      await client
        .from("order_details")
        .select("refund_status, refunded_cents")
        .eq("id", id)
    ).data;

  // Nothing refunded yet.
  assert.deepEqual(await refunded(attendee.client), [
    { refund_status: "none", refunded_cents: 0 },
  ]);

  // Two refunds on the first payment, and one on a second (refund due) payment.
  const paymentA = `PAY_${randomUUID()}`;
  const paymentB = `PAY_${randomUUID()}`;
  await confirm(providerOrderId, { p_provider_payment_id: paymentA });
  await confirm(providerOrderId, { p_provider_payment_id: paymentB });
  await refund(paymentA, `RF_${randomUUID()}`, 1000);
  await refund(paymentA, `RF_${randomUUID()}`, 500);
  await refund(paymentB, `RF_${randomUUID()}`, 700);

  const expected = [{ refund_status: "refunded", refunded_cents: 2200 }];
  assert.deepEqual(await refunded(attendee.client), expected);
  assert.deepEqual(await refunded(staff), expected);
  assert.deepEqual(await refunded(stranger.client), []);

  // The attendee's order result and the private link carry the same total.
  const { data: token } = await admin
    .from("orders")
    .select("private_token")
    .eq("id", id)
    .single();
  const opened = await stranger.client.rpc("get_order_by_token", {
    p_token: token!.private_token,
  });
  assert.equal(
    (opened.data as Reply & { refundedCents: number }).refundedCents,
    2200,
  );
  const viaPayload = await call("svc_get_checkout", {
    p_order_id: id,
    p_user_id: attendee.userId,
  });
  assert.equal(viaPayload.ok, true);

  // The refunds themselves are readable by the same people and by nobody else.
  const rows = async (client: typeof attendee.client) =>
    (await client.from("payment_refunds").select("amount_cents")).data?.length;
  assert.equal(await rows(attendee.client), 3);
  assert.equal(await rows(staff), 3);
  assert.equal(await rows(stranger.client), 0);
});

test("a refund due payment becomes refunded when its refund completes", async () => {
  const { order, providerOrderId } = await pendingOrder();
  await confirm(providerOrderId, { p_provider_payment_id: "PAY_A" });
  await confirm(providerOrderId, { p_provider_payment_id: "PAY_B" });
  await refund("PAY_B", `REFUND_${randomUUID()}`, 6400);

  const payments = await paymentsOf(order.orderId!);
  assert.deepEqual(
    payments.map((p) => [p.provider_payment_id, p.refund_status]).sort(),
    [
      ["PAY_A", "none"],
      ["PAY_B", "refunded"],
    ],
  );
});

test("the confirmation email is claimed once, and a failed send can be retried (FR-18)", async () => {
  const { order, providerOrderId, userId } = await pendingOrder();
  const id = order.orderId;

  // Not confirmed yet: nothing to send.
  assert.equal(
    (await call("svc_mark_email_sent", { p_order_id: id, p_user_id: userId }))
      .reason,
    "not_confirmed",
  );

  await confirm(providerOrderId);
  const first = await call("svc_mark_email_sent", {
    p_order_id: id,
    p_user_id: userId,
  });
  assert.equal(first.outcome, "first_time");
  assert.equal(first.buyerEmail, "buyer@example.com");
  assert.match(first.pickupCode!, /^\d{4}$/);
  assert.ok(first.privateToken);
  assert.ok(first.boothCode && first.boothName);

  // The webhook has no user and passes null.
  const repeat = await call("svc_mark_email_sent", { p_order_id: id });
  assert.deepEqual(repeat, { ok: true, outcome: "repeat" });

  // A failed send clears the claim, and the next trigger sends.
  assert.deepEqual(
    await call("svc_clear_email_sent", { p_order_id: id, p_user_id: userId }),
    { ok: true },
  );
  const retry = await call("svc_mark_email_sent", { p_order_id: id });
  assert.equal(retry.outcome, "first_time");
  assert.equal(await statusOf(id!), "confirmed");
});

test("the email functions refuse a user who does not own the order", async () => {
  const { order, providerOrderId } = await pendingOrder();
  await confirm(providerOrderId);
  const stranger = await newUser();

  assert.equal(
    (
      await call("svc_mark_email_sent", {
        p_order_id: order.orderId,
        p_user_id: stranger,
      })
    ).reason,
    "order_not_found",
  );
  assert.equal(
    (
      await call("svc_clear_email_sent", {
        p_order_id: order.orderId,
        p_user_id: stranger,
      })
    ).reason,
    "order_not_found",
  );
});

test("a reservation's email is claimed the same way, by its attendee", async () => {
  const booth = await newBooth({ mode: "reservation", connection: false });
  const { client, userId } = await newAttendeeClient();
  const reserved = await client.rpc("create_reservation", {
    p_booth_id: booth.boothId,
    p_items: [{ productId: booth.mugId, quantity: 1 }],
    p_email: "reserve@example.com",
    p_request_id: randomUUID(),
  });
  const orderId = (reserved.data as Reply).orderId;

  const claim = await call("svc_mark_email_sent", {
    p_order_id: orderId,
    p_user_id: userId,
  });
  assert.equal(claim.outcome, "first_time");
  assert.equal(claim.buyerEmail, "reserve@example.com");
});

test("browsers cannot call the payment functions", async () => {
  const { client } = await newAttendeeClient();
  const calls: [string, Record<string, unknown>][] = [
    ["svc_get_checkout", { p_order_id: randomUUID(), p_user_id: randomUUID() }],
    ["svc_get_checkout_by_provider_order", { p_provider_order_id: "SQ" }],
    ["svc_get_checkout_by_provider_payment", { p_provider_payment_id: "P" }],
    [
      "svc_confirm_paid_order",
      {
        p_provider_order_id: "SQ",
        p_provider_payment_id: "P",
        p_amount_cents: 1,
        p_currency: "USD",
        p_location_id: "L",
      },
    ],
    [
      "svc_mark_refunded",
      {
        p_provider_payment_id: "P",
        p_provider_refund_id: "R",
        p_amount_cents: 100,
        p_currency: "USD",
      },
    ],
    ["svc_mark_email_sent", { p_order_id: randomUUID() }],
    ["svc_clear_email_sent", { p_order_id: randomUUID() }],
  ];
  for (const [name, args] of calls) {
    const { error } = await client.rpc(name, args);
    assert.ok(error, `a browser called ${name}`);
  }
});

test("a recorded payment leads back to its order and seller, whatever the order's status", async () => {
  const paid = await pendingOrder();
  const paymentId = `PAY_${randomUUID()}`;
  await confirm(paid.providerOrderId, { p_provider_payment_id: paymentId });

  const found = await call("svc_get_checkout_by_provider_payment", {
    p_provider_payment_id: paymentId,
  });
  assert.equal(found.ok, true);
  assert.equal(found.orderId, paid.order.orderId);
  assert.equal(found.status, "confirmed");
  assert.deepEqual(found.connection, {
    tokenSecretName: "SQUARE_ACCESS_TOKEN_TEST",
    locationId: "LOCATION_TEST",
  });
  // The same answer as looking the order up by its Square order id.
  assert.deepEqual(
    found,
    await call("svc_get_checkout_by_provider_order", {
      p_provider_order_id: paid.providerOrderId,
    }),
  );

  // A second payment on the same order is refund due, and leads to the same order.
  const extra = `PAY_${randomUUID()}`;
  await confirm(paid.providerOrderId, { p_provider_payment_id: extra });
  const second = await call("svc_get_checkout_by_provider_payment", {
    p_provider_payment_id: extra,
  });
  assert.equal(second.orderId, paid.order.orderId);

  // A payment recorded as refund due on an expired or cancelled order is found too.
  for (const status of ["expired", "cancelled"]) {
    const late = await pendingOrder();
    await admin.from("orders").update({ status }).eq("id", late.order.orderId!);
    const latePayment = `PAY_${randomUUID()}`;
    const recorded = await confirm(late.providerOrderId, {
      p_provider_payment_id: latePayment,
    });
    assert.equal(recorded.outcome, "refund_due", status);

    const lookup = await call("svc_get_checkout_by_provider_payment", {
      p_provider_payment_id: latePayment,
    });
    assert.equal(lookup.ok, true, status);
    assert.equal(lookup.orderId, late.order.orderId);
    assert.equal(lookup.status, status);
  }
});

test("a payment we have not recorded is order_not_found", async () => {
  // An order still waiting for its payment has no payment row yet.
  const waiting = await pendingOrder();
  const cases = [`PAY_${randomUUID()}`, "", "' or true --"];
  for (const paymentId of cases) {
    assert.deepEqual(
      await call("svc_get_checkout_by_provider_payment", {
        p_provider_payment_id: paymentId,
      }),
      { ok: false, reason: "order_not_found" },
      JSON.stringify(paymentId),
    );
  }
  assert.equal(
    (
      await call("svc_get_checkout_by_provider_order", {
        p_provider_order_id: waiting.providerOrderId,
      })
    ).ok,
    true,
  );
});
