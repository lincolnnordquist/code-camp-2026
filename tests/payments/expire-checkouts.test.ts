import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  type ExpireCheckoutsDeps,
  handleExpireCheckouts,
  type OverdueCheckout,
} from "../../supabase/functions/expire-checkouts/handler";
import {
  type OrderState,
  type PaymentProvider,
  type PaymentStatus,
  ProviderError,
  type ProviderPayment,
} from "../../supabase/functions/_shared/providers/types";

const SERVICE_KEY = "service-key";
const LOCATION = "LOCATION_A";

function overdue(name: string, linked = true): OverdueCheckout {
  return {
    orderId: `order-${name}`,
    checkoutLinkId: linked ? `LINK_${name}` : null,
    providerOrderId: linked ? `SQ_${name}` : null,
    totalCents: 3200,
    currency: "USD",
    connection: {
      tokenSecretName: "SQUARE_ACCESS_TOKEN_TEST",
      locationId: LOCATION,
    },
  };
}

function payment(
  name: string,
  status: PaymentStatus,
  overrides: Partial<ProviderPayment> = {},
): ProviderPayment {
  return {
    id: `PAY_${name}`,
    providerOrderId: `SQ_${name}`,
    status,
    amountCents: 3200,
    currency: "USD",
    sellerLocationId: LOCATION,
    ...overrides,
  };
}

type Reply<T> = T | Error;

// Replies are keyed by the order's name. Each getPayment call takes the next
// reply in that order's list.
type Square = {
  payments?: Record<string, Reply<ProviderPayment | null>[]>;
  closes?: Record<string, Reply<string | null>>;
  states?: Record<string, Reply<OrderState>>;
};

function settle<T>(reply: Reply<T>): Promise<T> {
  return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
}

function setup(
  orders: OverdueCheckout[],
  square: Square = {},
  expireReplies: Record<string, unknown> = {},
  confirmReply: unknown = { ok: true, outcome: "confirmed", status: "confirmed" },
) {
  const calls: string[] = [];
  const expireCalls: Record<string, unknown>[] = [];
  const confirmCalls: Record<string, unknown>[] = [];
  const emails: [string, string | null][] = [];
  const unused = () => Promise.reject(new Error("not used by expire-checkouts"));
  const name = (id: string) => id.replace(/^(SQ|LINK)_/, "");
  const provider: PaymentProvider = {
    webhookSignatureHeaderName: "x-test-signature",
    pendingRecheckMs: 2000,
    createCheckout: unused,
    getPayment(_connection, providerOrderId) {
      calls.push(`getPayment ${providerOrderId}`);
      const queue = square.payments?.[name(providerOrderId)] ?? [];
      return settle(queue.length > 0 ? queue.shift()! : null);
    },
    closeCheckout(_connection, linkId) {
      calls.push(`closeCheckout ${linkId}`);
      const key = name(linkId);
      return settle(
        square.closes && key in square.closes
          ? square.closes[key]
          : `SQ_${key}`,
      );
    },
    getOrderState(_connection, providerOrderId) {
      calls.push(`getOrderState ${providerOrderId}`);
      return settle(square.states?.[name(providerOrderId)] ?? "open");
    },
    getRefund: unused,
    verifyWebhookSignature: unused,
    parseWebhookEvent: () => {
      throw new Error("not used");
    },
  };
  const deps: ExpireCheckoutsDeps = {
    serviceKey: SERVICE_KEY,
    rpc(rpcName, args) {
      calls.push(rpcName);
      if (rpcName === "svc_list_overdue_checkouts") {
        return Promise.resolve({ ok: true, orders });
      }
      if (rpcName === "svc_confirm_paid_order") {
        confirmCalls.push(args);
        return Promise.resolve(confirmReply);
      }
      expireCalls.push(args);
      const reply = expireReplies[args.p_order_id as string] ??
        { ok: true, changed: true };
      return reply instanceof Error
        ? Promise.reject(reply)
        : Promise.resolve(reply);
    },
    provider,
    readSecret: (secret) =>
      secret === "SQUARE_ACCESS_TOKEN_TEST" ? "seller-token" : undefined,
    email: {
      sendConfirmation(orderId, userId) {
        emails.push([orderId, userId]);
        return Promise.resolve("sent");
      },
    },
  };
  return { deps, calls, expireCalls, confirmCalls, emails };
}

function run(deps: ExpireCheckoutsDeps, key: string | null = SERVICE_KEY) {
  const headers: Record<string, string> = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  return handleExpireCheckouts(
    new Request("http://localhost/expire-checkouts", {
      method: "POST",
      headers,
    }),
    deps,
  );
}

