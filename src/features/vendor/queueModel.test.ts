import { describe, expect, it } from "vitest";
import type { Order } from "../../shared/types";
import { inTab, newConfirmedOrders, orderSummary, tabCounts } from "./queueModel";

const order = (overrides: Partial<Order> = {}): Order => ({
  id: "o1",
  boothId: "b",
  eventId: "e",
  boothCode: "B12",
  boothName: "Vendor",
  type: "reservation",
  status: "confirmed",
  totalCents: 3600,
  currency: "USD",
  pickupCode: "0427",
  holdEndsAt: null,
  createdAt: "2026-11-13T13:52:00Z",
  collectedAt: null,
  cancelReason: null,
  refundStatus: "none",
  refundedCents: 0,
  items: [
    { productId: "p1", name: "Patch", quantity: 1, unitPriceCents: 1800 },
    { productId: "p2", name: "Print", quantity: 1, unitPriceCents: 1800 },
  ],
  ...overrides,
});

describe("queue tabs", () => {
  it("puts an order in the tab of its status, and refunds in their own", () => {
    const orders = [
      order({ id: "a" }),
      order({ id: "b", status: "ready" }),
      order({ id: "c", status: "cancelled", type: "prepaid", refundStatus: "due" }),
      order({ id: "d", status: "expired", type: "prepaid", refundStatus: "due" }),
      order({ id: "e", status: "collected" }),
      order({ id: "f", status: "cancelled", type: "prepaid", refundStatus: "refunded" }),
    ];
    expect(tabCounts(orders)).toEqual({ confirmed: 1, ready: 1, refund: 2 });
  });

  it("does not show a checkout that is still waiting for payment", () => {
    const waiting = order({ type: "prepaid", status: "pending_payment" });
    expect(inTab(waiting, "confirmed")).toBe(false);
    expect(inTab(waiting, "ready")).toBe(false);
    expect(inTab(waiting, "refund")).toBe(false);
  });
});

describe("orderSummary", () => {
  it("counts quantities, not lines, and writes the total in the order's currency", () => {
    expect(orderSummary(order())).toBe("2 items · $36.00");
    expect(orderSummary(order({ items: [{ productId: "p", name: "x", quantity: 1, unitPriceCents: 1200 }], totalCents: 1200 }))).toBe(
      "1 item · $12.00",
    );
  });
});

describe("newConfirmedOrders", () => {
  it("returns only confirmed orders not seen before, oldest first", () => {
    const known = new Set(["a"]);
    const next = [order({ id: "c" }), order({ id: "b", status: "ready" }), order({ id: "a" }), order({ id: "d" })];
    expect(newConfirmedOrders(known, next).map((o) => o.id)).toEqual(["d", "c"]);
  });
});
