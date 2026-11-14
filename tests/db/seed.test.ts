// Checks the seeded demo event: its address, one booth of each mode, and a working staff
// login for each vendor. Start the local Supabase first, with the seed loaded
// (`supabase db reset`). These tests read the seed and leave it unchanged.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, authOptions, callAs, stack } from "./support";

const booths = [
  {
    slug: "pixel-prints",
    mode: "reservation",
    booth: "b0000000-0000-0000-0000-00000000000a",
    product: "a0000000-0000-0000-0000-000000000002",
  },
  {
    slug: "moon-ceramics",
    mode: "prepay",
    booth: "b0000000-0000-0000-0000-00000000000b",
    product: "a0000000-0000-0000-0000-000000000003",
  },
  {
    slug: "old-maps-co",
    mode: "discovery",
    booth: "b0000000-0000-0000-0000-00000000000c",
    product: "a0000000-0000-0000-0000-000000000004",
  },
];

test("the demo event is found by its slug, with one booth of each mode", async () => {
  const { data: event } = await admin
    .from("events")
    .select("id, name, slug")
    .eq("slug", "code-camp-2026")
    .single();
  assert.equal(event?.name, "Code Camp 2026");

  const { data } = await admin
    .from("booths")
    .select("mode")
    .eq("event_id", event!.id);
  assert.deepEqual(data?.map((b) => b.mode).sort(), [
    "discovery",
    "prepay",
    "reservation",
  ]);
});

test("a slug must be lowercase words joined by single hyphens", async () => {
  const event = { name: "E", venue_name: "V" };
  for (const bad of [
    "Code Camp",
    "code_camp",
    "-code",
    "code-",
    "a--b",
    "é",
    "",
  ]) {
    const { error } = await admin
      .from("events")
      .insert({ ...event, slug: bad });
    assert.ok(error, `the slug "${bad}" was accepted`);
  }
  const good = `ok-${randomUUID().slice(0, 8)}`;
  const { error } = await admin.from("events").insert({ ...event, slug: good });
  assert.equal(error, null);
  await admin.from("events").delete().eq("slug", good);
});

test("each seeded vendor can sign in, and acts only for its own booth", async () => {
  for (const vendor of booths) {
    const staff = createClient(stack.url, stack.publishableKey, authOptions);
    const signedIn = await staff.auth.signInWithPassword({
      email: `staff-${vendor.slug}@example.com`,
      password: "demo-password",
    });
    assert.equal(signedIn.error, null, `${vendor.slug} could not sign in`);

    // Setting ordering to its current value changes nothing, so the seed stays as it is.
    const own = await callAs(staff, "set_ordering_paused", {
      p_booth_id: vendor.booth,
      p_paused: false,
    });
    assert.equal(own.ok, true, `${vendor.slug} cannot act for its own booth`);

    for (const other of booths.filter((b) => b !== vendor)) {
      const refused = await callAs(staff, "set_ordering_paused", {
        p_booth_id: other.booth,
        p_paused: false,
      });
      assert.equal(refused.reason, "booth_not_found");
      const stock = await callAs(staff, "set_product_stock", {
        p_product_id: other.product,
        p_available_qty: 0,
      });
      assert.equal(stock.reason, "product_not_found");
    }
  }
});

test("a wrong password does not sign in", async () => {
  const staff = createClient(stack.url, stack.publishableKey, authOptions);
  const { error } = await staff.auth.signInWithPassword({
    email: "staff-pixel-prints@example.com",
    password: "wrong-password",
  });
  assert.ok(error);
});
