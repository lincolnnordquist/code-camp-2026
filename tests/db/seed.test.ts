// Checks the seeded demo event: its address, the hall's seven booths with one of each mode, and
// a working staff login for each vendor. Start the local Supabase first, with the seed loaded
// (`supabase db reset`). These tests read the seed and leave it unchanged.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, authOptions, callAs, stack } from "./support";

// One entry per seeded vendor. `paused` is the booth's seeded ordering state, which the sign-in
// test sets again so the seed stays as it is; `product` is one of the booth's products (Snag sells none).
const booths: { slug: string; mode: string; paused: boolean; booth: string; product?: string }[] = [
  {
    slug: "wall-rose-goods",
    mode: "reservation",
    paused: false,
    booth: "b0000000-0000-0000-0000-00000000000d",
    product: "a0000000-0000-0000-0000-000000000002",
  },
  {
    slug: "pixel-forge-prints",
    mode: "reservation",
    paused: false,
    booth: "b0000000-0000-0000-0000-00000000000a",
    product: "a0000000-0000-0000-0000-000000000004",
  },
  {
    slug: "critical-hit-dice",
    mode: "prepay",
    paused: false,
    booth: "b0000000-0000-0000-0000-00000000000b",
    product: "a0000000-0000-0000-0000-000000000006",
  },
  {
    slug: "soft-kaiju-plush",
    mode: "reservation",
    paused: true,
    booth: "b0000000-0000-0000-0000-00000000000e",
    product: "a0000000-0000-0000-0000-000000000008",
  },
  {
    slug: "scout-regiment-figures",
    mode: "reservation",
    paused: false,
    booth: "b0000000-0000-0000-0000-00000000000f",
    product: "a0000000-0000-0000-0000-000000000010",
  },
  {
    slug: "inkwell-artist-alley",
    mode: "discovery",
    paused: false,
    booth: "b0000000-0000-0000-0000-00000000000c",
    product: "a0000000-0000-0000-0000-000000000011",
  },
  {
    slug: "snag",
    mode: "discovery",
    paused: false,
    booth: "b0000000-0000-0000-0000-000000000010",
  },
];

test("the demo event is found by its slug, with the hall's booths and one of each mode", async () => {
  const { data: event } = await admin
    .from("events")
    .select("id, name, slug, venue_name")
    .eq("slug", "code-camp-2026")
    .single();
  assert.equal(event?.name, "Code Camp 2026");
  assert.equal(event?.venue_name, "Vasion Headquarters");

  const { data } = await admin
    .from("booths")
    .select("id, code, mode, ordering_paused")
    .eq("event_id", event!.id);
  assert.deepEqual(
    data?.map((b) => b.id).sort(),
    booths.map((b) => b.booth).sort(),
  );
  assert.deepEqual([...new Set(data?.map((b) => b.mode))].sort(), [
    "discovery",
    "prepay",
    "reservation",
  ]);
  for (const vendor of booths) {
    const row: { mode: string; ordering_paused: boolean } | undefined = data?.find(
      (b) => b.id === vendor.booth,
    );
    assert.equal(row?.mode, vendor.mode, `${vendor.slug} mode`);
    assert.equal(row?.ordering_paused, vendor.paused, `${vendor.slug} paused`);
  }
});

test("the demo catalog has 15 products, and Snag (H6) is a browse-only booth with none", async () => {
  const { data: products } = await admin
    .from("products")
    .select("booth_id, image_path")
    .in("booth_id", booths.map((b) => b.booth));
  assert.equal(products?.length, 15);
  for (const product of products ?? []) {
    assert.match(product.image_path, /^products\/[a-z0-9-]+\/[a-z0-9-]+\.webp$/);
  }
  const snag = booths.find((b) => b.slug === "snag")!;
  const { data: booth } = await admin
    .from("booths")
    .select("code, mode")
    .eq("id", snag.booth)
    .single();
  assert.deepEqual(booth, { code: "H6", mode: "discovery" });
  assert.equal(products?.filter((p) => p.booth_id === snag.booth).length, 0);
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

    // Setting ordering to its seeded value changes nothing, so the seed stays as it is.
    const own = await callAs(staff, "set_ordering_paused", {
      p_booth_id: vendor.booth,
      p_paused: vendor.paused,
    });
    assert.equal(own.ok, true, `${vendor.slug} cannot act for its own booth`);

    for (const other of booths.filter((b) => b !== vendor)) {
      const refused = await callAs(staff, "set_ordering_paused", {
        p_booth_id: other.booth,
        p_paused: other.paused,
      });
      assert.equal(refused.reason, "booth_not_found");
      if (!other.product) continue;
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
    email: "staff-pixel-forge-prints@example.com",
    password: "wrong-password",
  });
  assert.ok(error);
});
