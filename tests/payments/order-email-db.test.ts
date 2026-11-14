import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test, vi } from "vitest";
import { admin, newAttendeeClient, newBooth, type Reply, stockOf } from "../db/support";
import { createOrderEmailSender } from "../../supabase/functions/_shared/order-email";
import type { EmailMessage } from "../../supabase/functions/_shared/email/resend";

const APP_URL = "https://app.example.test";

afterEach(() => {
  vi.restoreAllMocks();
});

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  assert.equal(error, null, error?.message ?? "");
  return data;
}

async function confirmedReservation() {
  const booth = await newBooth({ mode: "reservation", connection: false });
  const { client, userId } = await newAttendeeClient();
  const { data, error } = await client.rpc("create_reservation", {
    p_booth_id: booth.boothId,
    p_items: [{ productId: booth.mugId, quantity: 2 }],
    p_email: "reserve@mail.example.test",
    p_request_id: randomUUID(),
  });
  assert.equal(error, null, error?.message ?? "");
  const reply = data as Reply;
  assert.equal(reply.ok, true, reply.reason ?? "");
  return { orderId: reply.orderId!, userId, mugId: booth.mugId };
}

async function orderRow(orderId: string) {
  const { data, error } = await admin.from("orders").select("*").eq("id", orderId).single();
  assert.equal(error, null, error?.message ?? "");
  return data as Record<string, unknown>;
}

function senderWith(send: (message: EmailMessage) => Promise<string>) {
  return createOrderEmailSender({ rpc, send, from: "Dibspot <orders@dibspot.app>", appUrl: APP_URL });
}

test("overlapping calls for one order send it once", { timeout: 30_000 }, async () => {
  const orders = await Promise.all([1, 2, 3, 4].map(() => confirmedReservation()));
  let sends = 0;
  // The send is held open so later claims arrive while the first one is still sending.
  const sender = senderWith(async () => {
    sends += 1;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return "email-1";
  });

  const outcomes = await Promise.all(
    orders.map((order) =>
      Promise.all(Array.from({ length: 8 }, () => sender.sendConfirmation(order.orderId, order.userId)))
    ),
  );

  for (const perOrder of outcomes) {
    assert.equal(perOrder.filter((outcome) => outcome === "sent").length, 1);
    assert.equal(perOrder.filter((outcome) => outcome === "already_sent").length, 7);
  }
  assert.equal(sends, 4);
});

test("the email is built from the real claim: recipient, pickup code, items, total and the order's token", async () => {
  const { orderId, userId } = await confirmedReservation();
  const sent: EmailMessage[] = [];
  const sender = senderWith((message) => {
    sent.push(message);
    return Promise.resolve("email-1");
  });

  assert.equal(await sender.sendConfirmation(orderId, userId), "sent");

  const row = await orderRow(orderId);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "reserve@mail.example.test");
  assert.ok(sent[0].subject.endsWith(String(row.pickup_code)));
  assert.ok(sent[0].text.includes("2 × Mug"));
  assert.ok(sent[0].text.includes("$64.00"));
  assert.ok(sent[0].text.includes("Pay $64.00 at the booth"));
  assert.ok(sent[0].text.includes("Held until "));
  assert.ok(sent[0].text.includes(`${APP_URL}/orders/link/${String(row.private_token)}`));
  assert.notEqual(row.email_sent_at, null);
});

test("another user cannot send an order's email, and the claim stays free", async () => {
  const { orderId } = await confirmedReservation();
  const stranger = await newAttendeeClient();
  const sent: EmailMessage[] = [];
  const sender = senderWith((message) => {
    sent.push(message);
    return Promise.resolve("email-1");
  });

  assert.equal(await sender.sendConfirmation(orderId, stranger.userId), "not_confirmed");

  assert.equal(sent.length, 0);
  assert.equal((await orderRow(orderId)).email_sent_at, null);
});

test("a failed send leaves the order as it was, and the next call sends", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { orderId, userId, mugId } = await confirmedReservation();
  const before = await orderRow(orderId);
  const stockBefore = await stockOf(mugId);

  const failing = senderWith(() => Promise.reject(new Error("Resend is down")));
  assert.equal(await failing.sendConfirmation(orderId, userId), "failed");

  assert.deepEqual(await orderRow(orderId), before);
  assert.equal(await stockOf(mugId), stockBefore);

  const sent: EmailMessage[] = [];
  const working = senderWith((message) => {
    sent.push(message);
    return Promise.resolve("email-2");
  });
  assert.equal(await working.sendConfirmation(orderId, userId), "sent");
  assert.equal(sent.length, 1);
});
