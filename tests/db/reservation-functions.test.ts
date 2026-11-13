// Tests the reservation path and the vendor functions against the local Supabase.
// Start it first with `supabase start`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import {
  admin,
  call,
  callAs,
  insert,
  newAttendeeClient,
  newBooth,
  newStaffClient,
  ordersAt,
  stockOf,
} from "./support";

type Item = { productId: string; quantity: number };

const reserve = (
  client: Parameters<typeof callAs>[0],
  boothId: string,
  items: Item[],
  requestId = randomUUID(),
  email = "buyer@example.com",
) =>
  callAs(client, "create_reservation", {
    p_booth_id: boothId,
    p_items: items,
    p_email: email,
    p_request_id: requestId,
  });

async function reservationBooth() {
  const booth = await newBooth({ mode: "reservation", connection: false });
  return { ...booth, staff: await newStaffClient(booth.vendorId) };
}

test("reserves stock and returns a confirmed order with a pickup code and a 120 minute hold", async () => {
  const { boothId, mugId } = await reservationBooth();
  const { client } = await newAttendeeClient();
  const result = await reserve(client, boothId, [
    { productId: mugId, quantity: 2 },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.status, "confirmed");
  assert.equal(result.type, "reservation");
  assert.equal(result.totalCents, 6400);
  assert.match(result.pickupCode!, /^\d{4}$/);
  const minutes =
    (new Date(result.holdEndsAt!).getTime() - Date.now()) / 60_000;
  assert.ok(minutes > 119 && minutes <= 120, `hold was ${minutes} minutes`);
  assert.equal(await stockOf(mugId), 3);
});

test("a repeated request returns the first order and deducts no more stock (FR-08)", async () => {
  const { boothId, mugId } = await reservationBooth();
  const { client } = await newAttendeeClient();
  const requestId = randomUUID();
  const items = [{ productId: mugId, quantity: 2 }];
  const first = await reserve(client, boothId, items, requestId);
  const second = await reserve(client, boothId, items, requestId);

  assert.equal(second.orderId, first.orderId);
  assert.equal(await ordersAt(boothId), 1);
  assert.equal(await stockOf(mugId), 3);
});

test("refuses a bad reservation with a reason and changes nothing", async () => {
  const { boothId, limitedId, mugId } = await reservationBooth();
  const prepay = await newBooth({ mode: "prepay" });
  const { client } = await newAttendeeClient();

  const cases: [string, Awaited<ReturnType<typeof reserve>>][] = [
    [
      "over_max_per_order",
      await reserve(client, boothId, [{ productId: mugId, quantity: 3 }]),
    ],
    [
      "insufficient_stock",
      await reserve(client, boothId, [{ productId: limitedId, quantity: 2 }]),
    ],
    ["empty_cart", await reserve(client, boothId, [])],
    [
      "invalid_email",
      await reserve(
        client,
        boothId,
        [{ productId: mugId, quantity: 1 }],
        randomUUID(),
        "nope",
      ),
    ],
    [
      "booth_not_accepting_orders",
      await reserve(client, prepay.boothId, [
        { productId: prepay.mugId, quantity: 1 },
      ]),
    ],
  ];
  for (const [reason, result] of cases) {
    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason);
  }

  await admin
    .from("booths")
    .update({ ordering_paused: true })
    .eq("id", boothId);
  const paused = await reserve(client, boothId, [
    { productId: mugId, quantity: 1 },
  ]);
  assert.equal(paused.reason, "ordering_paused");

  assert.equal(await ordersAt(boothId), 0);
  assert.equal(await stockOf(mugId), 5);
  assert.equal(await stockOf(limitedId), 1);
});

test("a browser with no session cannot reserve", async () => {
  const { boothId, mugId } = await reservationBooth();
  const { createClient } = await import("@supabase/supabase-js");
  const { stack, authOptions } = await import("./support");
  const noSession = createClient(stack.url, stack.publishableKey, authOptions);
  const { error } = await noSession.rpc("create_reservation", {
    p_booth_id: boothId,
    p_items: [{ productId: mugId, quantity: 1 }],
    p_email: "buyer@example.com",
    p_request_id: randomUUID(),
  });
  assert.ok(error);
  assert.equal(await stockOf(mugId), 5);
});

