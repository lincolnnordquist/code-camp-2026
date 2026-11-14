export type SellerConnection = {
  accessToken: string;
  locationId: string;
};

export type CheckoutLineItem = {
  name: string;
  quantity: number;
  unitPriceCents: number;
};

export type CreateCheckoutInput = {
  connection: SellerConnection;
  lineItems: CheckoutLineItem[];
  currency: string;
  returnUrl: string;
  buyerEmail: string;
  idempotencyKey: string;
};

export type Checkout = {
  url: string;
  checkoutLinkId: string;
  providerOrderId: string;
};

export type PaymentStatus = "completed" | "pending" | "cancelled" | "failed";

export type ProviderPayment = {
  id: string;
  providerOrderId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  sellerLocationId: string;
};

export type OrderState = "draft" | "open" | "completed" | "cancelled";

export type RefundStatus = "completed" | "pending" | "rejected" | "failed";

export type ProviderRefund = {
  status: RefundStatus;
  paymentId: string;
  amountCents: number;
  currency: string;
};

export type WebhookSignatureInput = {
  rawBody: string;
  signatureHeader: string | null;
  // The address registered with the provider. The signature covers this exact
  // string, so any other address for the same function fails verification.
  notificationUrl: string;
  signatureKey: string;
};

// "unavailable" means the provider did not answer or failed, and the same call
// can succeed later. "rejected" means the provider refused the request as sent.
export type ProviderFailure =
  | "invalid_buyer_email"
  | "not_found"
  | "unavailable"
  | "rejected";

export class ProviderError extends Error {
  readonly reason: ProviderFailure;
  readonly providerCode: string;

  constructor(reason: ProviderFailure, providerCode: string, message: string) {
    super(message);
    this.name = "ProviderError";
    this.reason = reason;
    this.providerCode = providerCode;
  }
}

export interface PaymentProvider {
  readonly webhookSignatureHeaderName: string;

  // How long to wait before reading a pending payment once more.
  readonly pendingRecheckMs: number;

  createCheckout(input: CreateCheckoutInput): Promise<Checkout>;

  // Resolves to null when the provider order has no payment.
  getPayment(
    connection: SellerConnection,
    providerOrderId: string,
  ): Promise<ProviderPayment | null>;

  // Resolves to the provider order id that was cancelled, or to null when the
  // provider cancelled none: the order is paid, or the link was closed before.
  closeCheckout(
    connection: SellerConnection,
    checkoutLinkId: string,
  ): Promise<string | null>;

  getOrderState(
    connection: SellerConnection,
    providerOrderId: string,
  ): Promise<OrderState>;

  getRefund(
    connection: SellerConnection,
    refundId: string,
  ): Promise<ProviderRefund>;

  verifyWebhookSignature(input: WebhookSignatureInput): Promise<boolean>;
}
