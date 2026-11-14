// The one place for order status and payment wording (FR-28).
// A reservation is never labelled paid, and a pending payment is never labelled complete.
import type { BoothMode, Order, OrderStatus } from "../types";
import type {
  ConfirmCheckoutRefusal,
  OrderChangeRefusal,
  OrderLookupRefusal,
  StartCheckoutRefusal,
} from "../types";
import type { BadgeTone } from "./Badge";
import type { BannerTone } from "./Banner";
import type { IconName } from "./Icon";

export type BadgeLabel = { label: string; tone: BadgeTone };

export type OrderLabels = {
  statusBadge: BadgeLabel;
  paymentBadge: BadgeLabel | null;
  headline: string;
  attendeePayment: string | null;
  vendorPayment: string | null;
  refundBanner: { title: string; body: string; tone: BannerTone; icon: IconName } | null;
};

type LabelledOrder = Pick<
  Order,
  "type" | "status" | "refundStatus" | "refundedCents" | "totalCents" | "currency"
>;

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export const boothModeBadges: Record<BoothMode, BadgeLabel> = {
  prepay: { label: "Prepay", tone: "outlined" },
  reservation: { label: "Reserve", tone: "outlined" },
  discovery: { label: "Browse only", tone: "outlined" },
};

const statusBadges: Record<OrderStatus, BadgeLabel> = {
  pending_payment: { label: "Pending payment", tone: "info" },
  confirmed: { label: "Confirmed", tone: "info" },
  ready: { label: "Ready", tone: "success" },
  collected: { label: "Collected", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "error" },
  expired: { label: "Expired", tone: "error" },
};

export function orderLabels(order: LabelledOrder): OrderLabels {
  const amount = formatMoney(order.totalCents, order.currency);
  const statusBadge = statusBadges[order.status];
  return order.type === "reservation"
    ? reservationLabels(order.status, amount, statusBadge)
    : prepaidLabels(order, amount, statusBadge);
}

function reservationLabels(status: OrderStatus, amount: string, statusBadge: BadgeLabel): OrderLabels {
  const base = { statusBadge, paymentBadge: null, attendeePayment: null, vendorPayment: null, refundBanner: null };
  switch (status) {
    case "confirmed":
    case "ready":
      return {
        ...base,
        paymentBadge: { label: "Pay at pickup", tone: "outlined" },
        headline: status === "confirmed" ? "Reservation confirmed" : "Ready for pickup",
        attendeePayment: `Pay ${amount} at the booth`,
        vendorPayment: `Take ${amount} at pickup`,
      };
    case "collected":
      return {
        ...base,
        headline: "Collected",
        attendeePayment: `Payment of ${amount} taken at the booth`,
        vendorPayment: `Payment of ${amount} taken at the booth`,
      };
    case "cancelled":
      return { ...base, headline: "Reservation cancelled" };
    case "expired":
      return { ...base, headline: "Reservation expired" };
    case "pending_payment":
      throw new Error("A reservation is never pending_payment (SPEC.md, Order statuses)");
  }
}

function prepaidLabels(order: LabelledOrder, amount: string, statusBadge: BadgeLabel): OrderLabels {
  const headlines: Record<OrderStatus, string> = {
    pending_payment: "Waiting for payment",
    confirmed: "Order confirmed",
    ready: "Ready for pickup",
    collected: "Collected",
    cancelled: "Order cancelled",
    expired: "Order expired",
  };
  const headline = headlines[order.status];

  if (order.status === "pending_payment") {
    const pay = `Pay ${amount} with Square`;
    return { statusBadge, paymentBadge: null, headline, attendeePayment: pay, vendorPayment: null, refundBanner: null };
  }

  // An expired prepaid order with no refund status ran out its checkout hold unpaid (FR-14).
  if (order.status === "expired" && order.refundStatus === "none") {
    return { statusBadge, paymentBadge: null, headline, attendeePayment: null, vendorPayment: null, refundBanner: null };
  }

  const paid = `Paid ${amount} with Square`;
  const refund = refundLabels(order, amount);
  return {
    statusBadge,
    paymentBadge: refund?.badge ?? { label: "Paid", tone: "outlined" },
    headline,
    attendeePayment: paid,
    vendorPayment: paid,
    refundBanner: refund?.banner ?? null,
  };
}

// A partial refund also counts as refunded, so the refunded banner names the amount
// refunded, not the order total.
function refundLabels(order: LabelledOrder, amount: string) {
  switch (order.refundStatus) {
    case "due":
      return {
        badge: { label: "Refund due", tone: "warning" } as const,
        banner: { title: "Refund due", body: `${amount} back to your card`, tone: "warning", icon: "error" } as const,
      };
    case "refunded": {
      const refunded = formatMoney(order.refundedCents, order.currency);
      return {
        badge: { label: "Refunded", tone: "neutral" } as const,
        banner: { title: "Refunded", body: `${refunded} back to your card`, tone: "neutral", icon: "info" } as const,
      };
    }
    case "none":
      return null;
  }
}

// Additions for the attendee screens, for Payments & design to review. They build on the exports
// above, so the status wording stays in this one module.

/**
 * Every refusal an attendee screen can show: the shared API's reasons, plus `network` for a call
 * that threw or never answered (the API throws on a network failure instead of returning a reason).
 */
export type RefusalReason =
  | StartCheckoutRefusal
  | ConfirmCheckoutRefusal
  | OrderChangeRefusal
  | OrderLookupRefusal
  | "event_not_found"
  | "network";

export const refusalLabels: Record<RefusalReason, string> = {
  payment_not_verified: "We have not been able to verify your payment yet.",
  insufficient_stock: "Not enough stock left",
  over_max_per_order: "Over the limit per order",
  ordering_paused: "This booth has paused online orders",
  booth_not_accepting_orders: "This booth does not take online orders",
  empty_cart: "Your cart is empty",
  // The cart appends the named items to the stock and product refusals, so these have no full stop.
  product_not_found: "Some items are no longer sold",
  invalid_items: "Something in your cart could not be ordered. Check the quantities and try again.",
  invalid_email: "Enter a full email address, like name@example.com.",
  checkout_unavailable: "Online payment is not available right now. Try again in a moment.",
  order_not_found: "We could not find this order.",
  not_allowed_in_status: "This order can no longer be cancelled",
  event_not_found: "We could not find this event.",
  network: "Could not reach the server. Check your connection and try again.",
};

/** A booth that has paused online orders is never shown as taking them (FR-05). */
export const pausedBoothBadge: BadgeLabel = { label: "Online orders paused", tone: "warning" };

/** The status badge's words, for screens that name a status in text. */
export const orderStatusLabels = Object.fromEntries(
  Object.entries(statusBadges).map(([status, badge]) => [status, badge.label]),
) as Record<OrderStatus, string>;

/** How each kind of booth takes orders, as the Booths tab groups them. A paused booth also says so on its card (FR-05). */
export const shopTypeLabels: Record<BoothMode, { label: string; subtitle: string }> = {
  reservation: { label: "Reserve online", subtitle: "Pay when you pick up" },
  prepay: { label: "Pay online", subtitle: "Pay in the app and pick up" },
  discovery: { label: "Browse only", subtitle: "Purchase at the table only" },
};
