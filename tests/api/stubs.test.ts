// Checks that the shared API functions can be called and follow the main rules.
// These run against the sample-data stubs. When the real Supabase calls replace the
// stubs, the order and access tests that run against the local database take over.
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  cancelMyOrder,
  collectOrder,
  createReservation,
  getEventCatalog,
  getOrder,
  listBoothOrders,
  listMyOrders,
  markOrderReady,
  setOrderingPaused,
  setProductStock,
} from "../../src/shared/api";

const email = "attendee@example.com";

// Ids from the demo catalog (sample-store.ts, the same as supabase/seed.sql).
const PIXEL_FORGE = "b0000000-0000-0000-0000-00000000000a"; // reservation
const CRITICAL_HIT = "b0000000-0000-0000-0000-00000000000b"; // prepay
const INKWELL = "b0000000-0000-0000-0000-00000000000c"; // discovery
const SCOUT_REGIMENT = "b0000000-0000-0000-0000-00000000000f"; // reservation
const NIGHT_CITY_PRINT = "a0000000-0000-0000-0000-000000000005"; // $18.00, at most 3 per order
const GUNDAM_KIT = "a0000000-0000-0000-0000-000000000009"; // one in stock
const SKETCH_CARD = "a0000000-0000-0000-0000-000000000011";

test("returns the demo event with booths and products", async () => {
  const result = await getEventCatalog("code-camp-2026");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.booths.length, 7);
    assert.ok(result.value.products.length > 0);
  }
});

test("catalog items carry photos, descriptions and vendor branding", async () => {
  const result = await getEventCatalog("code-camp-2026");
  assert.ok(result.ok);
  assert.equal(result.value.event.floorPlanUrl, null);
  assert.ok(result.value.event.venueName);
  for (const booth of result.value.booths) {
    assert.ok(booth.logoUrl && booth.slogan && booth.bannerUrl);
  }
  for (const product of result.value.products) {
    assert.ok(product.imageUrl && product.description);
  }
});

test("refuses an unknown event", async () => {
  assert.deepEqual(await getEventCatalog("nope"), {
    ok: false,
    reason: "event_not_found",
  });
});

test("reserves, shows up for the vendor, becomes ready, and is collected", async () => {
  const reserved = await createReservation({
    boothId: PIXEL_FORGE,
    items: [{ productId: NIGHT_CITY_PRINT, quantity: 2 }],
    email,
    requestId: "journey-1",
  });
  assert.ok(reserved.ok);
  const order = reserved.value;
  assert.equal(order.status, "confirmed");
  assert.equal(order.totalCents, 3600);
  assert.match(order.pickupCode, /^\d{4}$/);

  assert.ok((await listMyOrders()).some((o) => o.id === order.id));
  assert.ok((await listBoothOrders(PIXEL_FORGE)).some((o) => o.id === order.id));

  const ready = await markOrderReady(order.id);
  assert.ok(ready.ok);
  assert.equal(ready.value.status, "ready");

  assert.deepEqual(await collectOrder(CRITICAL_HIT, order.pickupCode), {
    ok: false,
    reason: "not_found",
  });

  const collected = await collectOrder(PIXEL_FORGE, order.pickupCode);
  assert.ok(collected.ok);
  assert.equal(collected.value.status, "collected");

  const again = await collectOrder(PIXEL_FORGE, order.pickupCode);
  assert.ok(!again.ok);
  assert.equal(again.reason, "already_collected");
});

test("returns the first order when the same request is sent twice", async () => {
  const request = {
    boothId: PIXEL_FORGE,
    items: [{ productId: NIGHT_CITY_PRINT, quantity: 1 }],
    email,
    requestId: "retry-1",
  };
  const first = await createReservation(request);
  const second = await createReservation(request);
  assert.ok(first.ok && second.ok);
  assert.equal(first.value.id, second.value.id);
});

test("gives the last item to only one of two requests", async () => {
  const reserve = (requestId: string) =>
    createReservation({
      boothId: SCOUT_REGIMENT,
      items: [{ productId: GUNDAM_KIT, quantity: 1 }],
      email,
      requestId,
    });
  const [a, b] = await Promise.all([reserve("last-1"), reserve("last-2")]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1);
  const refused = a.ok ? b : a;
  assert.ok(!refused.ok);
  assert.equal(refused.reason, "insufficient_stock");
});

test("returns stock when a reservation is cancelled", async () => {
  await setProductStock(NIGHT_CITY_PRINT, 5);
  const reserved = await createReservation({
    boothId: PIXEL_FORGE,
    items: [{ productId: NIGHT_CITY_PRINT, quantity: 3 }],
    email,
    requestId: "cancel-1",
  });
  assert.ok(reserved.ok);
  const cancelled = await cancelMyOrder(reserved.value.id);
  assert.ok(cancelled.ok);
  assert.equal(cancelled.value.status, "cancelled");
  const catalog = await getEventCatalog("code-camp-2026");
  assert.ok(catalog.ok);
  assert.equal(
    catalog.value.products.find((p) => p.id === NIGHT_CITY_PRINT)?.availableQty,
    5,
  );
  assert.ok((await getOrder(reserved.value.id)).ok);
});

test("refuses a reservation above the per-order maximum", async () => {
  const result = await createReservation({
    boothId: PIXEL_FORGE,
    items: [{ productId: NIGHT_CITY_PRINT, quantity: 4 }],
    email,
    requestId: "max-1",
  });
  assert.ok(!result.ok);
  assert.equal(result.reason, "over_max_per_order");
});

test("refuses a reservation at a paused booth and at a discovery booth", async () => {
  await setOrderingPaused(PIXEL_FORGE, true);
  const paused = await createReservation({
    boothId: PIXEL_FORGE,
    items: [{ productId: NIGHT_CITY_PRINT, quantity: 1 }],
    email,
    requestId: "paused-1",
  });
  assert.ok(!paused.ok);
  assert.equal(paused.reason, "ordering_paused");
  await setOrderingPaused(PIXEL_FORGE, false);

  const discovery = await createReservation({
    boothId: INKWELL,
    items: [{ productId: SKETCH_CARD, quantity: 1 }],
    email,
    requestId: "discovery-1",
  });
  assert.ok(!discovery.ok);
  assert.equal(discovery.reason, "booth_not_accepting_orders");
});
