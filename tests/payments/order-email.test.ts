import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import {
  type ClaimedOrder,
  confirmedWording,
  createOrderEmailSender,
  orderEmailContent,
  orderEmailFromEnvironment,
  privateOrderUrl,
} from "../../supabase/functions/_shared/order-email";
import type { EmailMessage } from "../../supabase/functions/_shared/email/resend";
import { EmailError } from "../../supabase/functions/_shared/email/resend";
import { orderLabels } from "../../src/shared/ui/labels";

// The laptops running these tests are on Denver time, so without this a formatter that
// ignores EVENT_TIME_ZONE would still print the expected hold time.
process.env.TZ = "UTC";

const ORDER_ID = "0a000000-0000-4000-8000-000000000001";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "7b000000-0000-4000-8000-000000000007";
const APP_URL = "https://app.example.test/";

function claimed(overrides: Partial<ClaimedOrder> = {}): ClaimedOrder {
  return {
    ok: true,
    outcome: "first_time",
    orderId: ORDER_ID,
    boothCode: "B4",
    boothName: "Moon Ceramics",
    type: "reservation",
    pickupCode: "4821",
    holdEndsAt: "2026-11-13T22:45:00Z",
    totalCents: 3600,
    currency: "USD",
    buyerEmail: "attendee@mail.example.test",
    privateToken: TOKEN,
    items: [{ name: "Mug", quantity: 2, unitPriceCents: 1800 }],
    ...overrides,
  };
}

type RpcCall = { name: string; args: Record<string, unknown> };

function setup(options: {
  claim?: unknown;
  claimError?: Error;
  sendError?: Error;
} = {}) {
  const rpcCalls: RpcCall[] = [];
  const sent: EmailMessage[] = [];
  const sender = createOrderEmailSender({
    rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === "svc_mark_email_sent") {
        if (options.claimError) return Promise.reject(options.claimError);
        return Promise.resolve(options.claim ?? claimed());
      }
      return Promise.resolve({ ok: true });
    },
    send(message) {
      sent.push(message);
      return options.sendError ? Promise.reject(options.sendError) : Promise.resolve("email-1");
    },
    from: "Dibspot <orders@dibspot.app>",
    appUrl: APP_URL,
  });
  return { sender, rpcCalls, sent };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("a first claim sends one email to the buyer and returns sent", async () => {
  const { sender, rpcCalls, sent } = setup();

  assert.equal(await sender.sendConfirmation(ORDER_ID, USER_ID), "sent");

  assert.deepEqual(rpcCalls, [
    { name: "svc_mark_email_sent", args: { p_order_id: ORDER_ID, p_user_id: USER_ID } },
  ]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "attendee@mail.example.test");
  assert.equal(sent[0].from, "Dibspot <orders@dibspot.app>");
});

test("a repeat claim sends nothing and returns already_sent", async () => {
  const { sender, sent } = setup({ claim: { ok: true, outcome: "repeat" } });

  assert.equal(await sender.sendConfirmation(ORDER_ID, null), "already_sent");
  assert.equal(sent.length, 0);
});

test("an order that is not the caller's and one that is not confirmed get the same answer", async () => {
  for (const claim of [
    { ok: false, reason: "order_not_found" },
    { ok: false, reason: "not_confirmed", status: "pending_payment" },
  ]) {
    const { sender, rpcCalls, sent } = setup({ claim });
    assert.equal(await sender.sendConfirmation(ORDER_ID, USER_ID), "not_confirmed");
    assert.equal(sent.length, 0);
    assert.equal(rpcCalls.length, 1);
  }
});

test("a failed send clears the claim with the same ids and returns failed", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { sender, rpcCalls } = setup({
    sendError: new EmailError(503, "service_unavailable", "API is temporarily unavailable"),
  });

  assert.equal(await sender.sendConfirmation(ORDER_ID, USER_ID), "failed");

  assert.deepEqual(rpcCalls.map((call) => call.name), [
    "svc_mark_email_sent",
    "svc_clear_email_sent",
  ]);
  assert.deepEqual(rpcCalls[1].args, { p_order_id: ORDER_ID, p_user_id: USER_ID });
});