test("two attendees reserving the last item at once: one gets it (NFR-01)", async () => {
  const { boothId, limitedId } = await reservationBooth();
  const [a, b] = await Promise.all([newAttendeeClient(), newAttendeeClient()]);
  const items = [{ productId: limitedId, quantity: 1 }];
  const results = await Promise.all([
    reserve(a.client, boothId, items),
    reserve(b.client, boothId, items),
  ]);

  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.find((r) => !r.ok)?.reason, "insufficient_stock");
  assert.equal(await stockOf(limitedId), 0);
  assert.equal(await ordersAt(boothId), 1);
});

test("an attendee cancels their own reservation and the stock returns (FR-10)", async () => {
  const { boothId, mugId } = await reservationBooth();
  const owner = await newAttendeeClient();
  const stranger = await newAttendeeClient();
  const order = await reserve(owner.client, boothId, [
    { productId: mugId, quantity: 2 },
  ]);
  assert.equal(await stockOf(mugId), 3);

  const refused = await callAs(stranger.client, "cancel_my_order", {
    p_order_id: order.orderId,
  });
  assert.equal(refused.reason, "order_not_found");
  assert.equal(await stockOf(mugId), 3);

  const cancelled = await callAs(owner.client, "cancel_my_order", {
    p_order_id: order.orderId,
  });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(await stockOf(mugId), 5);

  const again = await callAs(owner.client, "cancel_my_order", {
    p_order_id: order.orderId,
  });
  assert.equal(again.reason, "not_allowed_in_status");
  assert.equal(await stockOf(mugId), 5);
});

test("the order moves from confirmed to ready to collected, and a repeated code is refused (FR-21, FR-22)", async () => {
  const { boothId, mugId, staff } = await reservationBooth();
  const other = await reservationBooth();
  const { client } = await newAttendeeClient();
  const order = await reserve(client, boothId, [
    { productId: mugId, quantity: 1 },
  ]);
  const orderId = order.orderId;
  const code = order.pickupCode;

  const ready = await callAs(staff, "mark_order_ready", {
    p_order_id: orderId,
  });
  assert.equal(ready.status, "ready");
  assert.equal(
    (await callAs(staff, "mark_order_ready", { p_order_id: orderId })).reason,
    "not_allowed_in_status",
  );

  // Another booth's staff cannot collect it, and a wrong code finds nothing.
  assert.equal(
    (
      await callAs(other.staff, "collect_order", {
        p_booth_id: boothId,
        p_pickup_code: code,
      })
    ).reason,
    "not_found",
  );
  assert.equal(
    (
      await callAs(other.staff, "collect_order", {
        p_booth_id: other.boothId,
        p_pickup_code: code,
      })
    ).reason,
    "not_found",
  );
  assert.equal(
    (
      await callAs(staff, "collect_order", {
        p_booth_id: boothId,
        p_pickup_code: code === "0000" ? "0001" : "0000",
      })
    ).reason,
    "not_found",
  );

  const collected = await callAs(staff, "collect_order", {
    p_booth_id: boothId,
    p_pickup_code: code,
  });
  assert.equal(collected.status, "collected");

  const again = await callAs(staff, "collect_order", {
    p_booth_id: boothId,
    p_pickup_code: code,
  });
  assert.equal(again.ok, false);
  assert.equal(again.reason, "already_collected");
  assert.ok(again.at, "the collection time is returned");

  // A collected order cannot be cancelled by the attendee or the vendor.
  assert.equal(
    (await callAs(client, "cancel_my_order", { p_order_id: orderId })).reason,
    "not_allowed_in_status",
  );
  assert.equal(
    (
      await callAs(staff, "cancel_order", {
        p_order_id: orderId,
        p_reason: "too late",
      })
    ).reason,
    "not_allowed_in_status",
  );
});

test("collecting a cancelled or expired order shows its status", async () => {
  const { boothId, mugId, staff } = await reservationBooth();
  const { client } = await newAttendeeClient();
  const cancelled = await reserve(client, boothId, [
    { productId: mugId, quantity: 1 },
  ]);
  await callAs(client, "cancel_my_order", { p_order_id: cancelled.orderId });
  assert.equal(
    (
      await callAs(staff, "collect_order", {
        p_booth_id: boothId,
        p_pickup_code: cancelled.pickupCode,
      })
    ).reason,
    "cancelled",
  );

  const expired = await reserve(client, boothId, [
    { productId: mugId, quantity: 1 },
  ]);
  await admin
    .from("orders")
    .update({ status: "expired" })
    .eq("id", expired.orderId!);
  assert.equal(
    (
      await callAs(staff, "collect_order", {
        p_booth_id: boothId,
        p_pickup_code: expired.pickupCode,
      })
    ).reason,
    "expired",
  );
});

