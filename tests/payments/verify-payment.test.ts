import assert from "node:assert/strict";
import { test } from "vitest";
import type { ProviderPayment } from "../../supabase/functions/_shared/providers/types";
import {
  type ExpectedPayment,
  verifyPayment,
} from "../../supabase/functions/_shared/verify-payment";

const expected: ExpectedPayment = {
  sellerLocationId: "LOCATION_A",
  providerOrderId: "ORDER_1",
  totalCents: 825,
  currency: "USD",
};

const matchingPayment: ProviderPayment = {
  id: "PAYMENT_1",
  providerOrderId: "ORDER_1",
  status: "completed",
  amountCents: 825,
  currency: "USD",
  sellerLocationId: "LOCATION_A",
};

test("verifies a completed payment that matches seller, provider order, amount and currency", () => {
  assert.deepEqual(verifyPayment(expected, matchingPayment), {
    verified: true,
    payment: matchingPayment,
  });
});

test("rejects a payment with a different amount", () => {
  assert.deepEqual(
    verifyPayment(expected, { ...matchingPayment, amountCents: 824 }),
    { verified: false, reason: "amount_mismatch" },
  );
});

test("rejects a payment in a different currency", () => {
  assert.deepEqual(
    verifyPayment(expected, { ...matchingPayment, currency: "CAD" }),
    { verified: false, reason: "currency_mismatch" },
  );
});

test("rejects a payment taken at a different seller location", () => {
  assert.deepEqual(
    verifyPayment(expected, {
      ...matchingPayment,
      sellerLocationId: "LOCATION_B",
    }),
    { verified: false, reason: "seller_mismatch" },
  );
});

test("rejects a payment that belongs to a different provider order", () => {
  assert.deepEqual(
    verifyPayment(expected, { ...matchingPayment, providerOrderId: "ORDER_2" }),
    { verified: false, reason: "provider_order_mismatch" },
  );
});

for (const status of ["pending", "cancelled", "failed"] as const) {
  test(`rejects a matching payment whose status is ${status}`, () => {
    assert.deepEqual(verifyPayment(expected, { ...matchingPayment, status }), {
      verified: false,
      reason: "payment_not_completed",
    });
  });
}

test("rejects an order that has no payment", () => {
  assert.deepEqual(verifyPayment(expected, null), {
    verified: false,
    reason: "no_payment",
  });
});
