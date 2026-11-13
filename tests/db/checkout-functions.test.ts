// Tests the schema and the checkout service functions against the local Supabase.
// Start it first with `supabase start`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  admin,
  authOptions,
  call,
  newAttendeeClient,
  newBooth,
  newUser,
  ordersAt,
  type Reply,
  stack,
  stockOf,
} from "./support";

function createPending(
  userId: string,
  boothId: string,
  items: { productId: string; quantity: number }[],
  requestId = randomUUID(),
  email = "buyer@example.com",
) {
  return call("svc_create_pending_order", {
    p_user_id: userId,
    p_booth_id: boothId,
    p_items: items,
    p_email: email,
    p_request_id: requestId,
  });
}

test("creates a pending order that holds stock, with a 15 minute hold and the seller connection", async () => {
  const { boothId, mugId } = await newBooth();
  const userId = await newUser();
  const result = await createPending(userId, boothId, [
    { productId: mugId, quantity: 2 },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.status, "pending_payment");
  assert.equal(result.totalCents, 6400);
  assert.match(result.pickupCode!, /^\d{4}$/);
  assert.deepEqual(
    result.items?.map(({ name, quantity, unitPriceCents }) => ({
      name,
      quantity,
      unitPriceCents,
    })),
    [{ name: "Mug", quantity: 2, unitPriceCents: 3200 }],
  );
  assert.deepEqual(result.connection, {
    tokenSecretName: "SQUARE_ACCESS_TOKEN_TEST",
    locationId: "LOCATION_TEST",
  });
  const minutes =
    (new Date(result.holdEndsAt!).getTime() - Date.now()) / 60_000;
  assert.ok(minutes > 14 && minutes <= 15, `hold was ${minutes} minutes`);
  assert.equal(await stockOf(mugId), 3);
});

test("a repeated request returns the first order and holds no more stock", async () => {
  const { boothId, mugId } = await newBooth();
  const userId = await newUser();
  const requestId = randomUUID();
  const first = await createPending(
    userId,
    boothId,
    [{ productId: mugId, quantity: 2 }],
    requestId,
  );
  const second = await createPending(
    userId,
    boothId,
    [{ productId: mugId, quantity: 2 }],
    requestId,
  );

  assert.equal(second.ok, true);
  assert.equal(second.orderId, first.orderId);
  assert.equal(await ordersAt(boothId), 1);
  assert.equal(await stockOf(mugId), 3);
});

test("refuses a bad request with a reason and changes nothing", async () => {
  const { boothId, limitedId, mugId } = await newBooth();
  const reservationBooth = await newBooth({ mode: "reservation" });
  const noConnection = await newBooth({ connection: false });
  const userId = await newUser();

  const cases: [string, Reply][] = [
    [
      "over_max_per_order",
      await createPending(userId, boothId, [{ productId: mugId, quantity: 3 }]),
    ],
    [
      "insufficient_stock",
      await createPending(userId, boothId, [
        { productId: limitedId, quantity: 2 },
      ]),
    ],
    ["empty_cart", await createPending(userId, boothId, [])],
    [
      "invalid_items",
      await createPending(userId, boothId, [{ productId: mugId, quantity: 0 }]),
    ],
    [
      "product_not_found",
      await createPending(userId, boothId, [
        { productId: randomUUID(), quantity: 1 },
      ]),
    ],
    [
      "invalid_email",
      await createPending(
        userId,
        boothId,
        [{ productId: mugId, quantity: 1 }],
        randomUUID(),
        "nope",
      ),
    ],
    [
      "checkout_unavailable",
      await createPending(userId, noConnection.boothId, [
        { productId: noConnection.mugId, quantity: 1 },
      ]),
    ],
    [
      "booth_not_accepting_orders",
      await createPending(userId, reservationBooth.boothId, [
        { productId: reservationBooth.mugId, quantity: 1 },
      ]),
    ],
  ];
  for (const [reason, result] of cases) {
    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason);
  }
  assert.deepEqual(cases[0][1].productIds, [mugId]);
  assert.deepEqual(cases[1][1].productIds, [limitedId]);

  await admin
    .from("booths")
    .update({ ordering_paused: true })
    .eq("id", boothId);
  const paused = await createPending(userId, boothId, [
    { productId: mugId, quantity: 1 },
  ]);
  assert.equal(paused.reason, "ordering_paused");

  assert.equal(await ordersAt(boothId), 0);
  assert.equal(await stockOf(mugId), 5);
  assert.equal(await stockOf(limitedId), 1);
});

