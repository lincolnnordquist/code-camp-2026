// Tests the real shared API (src/shared/api and src/shared/live) against the local
// Supabase: the same functions the screens call, with a browser-style session.
// Start the local Supabase first with `supabase start`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, test, vi } from "vitest";
import {
  admin,
  newAttendeeClient,
  newBooth,
  newStaffAccount,
  stack,
  stockOf,
  trackUser,
} from "./support";

// The client reads its address from the environment when it loads. Point it at the local
// stack explicitly, so these tests can never reach a hosted project named in .env.local.
vi.stubEnv("VITE_SUPABASE_URL", stack.url);
vi.stubEnv("VITE_SUPABASE_ANON_KEY", stack.publishableKey);
const api = await import("../../src/shared/api");
const live = await import("../../src/shared/live");
const { supabase } = await import("../../src/shared/api/client");
// `supabase.functions` makes a new object on each access, so mock the class they share.
const functionsClient = Object.getPrototypeOf(supabase.functions);

// Every user the app's own client signs in as is removed afterwards.
supabase.auth.onAuthStateChange((_event, session) => {
  if (session) trackUser(session.user.id);
});

afterAll(async () => {
  await supabase.auth.signOut();
});

async function waitFor<T>(read: () => T | undefined, ms = 45_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const item = (productId: string, quantity: number) => [{ productId, quantity }];
const request = (boothId: string, productId: string, quantity = 1) => ({
  boothId,
  items: item(productId, quantity),
  email: "buyer@example.com",
  requestId: randomUUID(),
});

test("reads the catalog without a session, with image addresses and the event's details", async () => {
  await supabase.auth.signOut();
  const result = await api.getEventCatalog("code-camp-2026");
  assert.ok(result.ok);
  const { event, booths, products } = result.value;

  // What the seed holds (names, how many booths) is checked in seed.test.ts. This checks
  // that what the database returns is shaped as the screens expect.
  assert.equal(event.slug, "code-camp-2026");
  assert.ok(event.name && event.venueName);
  assert.ok(
    event.floorPlanUrl === null || typeof event.floorPlanUrl === "string",
  );
  assert.ok(event.reservationHoldMinutes > 0);

  assert.ok(booths.length > 0);
  for (const booth of booths) {
    assert.ok(["prepay", "reservation", "discovery"].includes(booth.mode));
    assert.match(
      booth.logoUrl,
      /^http.*\/storage\/v1\/object\/public\/assets\/vendors\//,
    );
    assert.match(booth.bannerUrl, /\/assets\/vendors\//);
    assert.ok(booth.slogan && booth.vendorName && booth.code);
    assert.equal(typeof booth.mapX, "number");
    assert.equal(typeof booth.orderingPaused, "boolean");
  }

  assert.ok(products.length > 0);
  const boothIds = new Set(booths.map((b) => b.id));
  for (const product of products) {
    assert.ok(boothIds.has(product.boothId), "a product of an unknown booth");
    assert.match(product.imageUrl, /\/assets\/products\//);
    assert.ok(product.description);
    assert.equal(Number.isInteger(product.priceCents), true);
    // A product with extra photos lists them all, the main photo first.
    if (product.images) {
      assert.equal(product.images[0], product.imageUrl);
      assert.ok(product.images.length > 1);
      for (const url of product.images) assert.match(url, /\/assets\/products\//);
    }
  }
  assert.ok(products.some((p) => p.images), "no product has extra photos");
  // Reading never signs anyone in.
  assert.equal((await supabase.auth.getSession()).data.session, null);
});

test("an unknown event is a refusal", async () => {
  assert.deepEqual(await api.getEventCatalog("no-such-event"), {
    ok: false,
    reason: "event_not_found",
  });
});

test("the first reservation signs the browser in, and the order shows in the attendee's list", async () => {
  await supabase.auth.signOut();
  const booth = await newBooth({ mode: "reservation", connection: false });
  assert.deepEqual(await api.listMyOrders(), []);
  assert.equal((await supabase.auth.getSession()).data.session, null);

  const placed = await api.createReservation(
    request(booth.boothId, booth.mugId, 2),
  );
  assert.ok(placed.ok);
  const order = placed.value;
  assert.equal(
    (await supabase.auth.getSession()).data.session?.user.is_anonymous,
    true,
  );
  assert.equal(order.type, "reservation");
  assert.equal(order.status, "confirmed");
  assert.equal(order.totalCents, 6400);
  assert.match(order.pickupCode, /^\d{4}$/);
  assert.ok(order.boothCode && order.boothName && order.eventId);
  assert.equal(order.refundStatus, "none");
  assert.ok(!Number.isNaN(Date.parse(order.createdAt)));
  assert.deepEqual(
    order.items.map(({ name, quantity, unitPriceCents }) => ({
      name,
      quantity,
      unitPriceCents,
    })),
    [{ name: "Mug", quantity: 2, unitPriceCents: 3200 }],
  );

  const listed = await api.listMyOrders();
  assert.deepEqual(
    listed.map((o) => o.id),
    [order.id],
  );
  assert.deepEqual(listed[0], order);
  const fetched = await api.getOrder(order.id);
  assert.ok(fetched.ok);
  assert.deepEqual(fetched.value, order);
});

test("a repeated request returns the first order, and refusals carry their reason and products", async () => {
  const booth = await newBooth({ mode: "reservation", connection: false });
  const same = request(booth.boothId, booth.mugId);
  const first = await api.createReservation(same);
  const second = await api.createReservation(same);
  assert.ok(first.ok && second.ok);
  assert.equal(second.value.id, first.value.id);
  assert.equal(await stockOf(booth.mugId), 4);

  const over = await api.createReservation(
    request(booth.boothId, booth.mugId, 3),
  );
  assert.ok(!over.ok);
  assert.equal(over.reason, "over_max_per_order");
  assert.deepEqual(over.productIds, [booth.mugId]);

  const sold = await api.createReservation(
    request(booth.boothId, booth.limitedId, 1),
  );
  assert.ok(sold.ok);
  const none = await api.createReservation(
    request(booth.boothId, booth.limitedId, 1),
  );
  assert.ok(!none.ok);
  assert.equal(none.reason, "insufficient_stock");
  assert.deepEqual(none.productIds, [booth.limitedId]);

  const prepay = await newBooth({ mode: "prepay" });
  const wrong = await api.createReservation(
    request(prepay.boothId, prepay.mugId),
  );
  assert.ok(!wrong.ok);
  assert.equal(wrong.reason, "booth_not_accepting_orders");
});

test("an attendee cancels their own order, and cannot see or cancel another's", async () => {
  const booth = await newBooth({ mode: "reservation", connection: false });
  const mine = await api.createReservation(
    request(booth.boothId, booth.mugId, 2),
  );
  assert.ok(mine.ok);
  assert.equal(await stockOf(booth.mugId), 3);

  // Another browser, another attendee.
  const other = await newAttendeeClient();
  const theirs = await other.client.rpc("create_reservation", {
    p_booth_id: booth.boothId,
    p_items: item(booth.mugId, 1),
    p_email: "other@example.com",
    p_request_id: randomUUID(),
  });
  const theirId = (theirs.data as { orderId: string }).orderId;

  const peek = await api.getOrder(theirId);
  assert.deepEqual(peek, { ok: false, reason: "order_not_found" });
  const steal = await api.cancelMyOrder(theirId);
  assert.deepEqual(steal, { ok: false, reason: "order_not_found" });
  assert.ok(!(await api.listMyOrders()).some((o) => o.id === theirId));

  const cancelled = await api.cancelMyOrder(mine.value.id);
  assert.ok(cancelled.ok);
  assert.equal(cancelled.value.status, "cancelled");
  assert.equal(await stockOf(booth.mugId), 4);
  const again = await api.cancelMyOrder(mine.value.id);
  assert.ok(!again.ok);
  assert.equal(again.reason, "not_allowed_in_status");
});

test("the private link opens one order with no session, and a bad link is just not found", async () => {
  const booth = await newBooth({ mode: "reservation", connection: false });
  const placed = await api.createReservation(
    request(booth.boothId, booth.mugId),
  );
  assert.ok(placed.ok);
  const { data } = await admin
    .from("orders")
    .select("private_token")
    .eq("id", placed.value.id)
    .single();

  await supabase.auth.signOut();
  const opened = await api.getOrderByToken(data!.private_token);
  assert.ok(opened.ok);
  assert.equal(opened.value.id, placed.value.id);
  assert.equal(opened.value.pickupCode, placed.value.pickupCode);
  assert.equal((await supabase.auth.getSession()).data.session, null);

  for (const bad of [randomUUID(), "not-a-token", "", "' or 1=1 --"]) {
    assert.deepEqual(await api.getOrderByToken(bad), {
      ok: false,
      reason: "order_not_found",
    });
  }
});

test("a failure to reach the server is thrown, not returned as a refusal", async () => {
  const failing = vi.spyOn(supabase, "rpc").mockResolvedValue({
    data: null,
    error: { message: "Failed to fetch" },
  } as never);
  await assert.rejects(api.getOrderByToken(randomUUID()), /Failed to fetch/);
  failing.mockRestore();

  const down = vi.spyOn(supabase, "from").mockImplementation(() => {
    throw new Error("offline");
  });
  await assert.rejects(api.getEventCatalog("code-camp-2026"), /offline/);
  down.mockRestore();
});

test("starting a checkout calls the create-checkout function and returns the order and its address", async () => {
  const booth = await newBooth({ mode: "prepay" });
  const wire = {
    ok: true,
    orderId: randomUUID(),
    boothId: booth.boothId,
    eventId: randomUUID(),
    boothCode: "B4",
    boothName: "Moon Ceramics",
    type: "prepaid",
    status: "pending_payment",
    pickupCode: "4821",
    holdEndsAt: new Date(Date.now() + 900_000).toISOString(),
    totalCents: 3200,
    currency: "USD",
    createdAt: new Date().toISOString(),
    collectedAt: null,
    cancelReason: null,
    refundStatus: "none",
    items: [
      {
        productId: booth.mugId,
        name: "Mug",
        quantity: 1,
        unitPriceCents: 3200,
      },
    ],
    checkoutUrl: "https://square.example/checkout/abc",
  };
  const body = request(booth.boothId, booth.mugId);
  const invoke = vi
    .spyOn(functionsClient, "invoke")
    .mockResolvedValueOnce({ data: wire, error: null })
    .mockResolvedValueOnce({
      data: { ok: false, reason: "checkout_unavailable" },
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        ok: false,
        reason: "insufficient_stock",
        productIds: [booth.mugId],
      },
      error: null,
    })
    .mockResolvedValueOnce({ data: null, error: { message: "boom" } } as never);

  const started = await api.startCheckout(body);
  assert.ok(started.ok);
  assert.equal(
    started.value.checkoutUrl,
    "https://square.example/checkout/abc",
  );
  assert.equal(started.value.order.id, wire.orderId);
  assert.equal(started.value.order.status, "pending_payment");
  assert.deepEqual(invoke.mock.calls[0], ["create-checkout", { body }]);

  assert.deepEqual(await api.startCheckout(body), {
    ok: false,
    reason: "checkout_unavailable",
  });
  const stock = await api.startCheckout(body);
  assert.ok(!stock.ok);
  assert.deepEqual(stock.productIds, [booth.mugId]);
  await assert.rejects(api.startCheckout(body), /boom/);
  invoke.mockRestore();
});

test("confirming a checkout calls confirm-checkout and then reads the order's real status", async () => {
  const booth = await newBooth({ mode: "reservation", connection: false });
  const placed = await api.createReservation(
    request(booth.boothId, booth.mugId),
  );
  assert.ok(placed.ok);
  const invoke = vi
    .spyOn(functionsClient, "invoke")
    .mockResolvedValueOnce({
      data: { ok: true, orderId: placed.value.id },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { ok: false, reason: "payment_not_verified" },
      error: null,
    });

  const confirmed = await api.confirmCheckout(placed.value.id);
  assert.ok(confirmed.ok);
  assert.equal(confirmed.value.id, placed.value.id);
  assert.deepEqual(invoke.mock.calls[0], [
    "confirm-checkout",
    { body: { orderId: placed.value.id } },
  ]);

  assert.deepEqual(await api.confirmCheckout(placed.value.id), {
    ok: false,
    reason: "payment_not_verified",
  });
  invoke.mockRestore();
});

test("vendor staff sign in, run their booth's orders, and cannot see another booth's", async () => {
  const mine = await newBooth({ mode: "reservation", connection: false });
  const theirs = await newBooth({ mode: "reservation", connection: false });
  const account = await newStaffAccount(mine.vendorId);

  assert.deepEqual(await api.signInVendor(account.email, "wrong-password"), {
    ok: false,
    reason: "invalid_credentials",
  });
  const noBooth = await newStaffAccount((await newBooth()).vendorId);
  await admin
    .from("booths")
    .delete()
    .eq(
      "vendor_id",
      (
        await admin
          .from("vendor_staff")
          .select("vendor_id")
          .eq("user_id", noBooth.userId)
          .single()
      ).data!.vendor_id,
    );
  assert.deepEqual(await api.signInVendor(noBooth.email, noBooth.password), {
    ok: false,
    reason: "no_booth",
  });

  // An attendee places an order at each booth.
  await supabase.auth.signOut();
  const attendee = await newAttendeeClient();
  const place = async (boothId: string, productId: string) =>
    (
      await attendee.client.rpc("create_reservation", {
        p_booth_id: boothId,
        p_items: item(productId, 1),
        p_email: "buyer@example.com",
        p_request_id: randomUUID(),
      })
    ).data as { orderId: string; pickupCode: string };
  const ours = await place(mine.boothId, mine.mugId);
  const notOurs = await place(theirs.boothId, theirs.mugId);

  const signedIn = await api.signInVendor(account.email, account.password);
  assert.ok(signedIn.ok);
  assert.equal(signedIn.value.boothId, mine.boothId);

  const queue = await api.listBoothOrders(mine.boothId);
  assert.deepEqual(
    queue.map((o) => o.id),
    [ours.orderId],
  );
  assert.deepEqual(await api.listBoothOrders(theirs.boothId), []);
  assert.ok(!queue.some((o) => o.id === notOurs.orderId));

  const ready = await api.markOrderReady(ours.orderId);
  assert.ok(ready.ok);
  assert.equal(ready.value.status, "ready");
  assert.equal((await api.markOrderReady(notOurs.orderId)).ok, false);

  assert.deepEqual(await api.collectOrder(theirs.boothId, notOurs.pickupCode), {
    ok: false,
    reason: "not_found",
  });
  const collected = await api.collectOrder(mine.boothId, ours.pickupCode);
  assert.ok(collected.ok);
  assert.equal(collected.value.status, "collected");
  const again = await api.collectOrder(mine.boothId, ours.pickupCode);
  assert.ok(!again.ok);
  assert.equal(again.reason, "already_collected");
  assert.ok(again.at);

  const stock = await api.setProductStock(mine.mugId, 9);
  assert.deepEqual(stock, { ok: true, value: { availableQty: 9 } });
  const bad = await api.setProductStock(mine.mugId, -1);
  assert.ok(!bad.ok);
  assert.equal(bad.reason, "invalid_quantity");
  assert.equal((await api.setProductStock(theirs.mugId, 9)).ok, false);

  assert.deepEqual(await api.setOrderingPaused(mine.boothId, true), {
    ok: true,
    value: { paused: true },
  });
  assert.deepEqual(await api.setOrderingPaused(mine.boothId, false), {
    ok: true,
    value: { paused: false },
  });
  assert.equal((await api.setOrderingPaused(theirs.boothId, true)).ok, false);

  // Cancelling needs a reason.
  const second = await place(mine.boothId, mine.mugId);
  const noReason = await api.cancelOrder(second.orderId, " ");
  assert.ok(!noReason.ok);
  assert.equal(noReason.reason, "reason_required");
  const cancelled = await api.cancelOrder(second.orderId, "Out of stock");
  assert.ok(cancelled.ok);
  assert.equal(cancelled.value.cancelReason, "Out of stock");

  await api.signOut();
  assert.equal((await supabase.auth.getSession()).data.session, null);
});

test("an attendee's orders arrive live, starting from a browser with no session", async () => {
  await supabase.auth.signOut();
  const booth = await newBooth({ mode: "reservation", connection: false });
  const seen: number[] = [];
  const unsubscribe = live.subscribeToMyOrders((orders) =>
    seen.push(orders.length),
  );

  try {
    // The first order creates the session; the subscription starts once it exists.
    const placed = await api.createReservation(
      request(booth.boothId, booth.mugId),
    );
    assert.ok(placed.ok);
    await waitFor(() => (seen.includes(1) ? true : undefined));

    // Changes made elsewhere arrive without asking.
    await admin
      .from("orders")
      .update({ status: "ready" })
      .eq("id", placed.value.id);
    const second = await api.createReservation(
      request(booth.boothId, booth.mugId),
    );
    assert.ok(second.ok);
    await waitFor(() => (seen.includes(2) ? true : undefined));
  } finally {
    unsubscribe();
  }

  const after = seen.length;
  await api.createReservation(request(booth.boothId, booth.mugId));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(seen.length, after, "a closed subscription still called back");
}, 120_000);

test("a booth's orders arrive live for its staff only", async () => {
  await supabase.auth.signOut();
  const mine = await newBooth({ mode: "reservation", connection: false });
  const theirs = await newBooth({ mode: "reservation", connection: false });
  const account = await newStaffAccount(mine.vendorId);
  const signedIn = await api.signInVendor(account.email, account.password);
  assert.ok(signedIn.ok);

  const seen: string[][] = [];
  const unsubscribe = live.subscribeToBoothOrders(mine.boothId, (orders) =>
    seen.push(orders.map((o) => o.boothId)),
  );
  try {
    const attendee = await newAttendeeClient();
    const place = (boothId: string, productId: string) =>
      attendee.client.rpc("create_reservation", {
        p_booth_id: boothId,
        p_items: item(productId, 1),
        p_email: "buyer@example.com",
        p_request_id: randomUUID(),
      });
    await place(theirs.boothId, theirs.mugId);
    await place(mine.boothId, mine.mugId);
    await waitFor(() => (seen.some((s) => s.length === 1) ? true : undefined));
    assert.ok(seen.every((s) => s.every((id) => id === mine.boothId)));
  } finally {
    unsubscribe();
    await api.signOut();
  }
}, 120_000);

test("a vendor's own booth loads with its event and products, and only while signed in as a vendor", async () => {
  await supabase.auth.signOut();
  const mine = await newBooth({ mode: "reservation", connection: false });
  const theirs = await newBooth({ mode: "reservation", connection: false });

  // No session at all, then an attendee's anonymous session: neither is a vendor.
  assert.deepEqual(await api.getMyBooth(), {
    ok: false,
    reason: "not_signed_in",
  });
  const placed = await api.createReservation(request(mine.boothId, mine.mugId));
  assert.ok(placed.ok);
  assert.equal(
    (await supabase.auth.getSession()).data.session?.user.is_anonymous,
    true,
  );
  assert.deepEqual(await api.getMyBooth(), {
    ok: false,
    reason: "not_signed_in",
  });

  const account = await newStaffAccount(mine.vendorId);
  const signedIn = await api.signInVendor(account.email, account.password);
  assert.ok(signedIn.ok);

  const result = await api.getMyBooth();
  assert.ok(result.ok);
  const { event, booth, products } = result.value;
  assert.equal(booth.id, mine.boothId);
  assert.equal(booth.vendorName, "Test vendor");
  assert.equal(booth.mode, "reservation");
  assert.equal(booth.orderingPaused, false);
  assert.match(booth.logoUrl, /\/storage\/v1\/object\/public\/assets\//);
  assert.ok(event.id && event.slug && event.venueName);
  // Only this booth's products, with their stock.
  assert.deepEqual(
    products.map((p) => p.id).sort(),
    [mine.limitedId, mine.mugId].sort(),
  );
  assert.ok(!products.some((p) => p.id === theirs.mugId));
  assert.equal(products.find((p) => p.id === mine.mugId)?.availableQty, 4);

  // It shows the booth as it is now.
  await api.setOrderingPaused(mine.boothId, true);
  await api.setProductStock(mine.mugId, 9);
  const after = await api.getMyBooth();
  assert.ok(after.ok);
  assert.equal(after.value.booth.orderingPaused, true);
  assert.equal(
    after.value.products.find((p) => p.id === mine.mugId)?.availableQty,
    9,
  );

  await api.signOut();
  assert.deepEqual(await api.getMyBooth(), {
    ok: false,
    reason: "not_signed_in",
  });
});

test("a signed-in staff member with no booth gets no_booth, and a failure to reach the server is thrown", async () => {
  await supabase.auth.signOut();
  const { vendorId, boothId } = await newBooth({
    mode: "reservation",
    connection: false,
  });
  const account = await newStaffAccount(vendorId);
  await admin.from("booths").delete().eq("id", boothId);

  // Signed in directly, so that the vendor sign-in does not sign them out again.
  const direct = await supabase.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  assert.equal(direct.error, null);
  assert.deepEqual(await api.getMyBooth(), { ok: false, reason: "no_booth" });

  const down = vi.spyOn(supabase, "from").mockImplementation(() => {
    throw new Error("offline");
  });
  await assert.rejects(api.getMyBooth(), /offline/);
  down.mockRestore();
  await supabase.auth.signOut();
});
