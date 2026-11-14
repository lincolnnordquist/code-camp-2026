// Shared setup for the database tests. They run against the local Supabase, so start it
// first with `supabase start`. Each test builds its own booth, so tests do not depend on
// the seed or on each other, and everything created here is removed after each test file.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Reply = {
  ok: boolean;
  reason?: string;
  status?: string;
  changed?: boolean;
  productIds?: string[];
  orderId?: string;
  totalCents?: number;
  pickupCode?: string;
  holdEndsAt?: string;
  checkoutLinkId?: string | null;
  providerOrderId?: string | null;
  connection?: { tokenSecretName: string; locationId: string };
  items?: { name: string; quantity: number; unitPriceCents: number }[];
  orders?: { orderId: string }[];
  at?: string | null;
  type?: string;
  refundStatus?: string;
  boothCode?: string;
  boothName?: string;
  eventId?: string;
  availableQty?: number;
  paused?: boolean;
};

function localStack(): {
  url: string;
  publishableKey: string;
  serviceKey: string;
} {
  let status: Record<string, string>;
  try {
    status = JSON.parse(
      execFileSync("supabase", ["status", "-o", "json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).replace(/^[^{]*/, ""),
    );
  } catch {
    throw new Error(
      "The local Supabase is not running. Start it with `supabase start`.",
    );
  }
  return {
    url: status.API_URL,
    publishableKey: status.PUBLISHABLE_KEY,
    serviceKey: status.SERVICE_ROLE_KEY,
  };
}

export const stack = localStack();
export const authOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};
export const admin: SupabaseClient = createClient(
  stack.url,
  stack.serviceKey,
  authOptions,
);

const eventId = randomUUID();
const vendorIds: string[] = [];
const boothIds: string[] = [];
const userIds: string[] = [];

export async function newUser(): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${randomUUID()}@example.com`,
    email_confirm: true,
  });
  assert.equal(error, null);
  userIds.push(data.user!.id);
  return data.user!.id;
}

// A browser client: the publishable key plus an anonymous session, as an attendee gets.
export async function newAttendeeClient(): Promise<{
  client: SupabaseClient;
  userId: string;
}> {
  const client = createClient(stack.url, stack.publishableKey, authOptions);
  const { data, error } = await client.auth.signInAnonymously();
  assert.equal(error, null);
  userIds.push(data.user!.id);
  return { client, userId: data.user!.id };
}

export async function insert(
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin
    .from(table)
    .insert(row)
    .select("id")
    .single();
  assert.equal(error, null, error?.message ?? "");
  return data!.id as string;
}

// One booth with a limited product (1 unit) and an ordinary one (5 units, max 2 per order).
export async function newBooth(
  options: { mode?: string; connection?: boolean } = {},
) {
  const vendorId = await insert("vendors", {
    name: "Test vendor",
    slogan: "Test slogan",
    logo_path: "placeholders/logo.svg",
    banner_path: "placeholders/banner.svg",
  });
  vendorIds.push(vendorId);
  const boothId = await insert("booths", {
    event_id: eventId,
    vendor_id: vendorId,
    code: randomUUID().slice(0, 8),
    mode: options.mode ?? "prepay",
    map_x: 0.5,
    map_y: 0.5,
  });
  boothIds.push(boothId);
  if (options.connection !== false) {
    await insert("provider_connections", {
      vendor_id: vendorId,
      location_id: "LOCATION_TEST",
      token_secret_name: "SQUARE_ACCESS_TOKEN_TEST",
    });
  }
  const limitedId = await insert("products", {
    booth_id: boothId,
    name: "Limited print",
    category: "Art",
    description: "A limited print",
    image_path: "placeholders/product.svg",
    price_cents: 2500,
    available_qty: 1,
    max_per_order: 2,
  });
  const mugId = await insert("products", {
    booth_id: boothId,
    name: "Mug",
    category: "Ceramics",
    description: "A mug",
    image_path: "placeholders/product.svg",
    price_cents: 3200,
    available_qty: 5,
    max_per_order: 2,
  });
  return { vendorId, boothId, limitedId, mugId };
}

export async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<Reply> {
  const { data, error } = await admin.rpc(name, args);
  assert.equal(error, null, error?.message ?? "");
  return data as Reply;
}

export async function stockOf(productId: string): Promise<number> {
  const { data } = await admin
    .from("products")
    .select("available_qty")
    .eq("id", productId)
    .single();
  return data!.available_qty as number;
}

export async function ordersAt(boothId: string): Promise<number> {
  const { count } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("booth_id", boothId);
  return count ?? 0;
}

beforeAll(async () => {
  await admin.from("events").insert({
    id: eventId,
    slug: `test-${eventId}`,
    name: "Test event",
    venue_name: "Test venue",
    floor_plan_url: "/x.png",
  });
});

// Removes everything the tests created, and fails the run if any of it cannot be removed,
// so a cleanup problem is never silent. Payments point at orders, so they go first.
afterAll(async () => {
  const failures: string[] = [];
  const check = (what: string, error: { message: string } | null) => {
    if (error) failures.push(`${what}: ${error.message}`);
  };

  if (boothIds.length > 0) {
    const { data: orders } = await admin
      .from("orders")
      .select("id")
      .in("booth_id", boothIds);
    const orderIds = (orders ?? []).map((order) => order.id as string);
    if (orderIds.length > 0) {
      check(
        "payments",
        (await admin.from("payments").delete().in("order_id", orderIds)).error,
      );
    }
    check(
      "orders",
      (await admin.from("orders").delete().in("booth_id", boothIds)).error,
    );
  }
  check("event", (await admin.from("events").delete().eq("id", eventId)).error);
  if (vendorIds.length > 0) {
    check(
      "vendors",
      (await admin.from("vendors").delete().in("id", vendorIds)).error,
    );
  }
  for (const id of userIds) {
    check("user", (await admin.auth.admin.deleteUser(id)).error);
  }
  assert.deepEqual(failures, [], "test data could not be removed");
});

// A client signed in as staff of the vendor, the way a vendor signs in at /vendor.
export async function newStaffClient(
  vendorId: string,
): Promise<SupabaseClient> {
  const email = `${randomUUID()}@example.com`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(error, null);
  userIds.push(data.user!.id);
  const staff = await admin
    .from("vendor_staff")
    .insert({ user_id: data.user!.id, vendor_id: vendorId });
  assert.equal(staff.error, null, staff.error?.message ?? "");
  const client = createClient(stack.url, stack.publishableKey, authOptions);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  assert.equal(signedIn.error, null);
  return client;
}

// Calls a database function as the signed-in user behind the client.
export async function callAs(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<Reply> {
  const { data, error } = await client.rpc(name, args);
  assert.equal(error, null, error?.message ?? "");
  return data as Reply;
}