test("a database error on the claim returns failed without throwing or clearing", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { sender, rpcCalls, sent } = setup({ claimError: new Error("connection refused") });

  assert.equal(await sender.sendConfirmation(ORDER_ID, USER_ID), "failed");
  assert.equal(rpcCalls.length, 1);
  assert.equal(sent.length, 0);
});

test("missing email settings make no claim and return failed", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const settings: Record<string, string> = {
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "Dibspot <orders@dibspot.app>",
    APP_URL,
  };
  for (const missing of Object.keys(settings)) {
    const rpcCalls: string[] = [];
    const sender = orderEmailFromEnvironment(
      (name) => (name === missing ? undefined : settings[name]),
      (name) => {
        rpcCalls.push(name);
        return Promise.resolve(claimed());
      },
    );
    assert.equal(await sender.sendConfirmation(ORDER_ID, USER_ID), "failed", missing);
    assert.deepEqual(rpcCalls, [], missing);
  }
});

test("the sender built from the environment sends through Resend with those settings", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Promise.resolve(new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));
  });
  const settings: Record<string, string> = {
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "Dibspot <orders@dibspot.app>",
    APP_URL,
  };
  const sender = orderEmailFromEnvironment(
    (name) => settings[name],
    () => Promise.resolve(claimed()),
  );

  assert.equal(await sender.sendConfirmation(ORDER_ID, USER_ID), "sent");

  assert.equal(requests.length, 1);
  assert.equal(new Headers(requests[0].init?.headers).get("Authorization"), "Bearer re_test");
  const body = JSON.parse(String(requests[0].init?.body)) as EmailMessage;
  assert.equal(body.from, "Dibspot <orders@dibspot.app>");
  assert.ok(body.text.includes(`https://app.example.test/orders/link/${TOKEN}`));
});

test("the private link opens the order by its token", () => {
  assert.equal(
    privateOrderUrl("https://app.example.test/", TOKEN),
    `https://app.example.test/orders/link/${TOKEN}`,
  );
});

test("a reservation email has the booth, items, total, pay-at-pickup wording, pickup code, hold end in event time, and link", () => {
  assert.notEqual(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })
      .format(new Date("2026-11-13T22:45:00Z")),
    "3:45 PM",
    "the test process must not run on Denver time",
  );

  const content = orderEmailContent(claimed(), APP_URL);

  assert.equal(content.subject, "Your pickup code for Moon Ceramics: 4821");
  for (const body of [content.text, content.html]) {
    assert.ok(body.includes("Reservation confirmed"));
    assert.ok(body.includes("Moon Ceramics, booth B4"));
    assert.ok(body.includes("2 × Mug"));
    assert.ok(body.includes("$36.00"));
    assert.ok(body.includes("Pay $36.00 at the booth"));
    assert.ok(body.includes("4821"));
    assert.ok(body.includes("Held until 3:45 PM MST"));
    assert.ok(body.includes(`https://app.example.test/orders/link/${TOKEN}`));
  }
});

test("a prepaid email says paid with Square and shows no hold end", () => {
  const content = orderEmailContent(claimed({ type: "prepaid" }), APP_URL);

  for (const body of [content.text, content.html]) {
    assert.ok(body.includes("Order confirmed"));
    assert.ok(body.includes("Paid $36.00 with Square"));
    assert.ok(!body.includes("Held until"));
    assert.ok(!body.includes("at the booth"));
  }
});

test("booth and item names are escaped in the HTML", () => {
  const content = orderEmailContent(
    claimed({
      boothName: `Tom & Jo's <b>`,
      items: [{ name: `<img src=x onerror="alert(1)">`, quantity: 1, unitPriceCents: 3600 }],
    }),
    APP_URL,
  );

  assert.ok(!content.html.includes("<img src=x"));
  assert.ok(!content.html.includes("<b>"));
  assert.ok(content.html.includes("Tom &amp; Jo&#39;s &lt;b&gt;"));
  assert.ok(content.html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
});

test("the email's headline and payment line match the label module for a confirmed order", () => {
  for (const type of ["reservation", "prepaid"] as const) {
    const labels = orderLabels({
      type,
      status: "confirmed",
      refundStatus: "none",
      refundedCents: 0,
      totalCents: 3600,
      currency: "USD",
    });
    assert.deepEqual(confirmedWording(type, 3600, "USD"), {
      headline: labels.headline,
      payment: labels.attendeePayment,
    });
  }
});