test("staff cancel an order with a reason, and the stock is not returned automatically (FR-23)", async () => {
  const { boothId, mugId, staff } = await reservationBooth();
  const { client } = await newAttendeeClient();
  const order = await reserve(client, boothId, [
    { productId: mugId, quantity: 2 },
  ]);

  assert.equal(
    (
      await callAs(staff, "cancel_order", {
        p_order_id: order.orderId,
        p_reason: "  ",
      })
    ).reason,
    "reason_required",
  );
  const cancelled = await callAs(staff, "cancel_order", {
    p_order_id: order.orderId,
    p_reason: "Sold the last one at the booth",
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(await stockOf(mugId), 3);

  const { data } = await client
    .from("orders")
    .select("cancel_reason")
    .eq("id", order.orderId!)
    .single();
  assert.equal(data?.cancel_reason, "Sold the last one at the booth");
});

test("cancelling a paid prepaid order marks its payment refund due", async () => {
  const booth = await newBooth({ mode: "prepay" });
  const staff = await newStaffClient(booth.vendorId);
  const { userId } = await newAttendeeClient();
  const order = await call("svc_create_pending_order", {
    p_user_id: userId,
    p_booth_id: booth.boothId,
    p_items: [{ productId: booth.mugId, quantity: 1 }],
    p_email: "buyer@example.com",
    p_request_id: randomUUID(),
  });
  await admin
    .from("orders")
    .update({ status: "confirmed" })
    .eq("id", order.orderId!);
  await insert("payments", {
    order_id: order.orderId,
    provider_payment_id: `PAY_${randomUUID()}`,
    amount_cents: 3200,
    currency: "USD",
  });

  const cancelled = await callAs(staff, "cancel_order", {
    p_order_id: order.orderId,
    p_reason: "Out of stock",
  });
  assert.equal(cancelled.status, "cancelled");
  const { data } = await admin
    .from("payments")
    .select("refund_status")
    .eq("order_id", order.orderId!)
    .single();
  assert.equal(data?.refund_status, "due");
});

test("staff set stock for their own booth only, and held stock is unaffected (FR-24)", async () => {
  const { boothId, mugId, staff } = await reservationBooth();
  const other = await reservationBooth();
  const { client } = await newAttendeeClient();
  const order = await reserve(client, boothId, [
    { productId: mugId, quantity: 2 },
  ]);

  const set = await callAs(staff, "set_product_stock", {
    p_product_id: mugId,
    p_available_qty: 10,
  });
  assert.equal(set.availableQty, 10);
  assert.equal(await stockOf(mugId), 10);
  const { data } = await admin
    .from("orders")
    .select("status")
    .eq("id", order.orderId!)
    .single();
  assert.equal(data?.status, "confirmed");

  assert.equal(
    (
      await callAs(staff, "set_product_stock", {
        p_product_id: mugId,
        p_available_qty: -1,
      })
    ).reason,
    "invalid_quantity",
  );
  assert.equal(
    (
      await callAs(other.staff, "set_product_stock", {
        p_product_id: mugId,
        p_available_qty: 99,
      })
    ).reason,
    "product_not_found",
  );
  assert.equal(
    (
      await callAs(client, "set_product_stock", {
        p_product_id: mugId,
        p_available_qty: 99,
      })
    ).reason,
    "product_not_found",
  );
  assert.equal(await stockOf(mugId), 10);
});

test("pausing stops new orders while existing orders continue (FR-25)", async () => {
  const { boothId, mugId, staff } = await reservationBooth();
  const other = await reservationBooth();
  const { client } = await newAttendeeClient();
  const order = await reserve(client, boothId, [
    { productId: mugId, quantity: 1 },
  ]);

  assert.equal(
    (
      await callAs(other.staff, "set_ordering_paused", {
        p_booth_id: boothId,
        p_paused: true,
      })
    ).reason,
    "booth_not_found",
  );
  assert.equal(
    (
      await callAs(client, "set_ordering_paused", {
        p_booth_id: boothId,
        p_paused: true,
      })
    ).reason,
    "booth_not_found",
  );

  assert.equal(
    (
      await callAs(staff, "set_ordering_paused", {
        p_booth_id: boothId,
        p_paused: true,
      })
    ).paused,
    true,
  );
  const refused = await reserve(client, boothId, [
    { productId: mugId, quantity: 1 },
  ]);
  assert.equal(refused.reason, "ordering_paused");
  assert.equal(
    (await callAs(staff, "mark_order_ready", { p_order_id: order.orderId }))
      .status,
    "ready",
  );

  await callAs(staff, "set_ordering_paused", {
    p_booth_id: boothId,
    p_paused: false,
  });
  assert.equal(
    (await reserve(client, boothId, [{ productId: mugId, quantity: 1 }])).ok,
    true,
  );
});

test("an attendee cannot use the vendor functions", async () => {
  const { boothId, mugId } = await reservationBooth();
  const { client } = await newAttendeeClient();
  const order = await reserve(client, boothId, [
    { productId: mugId, quantity: 1 },
  ]);

  assert.equal(
    (await callAs(client, "mark_order_ready", { p_order_id: order.orderId }))
      .reason,
    "order_not_found",
  );
  assert.equal(
    (
      await callAs(client, "collect_order", {
        p_booth_id: boothId,
        p_pickup_code: order.pickupCode,
      })
    ).reason,
    "not_found",
  );
  assert.equal(
    (
      await callAs(client, "cancel_order", {
        p_order_id: order.orderId,
        p_reason: "x",
      })
    ).reason,
    "order_not_found",
  );
});

test("the expiry job expires overdue reservations and returns their stock, and leaves paid and collected orders alone (FR-09)", async () => {
  const { boothId, mugId, limitedId, staff } = await reservationBooth();
  const { client } = await newAttendeeClient();
  const { client: second } = await newAttendeeClient();
  const past = new Date(Date.now() - 60_000).toISOString();

  const overdue = await reserve(client, boothId, [
    { productId: mugId, quantity: 2 },
  ]);
  const overdueReady = await reserve(second, boothId, [
    { productId: mugId, quantity: 1 },
  ]);
  await callAs(staff, "mark_order_ready", { p_order_id: overdueReady.orderId });
  const fresh = await reserve(client, boothId, [
    { productId: limitedId, quantity: 1 },
  ]);
  const collected = await reserve(second, boothId, [
    { productId: mugId, quantity: 1 },
  ]);
  await callAs(staff, "collect_order", {
    p_booth_id: boothId,
    p_pickup_code: collected.pickupCode,
  });
  assert.equal(await stockOf(mugId), 1);

  // A confirmed prepaid order past its hold is not a reservation, so the job skips it.
  const prepay = await newBooth({ mode: "prepay" });
  const { userId } = await newAttendeeClient();
  const paid = await call("svc_create_pending_order", {
    p_user_id: userId,
    p_booth_id: prepay.boothId,
    p_items: [{ productId: prepay.mugId, quantity: 1 }],
    p_email: "buyer@example.com",
    p_request_id: randomUUID(),
  });
  await admin
    .from("orders")
    .update({ status: "confirmed", hold_ends_at: past })
    .eq("id", paid.orderId!);

  await admin
    .from("orders")
    .update({ hold_ends_at: past })
    .in("id", [overdue.orderId!, overdueReady.orderId!, collected.orderId!]);

  // The scheduled job runs every minute. Wait for the real thing.
  const statusOf = async (id: string) =>
    (await admin.from("orders").select("status").eq("id", id).single()).data
      ?.status;
  const deadline = Date.now() + 90_000;
  while (
    Date.now() < deadline &&
    (await statusOf(overdue.orderId!)) !== "expired"
  ) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  assert.equal(await statusOf(overdue.orderId!), "expired");
  assert.equal(await statusOf(overdueReady.orderId!), "expired");
  assert.equal(await statusOf(fresh.orderId!), "confirmed");
  assert.equal(await statusOf(collected.orderId!), "collected");
  assert.equal(await statusOf(paid.orderId!), "confirmed");
  // 5 units: 2 + 1 + 1 held, then the 3 of the two expired orders returned.
  assert.equal(await stockOf(mugId), 4);
  assert.equal(await stockOf(prepay.mugId), 4);

  // An expired order cannot be collected or cancelled by the attendee.
  assert.equal(
    (
      await callAs(staff, "collect_order", {
        p_booth_id: boothId,
        p_pickup_code: overdue.pickupCode,
      })
    ).reason,
    "expired",
  );
  assert.equal(
    (
      await callAs(client, "cancel_my_order", {
        p_order_id: overdue.orderId,
      })
    ).reason,
    "not_allowed_in_status",
  );
}, 120_000);