const noCounts = {
  expired: 0,
  left: 0,
  confirmed: 0,
  paidNotVerified: 0,
  failed: 0,
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("a caller without the service key is refused before anything is listed", async () => {
  const { deps, calls } = setup([overdue("a")]);
  for (const key of [null, "wrong-key", `${SERVICE_KEY}x`]) {
    const response = await run(deps, key);
    assert.equal(response.status, 401);
  }
  assert.deepEqual(calls, []);
});

test("an unpaid checkout has its link deleted and is expired with the order Square cancelled", async () => {
  const { deps, calls, expireCalls } = setup([overdue("a")]);
  const body = await (await run(deps)).json();
  assert.deepEqual(body, { ok: true, listed: 1, ...noCounts, expired: 1 });
  assert.deepEqual(calls, [
    "svc_list_overdue_checkouts",
    "getPayment SQ_a",
    "closeCheckout LINK_a",
    "svc_expire_checkout",
  ]);
  assert.deepEqual(expireCalls, [
    { p_order_id: "order-a", p_provider_order_id: "SQ_a" },
  ]);
});

test("an order that never reached Square is expired with no provider order", async () => {
  const { deps, calls, expireCalls } = setup([overdue("a", false)]);
  const body = await (await run(deps)).json();
  assert.equal(body.expired, 1);
  assert.deepEqual(calls, ["svc_list_overdue_checkouts", "svc_expire_checkout"]);
  assert.deepEqual(expireCalls, [
    { p_order_id: "order-a", p_provider_order_id: null },
  ]);
});

test("a failed or cancelled payment counts as unpaid", async () => {
  for (const status of ["failed", "cancelled"] as const) {
    const { deps, expireCalls } = setup([overdue("a")], {
      payments: { a: [payment("a", status)] },
    });
    const body = await (await run(deps)).json();
    assert.equal(body.expired, 1, status);
    assert.equal(expireCalls.length, 1, status);
  }
});

type Case = {
  name: string;
  square?: Square;
  expireReply?: unknown;
  confirmReply?: unknown;
  confirms?: boolean;
  linked?: boolean;
  outcome: keyof typeof noCounts;
  closed: boolean;
  expireArgs?: Record<string, unknown>;
};

const done = payment("t", "completed");
const pending = payment("t", "pending");

// Each case runs the order "t" ahead of an unpaid order "control". The control
// must still expire, so a run that stopped at "t" fails the case.
const cases: Case[] = [
  {
    name: "a verified payment confirms the order and its link is kept",
    confirms: true,
    square: { payments: { t: [done] } },
    outcome: "confirmed",
    closed: false,
  },
  {
    name: "a completed payment for another amount is left and its link is kept",
    square: { payments: { t: [payment("t", "completed", { amountCents: 3100 })] } },
    outcome: "paidNotVerified",
    closed: false,
  },
  {
    name: "a pending payment is left and its link is kept",
    square: { payments: { t: [pending] } },
    outcome: "left",
    closed: false,
  },
  {
    name: "a payment completed while the link was deleted confirms the order",
    confirms: true,
    square: { payments: { t: [null, done] }, closes: { t: null } },
    outcome: "confirmed",
    closed: true,
  },
  {
    name: "a payment pending at the second lookup is left",
    square: { payments: { t: [null, pending] }, closes: { t: null } },
    outcome: "left",
    closed: true,
  },
  {
    name: "a link deleted by an earlier run expires once Square shows the order cancelled",
    square: { closes: { t: null }, states: { t: "cancelled" } },
    outcome: "expired",
    closed: true,
    expireArgs: { p_order_id: "order-t", p_provider_order_id: "SQ_t" },
  },
  ...(["open", "draft", "completed"] as const).map((state): Case => ({
    name: `no cancelled order and an order state of ${state} is left`,
    square: { closes: { t: null }, states: { t: state } },
    outcome: "left",
    closed: true,
  })),
  {
    name: "Square naming another cancelled order is left",
    square: { closes: { t: "SQ_other" } },
    outcome: "left",
    closed: true,
  },
  ...["not_pending", "hold_not_ended", "order_not_found", "provider_order_mismatch"]
    .map((reason): Case => ({
      name: `a ${reason} refusal from the database is left`,
      expireReply: { ok: false, reason },
      outcome: "left",
      closed: true,
    })),
  {
    name: "an order another run already expired is left",
    expireReply: { ok: true, changed: false },
    outcome: "left",
    closed: true,
  },
  {
    name: "an order with no link that has gained one since the list was read is left",
    linked: false,
    expireReply: { ok: false, reason: "provider_order_mismatch" },
    outcome: "left",
    closed: false,
  },
  {
    name: "a database error on one order counts as failed",
    expireReply: new Error("database unreachable"),
    outcome: "failed",
    closed: true,
  },
  {
    name: "a Square outage at the first payment lookup is left",
    square: { payments: { t: [new ProviderError("unavailable", "HTTP_503", "down")] } },
    outcome: "left",
    closed: false,
  },
  {
    name: "a Square outage while deleting the link is left",
    square: { closes: { t: new ProviderError("unavailable", "HTTP_503", "down") } },
    outcome: "left",
    closed: true,
  },
  {
    name: "a Square outage at the second payment lookup is left",
    square: {
      payments: { t: [null, new ProviderError("unavailable", "HTTP_503", "down")] },
      closes: { t: null },
    },
    outcome: "left",
    closed: true,
  },
  {
    name: "a Square outage while reading the order state is left",
    square: {
      closes: { t: null },
      states: { t: new ProviderError("unavailable", "HTTP_503", "down") },
    },
    outcome: "left",
    closed: true,
  },
  {
    name: "a payment the return page already recorded counts as confirmed",
    confirms: true,
    square: { payments: { t: [done] } },
    confirmReply: { ok: true, outcome: "already_confirmed", status: "confirmed" },
    outcome: "confirmed",
    closed: false,
  },
  {
    name: "a payment the database records as refund due is left",
    confirms: true,
    square: { payments: { t: [done] } },
    confirmReply: { ok: true, outcome: "refund_due", status: "cancelled" },
    outcome: "left",
    closed: false,
  },
  {
    name: "a payment the database refuses to record counts as paid but not verified",
    confirms: true,
    square: { payments: { t: [done] } },
    confirmReply: { ok: false, reason: "amount_mismatch" },
    outcome: "paidNotVerified",
    closed: false,
  },
  ...(["rejected", "not_found"] as const).map((reason): Case => ({
    name: `a Square ${reason} reply counts as failed`,
    square: { payments: { t: [new ProviderError(reason, "CODE", "refused")] } },
    outcome: "failed",
    closed: false,
  })),
];

for (const c of cases) {
  test(c.name, async () => {
    const { deps, calls, expireCalls, confirmCalls, emails } = setup(
      [overdue("t", c.linked ?? true), overdue("control")],
      c.square,
      c.expireReply === undefined ? {} : { "order-t": c.expireReply },
      c.confirmReply,
    );
    const body = await (await run(deps)).json();

    const expected = { ...noCounts, expired: 1 };
    expected[c.outcome] += 1;
    assert.deepEqual(body, { ok: true, listed: 2, ...expected });
    assert.equal(calls.includes("closeCheckout LINK_t"), c.closed);
    assert.ok(
      expireCalls.some((args) => args.p_order_id === "order-control"),
      "the order after it is still expired",
    );
    assert.deepEqual(
      confirmCalls,
      c.confirms
        ? [{
          p_provider_order_id: "SQ_t",
          p_provider_payment_id: "PAY_t",
          p_amount_cents: 3200,
          p_currency: "USD",
          p_location_id: LOCATION,
        }]
        : [],
    );
    assert.deepEqual(emails, c.outcome === "confirmed" ? [["order-t", null]] : []);
    if (c.expireArgs) {
      assert.deepEqual(
        expireCalls.find((args) => args.p_order_id === "order-t"),
        c.expireArgs,
      );
    } else if (c.outcome !== "expired" && c.expireReply === undefined) {
      assert.equal(
        expireCalls.some((args) => args.p_order_id === "order-t"),
        false,
      );
    }
  });
}

test("an order whose seller token is missing counts as failed and Square is not called", async () => {
  const missing = {
    ...overdue("t"),
    connection: { tokenSecretName: "SQUARE_ACCESS_TOKEN_GONE", locationId: LOCATION },
  };
  const { deps, calls } = setup([missing, overdue("control")]);
  const body = await (await run(deps)).json();
  assert.deepEqual(body, {
    ok: true,
    listed: 2,
    ...noCounts,
    expired: 1,
    failed: 1,
  });
  assert.equal(calls.some((call) => call.endsWith("_t")), false);
});

test("an empty list returns zero counts", async () => {
  const { deps } = setup([]);
  assert.deepEqual(await (await run(deps)).json(), {
    ok: true,
    listed: 0,
    ...noCounts,
  });
});