test("two requests for the last item at once: one gets it, one is refused (NFR-01)", async () => {
  const { boothId, limitedId } = await newBooth();
  const [a, b] = await Promise.all([newUser(), newUser()]);
  const items = [{ productId: limitedId, quantity: 1 }];
  const results = await Promise.all([
    createPending(a, boothId, items),
    createPending(b, boothId, items),
  ]);

  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.find((r) => !r.ok)?.reason, "insufficient_stock");
  assert.equal(await stockOf(limitedId), 0);
  assert.equal(await ordersAt(boothId), 1);
});

test("many requests at once never take more than the stock", async () => {
  const { boothId, mugId } = await newBooth();
  const users = await Promise.all(Array.from({ length: 8 }, newUser));
  const results = await Promise.all(
    users.map((userId) =>
      createPending(userId, boothId, [{ productId: mugId, quantity: 2 }]),
    ),
  );

  // 5 units, 2 per order: two orders fit, the rest are refused.
  assert.equal(results.filter((r) => r.ok).length, 2);
  assert.equal(await stockOf(mugId), 1);
  assert.equal(await ordersAt(boothId), 2);
});

test("attaches the Square checkout once and accepts the same call again", async () => {
  const { boothId, mugId } = await newBooth();
  const order = await createPending(await newUser(), boothId, [
    { productId: mugId, quantity: 1 },
  ]);
  const orderId = order.orderId!;

  assert.deepEqual(
    await call("svc_attach_checkout", {
      p_order_id: orderId,
      p_checkout_link_id: "LINK_1",
      p_provider_order_id: "SQ_1",
    }),
    { ok: true },
  );
  assert.deepEqual(
    await call("svc_attach_checkout", {
      p_order_id: orderId,
      p_checkout_link_id: "LINK_1",
      p_provider_order_id: "SQ_1",
    }),
    { ok: true },
  );
  assert.equal(
    (
      await call("svc_attach_checkout", {
        p_order_id: orderId,
        p_checkout_link_id: "LINK_2",
        p_provider_order_id: "SQ_2",
      })
    ).reason,
    "already_attached",
  );
  assert.equal(
    (
      await call("svc_attach_checkout", {
        p_order_id: randomUUID(),
        p_checkout_link_id: "L",
        p_provider_order_id: "O",
      })
    ).reason,
    "order_not_found",
  );

  await admin.from("orders").update({ status: "confirmed" }).eq("id", orderId);
  assert.equal(
    (
      await call("svc_attach_checkout", {
        p_order_id: orderId,
        p_checkout_link_id: "LINK_1",
        p_provider_order_id: "SQ_1",
      })
    ).reason,
    "not_pending",
  );
});

