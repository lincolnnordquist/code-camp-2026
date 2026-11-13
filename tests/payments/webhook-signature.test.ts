import assert from "node:assert/strict";
import { test } from "vitest";
import { createHmac } from "node:crypto";
import { createSquareProvider } from "../../supabase/functions/_shared/providers/square";

const provider = createSquareProvider("sandbox");

const signatureKey = "test-signature-key";
const notificationUrl = "https://functions.example.test/square-webhook";
const rawBody = '{"type":"payment.updated","data":{"id":"PAYMENT_1"}}';

// node:crypto computes the expected value, so the Web Crypto code under test is
// not checked against itself.
function sign(key: string, url: string, body: string): string {
  return createHmac("sha256", key).update(url + body).digest("base64");
}

test("accepts a signature made with the subscription key over the notification URL and raw body", async () => {
  assert.equal(
    await provider.verifyWebhookSignature({
      rawBody,
      signatureHeader: sign(signatureKey, notificationUrl, rawBody),
      notificationUrl,
      signatureKey,
    }),
    true,
  );
});

test("rejects a signature made with a different key", async () => {
  assert.equal(
    await provider.verifyWebhookSignature({
      rawBody,
      signatureHeader: sign("another-key", notificationUrl, rawBody),
      notificationUrl,
      signatureKey,
    }),
    false,
  );
});

test("rejects a body that changed after it was signed", async () => {
  assert.equal(
    await provider.verifyWebhookSignature({
      rawBody: rawBody.replace("PAYMENT_1", "PAYMENT_2"),
      signatureHeader: sign(signatureKey, notificationUrl, rawBody),
      notificationUrl,
      signatureKey,
    }),
    false,
  );
});

test("rejects a signature made for a different notification URL", async () => {
  assert.equal(
    await provider.verifyWebhookSignature({
      rawBody,
      signatureHeader: sign(
        signatureKey,
        "https://other.example.test/hook",
        rawBody,
      ),
      notificationUrl,
      signatureKey,
    }),
    false,
  );
});

test("rejects a request with no signature header", async () => {
  assert.equal(
    await provider.verifyWebhookSignature({
      rawBody,
      signatureHeader: null,
      notificationUrl,
      signatureKey,
    }),
    false,
  );
});

test("rejects a signature header that is not base64", async () => {
  assert.equal(
    await provider.verifyWebhookSignature({
      rawBody,
      signatureHeader: "not base64 !!",
      notificationUrl,
      signatureKey,
    }),
    false,
  );
});

test("names the header that carries the Square signature", () => {
  assert.equal(
    provider.webhookSignatureHeaderName,
    "x-square-hmacsha256-signature",
  );
});
