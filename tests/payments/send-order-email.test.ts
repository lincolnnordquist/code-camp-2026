import assert from "node:assert/strict";
import { test } from "vitest";
import { handleSendOrderEmail } from "../../supabase/functions/send-order-email/handler";
import type { ConfirmationOutcome } from "../../supabase/functions/_shared/order-email";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "0a000000-0000-4000-8000-000000000001";

function setup(outcome: ConfirmationOutcome = "sent", userId: string | null = USER_ID) {
  const calls: { orderId: string; userId: string | null }[] = [];
  const tokens: string[] = [];
  const deps = {
    getUserId(token: string) {
      tokens.push(token);
      return Promise.resolve(userId);
    },
    sender: {
      sendConfirmation(orderId: string, caller: string | null) {
        calls.push({ orderId, userId: caller });
        return Promise.resolve(outcome);
      },
    },
  };
  return { deps, calls, tokens };
}

function post(body: unknown, authorization: string | null = "Bearer session-token") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization) headers.set("Authorization", authorization);
  return new Request("http://localhost/send-order-email", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function replyOf(response: Response) {
  return { status: response.status, body: await response.json() };
}

test("no session or an invalid session is 401 and sends nothing", async () => {
  for (const [authorization, userId] of [[null, USER_ID], ["Bearer bad", null]] as const) {
    const { deps, calls } = setup("sent", userId);
    const reply = await replyOf(
      await handleSendOrderEmail(post({ orderId: ORDER_ID }, authorization), deps),
    );
    assert.deepEqual(reply, { status: 401, body: { ok: false, reason: "not_signed_in" } });
    assert.equal(calls.length, 0);
  }
});

test("a body without a valid order id is 400 and sends nothing", async () => {
  for (const body of ["not json", {}, { orderId: "123" }, { orderId: 5 }]) {
    const { deps, calls } = setup();
    const reply = await replyOf(await handleSendOrderEmail(post(body), deps));
    assert.deepEqual(reply, { status: 400, body: { ok: false, reason: "invalid_request" } });
    assert.equal(calls.length, 0);
  }
});

test("the session's user id and the order id reach the sender", async () => {
  const { deps, calls, tokens } = setup();

  await handleSendOrderEmail(post({ orderId: ORDER_ID }), deps);

  assert.deepEqual(tokens, ["session-token"]);
  assert.deepEqual(calls, [{ orderId: ORDER_ID, userId: USER_ID }]);
});

test("each outcome maps to its reply", async () => {
  const expected: Record<ConfirmationOutcome, unknown> = {
    sent: { ok: true, outcome: "sent" },
    already_sent: { ok: true, outcome: "already_sent" },
    not_confirmed: { ok: false, reason: "order_not_found" },
    failed: { ok: false, reason: "email_failed" },
  };
  for (const [outcome, body] of Object.entries(expected)) {
    const { deps } = setup(outcome as ConfirmationOutcome);
    const reply = await replyOf(await handleSendOrderEmail(post({ orderId: ORDER_ID }), deps));
    assert.deepEqual(reply, { status: 200, body }, outcome);
  }
});

test("other methods are refused and OPTIONS answers CORS", async () => {
  const { deps } = setup();
  const get = await handleSendOrderEmail(new Request("http://localhost/x"), deps);
  assert.equal(get.status, 405);
  const options = await handleSendOrderEmail(
    new Request("http://localhost/x", { method: "OPTIONS" }),
    deps,
  );
  assert.equal(options.status, 200);
  assert.ok(options.headers.get("Access-Control-Allow-Origin"));
});