test("expires an unpaid checkout after its hold and returns the stock", async () => {
  const { boothId, mugId } = await newBooth();
  const order = await createPending(await newUser(), boothId, [
    { productId: mugId, quantity: 2 },
  ]);
  const orderId = order.orderId!;
  await call("svc_attach_checkout", {
    p_order_id: orderId,
    p_checkout_link_id: "LINK_E",
    p_provider_order_id: "SQ_E",
  });
  assert.equal(await stockOf(mugId), 3);

  // The hold has not ended yet.
  assert.equal(
    (
      await call("svc_expire_checkout", {
        p_order_id: orderId,
        p_provider_order_id: "SQ_E",
      })
    ).reason,
    "hold_not_ended",
  );
  assert.equal(await stockOf(mugId), 3);

  await admin
    .from("orders")
    .update({ hold_ends_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", orderId);

  const overdue = await call("svc_list_overdue_checkouts", { p_limit: 500 });
  assert.ok(overdue.orders?.some((o) => o.orderId === orderId));

  assert.equal(
    (
      await call("svc_expire_checkout", {
        p_order_id: orderId,
        p_provider_order_id: "WRONG",
      })
    ).reason,
    "provider_order_mismatch",
  );
  assert.equal(await stockOf(mugId), 3);

  assert.deepEqual(
    await call("svc_expire_checkout", {
      p_order_id: orderId,
      p_provider_order_id: "SQ_E",
    }),
    { ok: true, changed: true },
  );
  assert.equal(await stockOf(mugId), 5);
  // Expiring twice returns the stock once.
  assert.deepEqual(
    await call("svc_expire_checkout", {
      p_order_id: orderId,
      p_provider_order_id: "SQ_E",
    }),
    { ok: true, changed: false },
  );
  assert.equal(await stockOf(mugId), 5);

  const after = await call("svc_list_overdue_checkouts", { p_limit: 500 });
  assert.ok(!after.orders?.some((o) => o.orderId === orderId));
});

test("expires an order whose checkout was never created when no provider order is passed", async () => {
  const { boothId, mugId } = await newBooth();
  const order = await createPending(await newUser(), boothId, [
    { productId: mugId, quantity: 1 },
  ]);
  await admin
    .from("orders")
    .update({ hold_ends_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", order.orderId!);

  assert.deepEqual(
    await call("svc_expire_checkout", {
      p_order_id: order.orderId,
      p_provider_order_id: null,
    }),
    { ok: true, changed: true },
  );
  assert.equal(await stockOf(mugId), 5);
});

test("a confirmed order is never expired, and a final status never changes (NFR-05)", async () => {
  const { boothId, mugId } = await newBooth();
  const order = await createPending(await newUser(), boothId, [
    { productId: mugId, quantity: 1 },
  ]);
  const orderId = order.orderId!;
  await admin
    .from("orders")
    .update({
      status: "confirmed",
      hold_ends_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .eq("id", orderId);

  const refused = await call("svc_expire_checkout", {
    p_order_id: orderId,
    p_provider_order_id: null,
  });
  assert.equal(refused.reason, "not_pending");
  assert.equal(refused.status, "confirmed");
  assert.equal(await stockOf(mugId), 4);

  // Each final status holds on its own order.
  for (const final of ["collected", "cancelled", "expired"]) {
    const other = await createPending(await newUser(), boothId, [
      { productId: mugId, quantity: 1 },
    ]);
    await admin
      .from("orders")
      .update({ status: final })
      .eq("id", other.orderId!);
    const { error } = await admin
      .from("orders")
      .update({ status: "ready" })
      .eq("id", other.orderId!);
    assert.ok(error, `a ${final} order went back to an active status`);
  }
});

test("only the service role can call the service functions", async () => {
  const { client } = await newAttendeeClient();
  const anon = createClient(stack.url, stack.publishableKey, authOptions);
  for (const browser of [anon, client]) {
    for (const [name, args] of [
      ["svc_list_overdue_checkouts", {}],
      [
        "svc_release_checkout",
        { p_order_id: randomUUID(), p_provider_order_id: null },
      ],
    ] as const) {
      const { error } = await browser.rpc(name, args);
      assert.ok(error, `a browser client called ${name}`);
    }
  }
});

test("an attendee reads only their own orders and cannot write orders or stock (NFR-02)", async () => {
  const { boothId, mugId } = await newBooth();
  const first = await newAttendeeClient();
  const second = await newAttendeeClient();
  const order = await createPending(first.userId, boothId, [
    { productId: mugId, quantity: 1 },
  ]);

  const own = await first.client
    .from("orders")
    .select("id")
    .eq("id", order.orderId!);
  assert.equal(own.data?.length, 1);
  const items = await first.client
    .from("order_items")
    .select("id")
    .eq("order_id", order.orderId!);
  assert.equal(items.data?.length, 1);

  const other = await second.client
    .from("orders")
    .select("id")
    .eq("id", order.orderId!);
  assert.equal(other.data?.length, 0);
  const otherItems = await second.client
    .from("order_items")
    .select("id")
    .eq("order_id", order.orderId!);
  assert.equal(otherItems.data?.length, 0);

  const stock = await first.client
    .from("products")
    .update({ available_qty: 999 })
    .eq("id", mugId);
  assert.ok(stock.error);
  const status = await first.client
    .from("orders")
    .update({ status: "collected" })
    .eq("id", order.orderId!);
  assert.ok(status.error);
  const remove = await first.client
    .from("orders")
    .delete()
    .eq("id", order.orderId!);
  assert.ok(remove.error);
  assert.equal(await stockOf(mugId), 4);

  // Seller connections are never readable from the browser.
  const connections = await first.client
    .from("provider_connections")
    .select("id");
  assert.ok(connections.error);
});

test("staff read their own booth's orders and no other booth's", async () => {
  const mine = await newBooth();
  const theirs = await newBooth();
  const staffId = await newUser();
  await admin
    .from("vendor_staff")
    .insert({ user_id: staffId, vendor_id: mine.vendorId });
  const attendee = await newUser();
  const myOrder = await createPending(attendee, mine.boothId, [
    { productId: mine.mugId, quantity: 1 },
  ]);
  const theirOrder = await createPending(attendee, theirs.boothId, [
    { productId: theirs.mugId, quantity: 1 },
  ]);

  // Sign in as the staff user with a password, as a vendor does.
  const password = randomUUID();
  await admin.auth.admin.updateUserById(staffId, { password });
  const { data: user } = await admin.auth.admin.getUserById(staffId);
  const staff = createClient(stack.url, stack.publishableKey, authOptions);
  const signedIn = await staff.auth.signInWithPassword({
    email: user.user!.email!,
    password,
  });
  assert.equal(signedIn.error, null);

  const visible = await staff.from("orders").select("id");
  const ids = (visible.data ?? []).map((o) => o.id);
  assert.ok(ids.includes(myOrder.orderId));
  assert.ok(!ids.includes(theirOrder.orderId));
});

test("releases the stock at once when Square refused to create the checkout", async () => {
  const { boothId, limitedId } = await newBooth();
  const userId = await newUser();
  const order = await createPending(userId, boothId, [
    { productId: limitedId, quantity: 1 },
  ]);
  assert.equal(await stockOf(limitedId), 0);

  // Nothing was attached, so there is no Square link to close: pass null.
  assert.deepEqual(
    await call("svc_release_checkout", {
      p_order_id: order.orderId,
      p_provider_order_id: null,
    }),
    { ok: true, changed: true },
  );
  assert.equal(await stockOf(limitedId), 1);

  // The last item can be ordered again straight away.
  const retry = await createPending(await newUser(), boothId, [
    { productId: limitedId, quantity: 1 },
  ]);
  assert.equal(retry.ok, true);

  // Releasing twice returns the stock once.
  assert.deepEqual(
    await call("svc_release_checkout", {
      p_order_id: order.orderId,
      p_provider_order_id: null,
    }),
    { ok: true, changed: false },
  );
  assert.equal(await stockOf(limitedId), 0);
});

test("releases an attached checkout only when the closed Square order matches", async () => {
  const { boothId, mugId } = await newBooth();
  const order = await createPending(await newUser(), boothId, [
    { productId: mugId, quantity: 2 },
  ]);
  await call("svc_attach_checkout", {
    p_order_id: order.orderId,
    p_checkout_link_id: "LINK_R",
    p_provider_order_id: "SQ_R",
  });

  // Releasing without proof that the link was closed is refused, with the hold still open.
  for (const wrong of [null, "OTHER"]) {
    const refused = await call("svc_release_checkout", {
      p_order_id: order.orderId,
      p_provider_order_id: wrong,
    });
    assert.equal(refused.reason, "provider_order_mismatch");
  }
  assert.equal(await stockOf(mugId), 3);

  assert.deepEqual(
    await call("svc_release_checkout", {
      p_order_id: order.orderId,
      p_provider_order_id: "SQ_R",
    }),
    { ok: true, changed: true },
  );
  assert.equal(await stockOf(mugId), 5);

  // A checkout created after the release cannot be attached to the expired order.
  const late = await call("svc_attach_checkout", {
    p_order_id: order.orderId,
    p_checkout_link_id: "LINK_LATE",
    p_provider_order_id: "SQ_LATE",
  });
  assert.equal(late.reason, "not_pending");
});

test("a paid order is never released", async () => {
  const { boothId, mugId } = await newBooth();
  const order = await createPending(await newUser(), boothId, [
    { productId: mugId, quantity: 1 },
  ]);
  await admin
    .from("orders")
    .update({ status: "confirmed" })
    .eq("id", order.orderId!);

  const refused = await call("svc_release_checkout", {
    p_order_id: order.orderId,
    p_provider_order_id: null,
  });
  assert.equal(refused.reason, "not_pending");
  assert.equal(refused.status, "confirmed");
  assert.equal(await stockOf(mugId), 4);
});

test("an order with no hold end is not expired as overdue", async () => {
  const { boothId, mugId } = await newBooth();
  const order = await createPending(await newUser(), boothId, [
    { productId: mugId, quantity: 1 },
  ]);
  await admin
    .from("orders")
    .update({ hold_ends_at: null })
    .eq("id", order.orderId!);

  const refused = await call("svc_expire_checkout", {
    p_order_id: order.orderId,
    p_provider_order_id: null,
  });
  assert.equal(refused.reason, "hold_not_ended");
  assert.equal(await stockOf(mugId), 4);
});
