import type { PaymentVerification } from "./verify-payment.ts";

export type VerifiedPayment = Extract<PaymentVerification, { verified: true }>;

export type ConfirmOutcome = "confirmed" | "already_confirmed" | "refund_due";

export type ConfirmResult =
  | { ok: true; outcome: ConfirmOutcome; status: string }
  | { ok: false; reason: string };

// Takes only a result verifyPayment accepted, so a payment that was not checked
// against Square's own record cannot be recorded (FR-12).
export async function recordVerifiedPayment(
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  verification: VerifiedPayment,
): Promise<ConfirmResult> {
  const { payment } = verification;
  return await rpc("svc_confirm_paid_order", {
    p_provider_order_id: payment.providerOrderId,
    p_provider_payment_id: payment.id,
    p_amount_cents: payment.amountCents,
    p_currency: payment.currency,
    p_location_id: payment.sellerLocationId,
  }) as ConfirmResult;
}
