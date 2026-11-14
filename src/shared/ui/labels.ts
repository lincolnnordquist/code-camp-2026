// The one place for order status and payment wording (FR-28).
// A reservation is never labelled paid, and a pending payment is never labelled complete.
import type { BoothMode, Order, OrderStatus } from "../types";
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

type LabelledOrder = Pick<Order, "type" | "status" | "refundStatus" | "totalCents" | "currency">;

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
  const refund = refundLabels(order.refundStatus, amount);
  return {
    statusBadge,
    paymentBadge: refund?.badge ?? { label: "Paid", tone: "outlined" },
    headline,
    attendeePayment: paid,
    vendorPayment: paid,
    refundBanner: refund?.banner ?? null,
  };
}

function refundLabels(refundStatus: LabelledOrder["refundStatus"], amount: string) {
  switch (refundStatus) {
    case "due":
      return {
        badge: { label: "Refund due", tone: "warning" } as const,
        banner: { title: "Refund due:", body: `${amount} back to your card`, tone: "warning", icon: "error" } as const,
      };
    case "refunded":
      return {
        badge: { label: "Refunded", tone: "neutral" } as const,
        banner: { title: "Refunded:", body: `${amount} back to your card`, tone: "neutral", icon: "info" } as const,
      };
    case "none":
      return null;
  }
}
