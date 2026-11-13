import type { ProviderPayment } from "./providers/types.ts";

export type ExpectedPayment = {
  sellerLocationId: string;
  providerOrderId: string;
  totalCents: number;
  currency: string;
};

export type VerificationFailure =
  | "no_payment"
  | "seller_mismatch"
  | "provider_order_mismatch"
  | "currency_mismatch"
  | "amount_mismatch"
  | "payment_not_completed";

export type PaymentVerification =
  | { verified: true; payment: ProviderPayment }
  | { verified: false; reason: VerificationFailure };

// The payment must come from the provider's own record, fetched by the server.
// A redirect or a webhook body is not a payment (FR-12).
export function verifyPayment(
  expected: ExpectedPayment,
  payment: ProviderPayment | null,
): PaymentVerification {
  if (payment === null) return { verified: false, reason: "no_payment" };
  if (payment.sellerLocationId !== expected.sellerLocationId) {
    return { verified: false, reason: "seller_mismatch" };
  }
  if (payment.providerOrderId !== expected.providerOrderId) {
    return { verified: false, reason: "provider_order_mismatch" };
  }
  if (payment.currency !== expected.currency) {
    return { verified: false, reason: "currency_mismatch" };
  }
  if (payment.amountCents !== expected.totalCents) {
    return { verified: false, reason: "amount_mismatch" };
  }
  if (payment.status !== "completed") {
    return { verified: false, reason: "payment_not_completed" };
  }
  return { verified: true, payment };
}
