// Tests what the attendee screens read: branding, photos, order details with a refund
// state, cancelling any attendee order, and opening an order from its emailed link.
// Start the local Supabase first with `supabase start`, and upload the demo images with
// `supabase seed buckets`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  admin,
  authOptions,
  call,
  callAs,
  insert,
  newAttendeeClient,
  newBooth,
  newStaffClient,
  stack,
  stockOf,
} from "./support";

async function prepaidOrder(boothId: string, mugId: string, userId: string) {
  const order = await call("svc_create_pending_order", {
    p_user_id: userId,
    p_booth_id: boothId,
    p_items: [{ productId: mugId, quantity: 2 }],
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
    amount_cents: 6400,
    currency: "USD",
  });
  return order;
}

test("the demo images are served from the public storage bucket", async () => {
  const response = await fetch(
    `${stack.url}/storage/v1/object/public/assets/placeholders/logo.svg`,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /svg/);
});

test("every image path in the seed is served from the public storage bucket", async () => {
  const { data: vendors } = await admin
    .from("vendors")
    .select("logo_path, banner_path");
  const { data: products } = await admin
    .from("products")
    .select("image_path, image_paths");
  const paths = [
    ...(vendors ?? []).flatMap((v) => [v.logo_path, v.banner_path]),
    ...(products ?? []).flatMap((p) => [p.image_path, ...p.image_paths]),
  ];
  assert.ok(paths.length > 0);
  for (const path of new Set(paths as string[])) {
    // Test fixtures use a path of their own; only the seeded vendors are checked.
    if (!/^(vendors|products)\//.test(path)) continue;
    const response = await fetch(
      `${stack.url}/storage/v1/object/public/assets/${path}`,
    );
    assert.equal(response.status, 200, `${path} is missing from the bucket`);
  }
});

test("vendor branding, product photos and descriptions, and the venue name are required", async () => {
  const { vendorId } = await newBooth();
  const branding = {
    name: "No branding",
    slogan: "x",
    logo_path: "l.svg",
    banner_path: "b.svg",
  };
  for (const missing of ["slogan", "logo_path", "banner_path"]) {
    for (const value of [null, "  "]) {
      const { error } = await admin
        .from("vendors")
        .insert({ ...branding, [missing]: value });
      assert.ok(error, `a vendor with ${missing} = ${value} was accepted`);
    }
  }

  const { boothId } = await newBooth();
  const product = {
    booth_id: boothId,
    name: "P",
    category: "C",
    description: "d",
    image_path: "p.svg",
    price_cents: 100,
    available_qty: 1,
  };
  for (const missing of ["description", "image_path"]) {
    for (const value of [null, ""]) {
      const { error } = await admin
        .from("products")
        .insert({ ...product, [missing]: value });
      assert.ok(error, `a product with ${missing} = ${value} was accepted`);
    }
  }

  const event = { slug: randomUUID(), name: "E", venue_name: "V" };
  assert.ok(
    (await admin.from("events").insert({ ...event, venue_name: null })).error,
  );
  // The floor plan image is the one optional part.
  const withoutMap = await admin
    .from("events")
    .insert(event)
    .select("id, floor_plan_url")
    .single();
  assert.equal(withoutMap.error, null);
  assert.equal(withoutMap.data?.floor_plan_url, null);
  await admin.from("events").delete().eq("id", withoutMap.data!.id);
  assert.ok(vendorId);
});

test("an attendee reads their own orders with the booth name and number, the event, and a refund state", async () => {
  const { boothId, mugId, vendorId } = await newBooth({
    mode: "reservation",
    connection: false,
  });
  const owner = await newAttendeeClient();
  const stranger = await newAttendeeClient();
  const order = await callAs(owner.client, "create_reservation", {
    p_booth_id: boothId,
    p_items: [{ productId: mugId, quantity: 1 }],
    p_email: "buyer@example.com",
    p_request_id: randomUUID(),
  });

  const { data: booth } = await admin
    .from("booths")
    .select("code, event_id")
    .eq("id", boothId)
    .single();
  const { data: vendor } = await admin
    .from("vendors")
    .select("name")
    .eq("id", vendorId)
    .single();

  const mine = await owner.client
    .from("order_details")
    .select("*")
    .eq("id", order.orderId!)
    .single();
  assert.equal(mine.error, null);
  assert.equal(mine.data?.booth_code, booth?.code);
  assert.equal(mine.data?.booth_name, vendor?.name);
  assert.equal(mine.data?.event_id, booth?.event_id);
  assert.equal(mine.data?.refund_status, "none");
  // The view carries no email address and no private link token.
  assert.deepEqual(
    Object.keys(mine.data ?? {}).filter((key) =>
      ["email", "private_token", "checkout_link_id"].includes(key),
    ),
    [],
  );

  const theirs = await stranger.client
    .from("order_details")
    .select("id")
    .eq("id", order.orderId!);
  assert.equal(theirs.data?.length, 0);

  const noSession = createClient(stack.url, stack.publishableKey, authOptions);
  assert.ok((await noSession.from("order_details").select("id")).error);
});

test("an attendee cancels a prepaid order: stock returns and a refund is owed", async () => {
  const booth = await newBooth({ mode: "prepay" });
  const { client, userId } = await newAttendeeClient();
  const order = await prepaidOrder(booth.boothId, booth.mugId, userId);
  assert.equal(await stockOf(booth.mugId), 3);

  const cancelled = await callAs(client, "cancel_my_order", {
    p_order_id: order.orderId,
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.refundStatus, "due");
  assert.equal(await stockOf(booth.mugId), 5);

  const view = await client
    .from("order_details")
    .select("status, refund_status")
    .eq("id", order.orderId!)
    .single();
  assert.deepEqual(view.data, { status: "cancelled", refund_status: "due" });

  // Refunding in Square later turns it to refunded.
  await admin
    .from("payments")
    .update({ refund_status: "refunded" })
    .eq("order_id", order.orderId!);
  const after = await client
    .from("order_details")
    .select("refund_status")
    .eq("id", order.orderId!)
    .single();
  assert.equal(after.data?.refund_status, "refunded");

  // A second cancel changes nothing.
  const again = await callAs(client, "cancel_my_order", {
    p_order_id: order.orderId,
  });
  assert.equal(again.reason, "not_allowed_in_status");
  assert.equal(await stockOf(booth.mugId), 5);
});

test("an attendee cannot cancel someone else's order or an unpaid checkout", async () => {
  const booth = await newBooth({ mode: "prepay" });
  const owner = await newAttendeeClient();
  const stranger = await newAttendeeClient();
  const paid = await prepaidOrder(booth.boothId, booth.mugId, owner.userId);

  const refused = await callAs(stranger.client, "cancel_my_order", {
    p_order_id: paid.orderId,
  });
  assert.equal(refused.reason, "order_not_found");
  assert.equal(await stockOf(booth.mugId), 3);

  const pending = await call("svc_create_pending_order", {
    p_user_id: owner.userId,
    p_booth_id: booth.boothId,
    p_items: [{ productId: booth.mugId, quantity: 1 }],
    p_email: "buyer@example.com",
    p_request_id: randomUUID(),
  });
  const unpaid = await callAs(owner.client, "cancel_my_order", {
    p_order_id: pending.orderId,
  });
  assert.equal(unpaid.reason, "not_allowed_in_status");
});

test("a vendor cancelling a prepaid order shows the attendee a refund owed", async () => {
  const booth = await newBooth({ mode: "prepay" });
  const staff = await newStaffClient(booth.vendorId);
  const { client, userId } = await newAttendeeClient();
  const order = await prepaidOrder(booth.boothId, booth.mugId, userId);

  await callAs(staff, "cancel_order", {
    p_order_id: order.orderId,
    p_reason: "Out of stock",
  });
  const view = await client
    .from("order_details")
    .select("status, refund_status, cancel_reason")
    .eq("id", order.orderId!)
    .single();
  assert.deepEqual(view.data, {
    status: "cancelled",
    refund_status: "due",
    cancel_reason: "Out of stock",
  });
});

test("an order opens from its emailed link on a device with no session, and shows nothing private", async () => {
  const { boothId, mugId } = await newBooth({
    mode: "reservation",
    connection: false,
  });
  const { client } = await newAttendeeClient();
  const order = await callAs(client, "create_reservation", {
    p_booth_id: boothId,
    p_items: [{ productId: mugId, quantity: 2 }],
    p_email: "private@example.com",
    p_request_id: randomUUID(),
  });
  const { data } = await admin
    .from("orders")
    .select("private_token")
    .eq("id", order.orderId!)
    .single();

  const otherDevice = createClient(
    stack.url,
    stack.publishableKey,
    authOptions,
  );
  const opened = await otherDevice.rpc("get_order_by_token", {
    p_token: data!.private_token,
  });
  assert.equal(opened.error, null);
  const result = opened.data as Record<string, unknown>;
  assert.equal(result.ok, true);
  assert.equal(result.orderId, order.orderId);
  assert.equal(result.pickupCode, order.pickupCode);
  assert.equal(result.totalCents, 6400);
  assert.equal(result.refundStatus, "none");
  assert.ok(result.boothCode && result.boothName && result.eventId);
  assert.equal((result.items as unknown[]).length, 1);
  const text = JSON.stringify(result);
  assert.ok(!text.includes("private@example.com"), "the email was returned");
  assert.ok(!text.includes(data!.private_token), "the token was returned");
  for (const key of ["buyerEmail", "checkoutLinkId", "providerOrderId"]) {
    assert.ok(!(key in result), `${key} was returned`);
  }

  // A token that does not exist gets one flat refusal.
  const unknown = await otherDevice.rpc("get_order_by_token", {
    p_token: randomUUID(),
  });
  assert.deepEqual(unknown.data, { ok: false, reason: "order_not_found" });
});

test("a placed order reports its booth and refund state", async () => {
  const { boothId, mugId } = await newBooth({
    mode: "reservation",
    connection: false,
  });
  const { client } = await newAttendeeClient();
  const order = await callAs(client, "create_reservation", {
    p_booth_id: boothId,
    p_items: [{ productId: mugId, quantity: 1 }],
    p_email: "buyer@example.com",
    p_request_id: randomUUID(),
  });
  assert.equal(order.refundStatus, "none");
  assert.ok(order.boothCode && order.boothName);
});
