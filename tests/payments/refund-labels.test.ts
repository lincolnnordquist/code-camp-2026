import assert from "node:assert/strict";
import { test } from "vitest";
import { orderLabels } from "../../src/shared/ui/labels";

const prepaid = {
  type: "prepaid",
  status: "confirmed",
  totalCents: 3200,
  currency: "USD",
} as const;

test("a partial refund's banner names the amount refunded, not the order total", () => {
  const labels = orderLabels({ ...prepaid, refundStatus: "refunded", refundedCents: 500 });
  assert.equal(labels.paymentBadge?.label, "Refunded");
  assert.equal(labels.refundBanner?.title, "Refunded:");
  assert.equal(labels.refundBanner?.body, "$5.00 back to your card");
});

test("a refund due banner names the order total", () => {
  const labels = orderLabels({ ...prepaid, refundStatus: "due", refundedCents: 0 });
  assert.equal(labels.refundBanner?.title, "Refund due:");
  assert.equal(labels.refundBanner?.body, "$32.00 back to your card");
});
