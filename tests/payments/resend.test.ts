import assert from "node:assert/strict";
import { test } from "vitest";
import {
  EmailError,
  type EmailMessage,
  sendEmail,
} from "../../supabase/functions/_shared/email/resend";

const message: EmailMessage = {
  from: "Dibspot <orders@dibspot.app>",
  to: "attendee@mail.example.test",
  subject: "Your pickup code for Moon Ceramics: 4821",
  html: "<p>Reservation confirmed</p>",
  text: "Reservation confirmed",
};

type RecordedCall = { url: string; init: RequestInit | undefined };

function stubFetch(reply: { status: number; body: unknown } | Error) {
  const calls: RecordedCall[] = [];
  const fetchStub: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init });
    if (reply instanceof Error) return Promise.reject(reply);
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return Promise.resolve(new Response(text, { status: reply.status }));
  };
  return { fetchStub, calls };
}

async function sendError(reply: { status: number; body: unknown } | Error): Promise<EmailError> {
  const { fetchStub } = stubFetch(reply);
  const error = await sendEmail("re_test", message, fetchStub).then(
    () => assert.fail("the send should fail"),
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof EmailError);
  return error;
}

test("a send posts the message to Resend with the key, a User-Agent, a timeout, and no idempotency key", async () => {
  const { fetchStub, calls } = stubFetch({ status: 200, body: { id: "email-1" } });

  const id = await sendEmail("re_test", message, fetchStub);

  assert.equal(id, "email-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init?.method, "POST");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer re_test");
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.ok(headers.get("User-Agent"));
  assert.equal(headers.get("Idempotency-Key"), null);
  assert.ok(calls[0].init?.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), message);
});

test("a refusal keeps Resend's status, name and message", async () => {
  const error = await sendError({
    status: 403,
    body: { name: "validation_error", message: "The dibspot.app domain is not verified." },
  });
  assert.equal(error.httpStatus, 403);
  assert.equal(error.resendName, "validation_error");
  assert.equal(error.message, "The dibspot.app domain is not verified.");
});

for (const status of [422, 429, 500]) {
  test(`HTTP ${status} without a JSON body still fails with the status`, async () => {
    const error = await sendError({ status, body: "upstream error" });
    assert.equal(error.httpStatus, status);
    assert.equal(error.resendName, `http_${status}`);
  });
}

test("a network error or timeout fails without a status", async () => {
  const error = await sendError(new DOMException("The operation timed out.", "TimeoutError"));
  assert.equal(error.httpStatus, null);
  assert.equal(error.resendName, "network_error");
});

test("a success reply without an id is a failure", async () => {
  const error = await sendError({ status: 200, body: {} });
  assert.equal(error.resendName, "unexpected_reply");
});
