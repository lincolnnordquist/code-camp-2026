import { formatMoney } from "../../shared/ui";
import type { Order } from "../../shared/types";

export type QueueTab = "confirmed" | "ready" | "refund";

export const QUEUE_TABS: { id: QueueTab; label: string }[] = [
  { id: "confirmed", label: "Confirmed" },
  { id: "ready", label: "Ready" },
  { id: "refund", label: "Refund due" },
];

// The vendor sees an order from the moment it is confirmed. A checkout still waiting for
// payment is not an order yet, so it is in no tab. A refund is owed on a cancelled or
// expired prepaid order whatever its status was before (FR-14, FR-15).
export function inTab(order: Order, tab: QueueTab): boolean {
  if (tab === "refund") return order.refundStatus === "due";
  return order.status === tab;
}

export function tabCounts(orders: Order[]): Record<QueueTab, number> {
  return {
    confirmed: orders.filter((o) => inTab(o, "confirmed")).length,
    ready: orders.filter((o) => inTab(o, "ready")).length,
    refund: orders.filter((o) => inTab(o, "refund")).length,
  };
}

export function itemCount(order: Order): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

// "2 items · $36.00"
export function orderSummary(order: Order): string {
  const count = itemCount(order);
  return `${count} ${count === 1 ? "item" : "items"} · ${formatMoney(order.totalCents, order.currency)}`;
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Orders whose id is not in `known`, oldest first. Used to announce a new order.
export function newConfirmedOrders(known: ReadonlySet<string>, next: Order[]): Order[] {
  return next.filter((o) => !known.has(o.id) && o.status === "confirmed").reverse();
}
