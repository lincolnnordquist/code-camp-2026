// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order, VendorBooth } from "../../shared/types";

const api = vi.hoisted(() => ({
  getMyBooth: vi.fn(),
  listBoothOrders: vi.fn(),
  markOrderReady: vi.fn(),
  collectOrder: vi.fn(),
  cancelOrder: vi.fn(),
  setProductStock: vi.fn(),
  setOrderingPaused: vi.fn(),
  signInVendor: vi.fn(),
  signOut: vi.fn(),
}));
const live = vi.hoisted(() => ({ online: true, push: [] as Array<(orders: unknown[]) => void> }));

vi.mock("../../shared/api", () => api);
vi.mock("../../shared/live", () => ({
  subscribeToBoothOrders: (_id: string, cb: (orders: unknown[]) => void) => {
    live.push.push(cb);
    return () => {
      live.push = live.push.filter((c) => c !== cb);
    };
  },
  useOnlineStatus: () => live.online,
}));

import VendorApp from "./VendorApp";

const order = (overrides: Partial<Order> = {}): Order => ({
  id: "o1",
  boothId: "b1",
  eventId: "e",
  boothCode: "B12",
  boothName: "Wall Rose Goods",
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
  items: [{ productId: "p1", name: "Patch", quantity: 2, unitPriceCents: 1800 }],
  ...overrides,
});

const booth: VendorBooth = {
  event: {
    id: "e",
    slug: "ev",
    name: "Code Camp",
    venueName: "Hall",
    currency: "USD",
    floorPlanUrl: null,
    reservationHoldMinutes: 120,
  },
  booth: {
    id: "b1",
    vendorName: "Wall Rose Goods",
    logoUrl: "",
    slogan: "",
    bannerUrl: "",
    code: "B12",
    mode: "reservation",
    orderingPaused: false,
    mapX: 0,
    mapY: 0,
    pickupInstructions: "",
  },
  products: [
    {
      id: "p1",
      boothId: "b1",
      name: "Patch",
      category: "x",
      description: "",
      imageUrl: "",
      priceCents: 1800,
      availableQty: 5,
      maxPerOrder: 3,
    },
  ],
};

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <VendorApp />
    </MemoryRouter>,
  );

beforeEach(() => {
  live.online = true;
  live.push = [];
  api.getMyBooth.mockResolvedValue({ ok: true, value: booth });
  api.listBoothOrders.mockResolvedValue([order()]);
});
afterEach(() => {
  localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

describe("order queue", () => {
  it("lists confirmed orders and marks one ready only after the server answers", async () => {
    let finish: (v: unknown) => void = () => undefined;
    api.markOrderReady.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    open("/vendor/orders");

    expect(await screen.findByRole("tab", { name: "Confirmed (1)" })).toBeTruthy();
    // The card lists what to set aside and how it is paid, with no badges.
    expect(screen.getByText("Patch")).toBeTruthy();
    expect(screen.getByText("×2")).toBeTruthy();
    expect(screen.getByText("Pay at pickup")).toBeTruthy();
    expect(screen.getByText("$36.00")).toBeTruthy();
    expect(screen.getByText("Pay at pickup")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mark order 0427 ready" }));
    // Nothing is claimed while the server has not answered.
    expect(screen.getByRole("tab", { name: "Confirmed (1)" })).toBeTruthy();
    await act(async () => finish({ ok: true, value: order({ status: "ready" }) }));
    expect(await screen.findByRole("tab", { name: "Confirmed (0)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Ready (1)" })).toBeTruthy();
  });

  it("shows an empty state, and the error state with a way to retry", async () => {
    api.listBoothOrders.mockResolvedValueOnce([]);
    open("/vendor/orders");
    expect(await screen.findByText("No orders yet")).toBeTruthy();
    cleanup();
    // No saved copy, as on a first visit.
    localStorage.clear();

    api.listBoothOrders.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce([order()]);
    open("/vendor/orders");
    expect(await screen.findByText("Could not load orders.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("tab", { name: "Confirmed (1)" })).toBeTruthy();
  });

  it("announces an order that arrives while the queue is open, but not the first load", async () => {
    open("/vendor/orders");
    await screen.findByRole("tab", { name: "Confirmed (1)" });
    expect(screen.queryByText(/New order/)).toBeNull();
    await act(async () => live.push[0]([order(), order({ id: "o2", pickupCode: "1936", totalCents: 1400, items: [{ productId: "p1", name: "Patch", quantity: 1, unitPriceCents: 1400 }] })]));
    expect(await screen.findByText("New order 1936: 1 item · $14.00")).toBeTruthy();
  });

  it("shows the last loaded orders when the server cannot be reached after a reload (FR-26)", async () => {
    open("/vendor/orders");
    await screen.findByRole("tab", { name: "Confirmed (1)" });
    cleanup();

    api.getMyBooth.mockRejectedValue(new Error("offline"));
    api.listBoothOrders.mockRejectedValue(new Error("offline"));
    open("/vendor/orders");
    expect(await screen.findByRole("tab", { name: "Confirmed (1)" })).toBeTruthy();
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
  });

  it("has nothing to fall back on the first time, so it shows the error state", async () => {
    api.getMyBooth.mockRejectedValue(new Error("offline"));
    open("/vendor/orders");
    expect(await screen.findByText("Could not load your booth.")).toBeTruthy();
  });

  it("disables changes and says so when offline", async () => {
    live.online = false;
    open("/vendor/orders");
    expect(await screen.findByText(/You are offline/)).toBeTruthy();
    expect(((await screen.findByRole("button", { name: "Mark order 0427 ready" })) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("order detail and cancelling", () => {
  it("asks for a reason, says a paid order will be owed a refund, and cancels", async () => {
    api.listBoothOrders.mockResolvedValue([order({ type: "prepaid", pickupCode: "3815", totalCents: 1200 })]);
    api.cancelOrder.mockResolvedValue({
      ok: true,
      value: order({ type: "prepaid", pickupCode: "3815", totalCents: 1200, status: "cancelled", cancelReason: "Sold out", refundStatus: "due" }),
    });
    open("/vendor/orders/o1");

    fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("This order is paid, so a refund of $12.00 will be due.")).toBeTruthy();
    expect(within(dialog).getByText(/Stock is not returned automatically/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));
    expect(api.cancelOrder).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Enter a reason. The customer sees it.")).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Sold out" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));
    await waitFor(() => expect(api.cancelOrder).toHaveBeenCalledWith("o1", "Sold out"));
    expect(await screen.findByText(/Refund \$12\.00 in Square/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Cancelled" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("pickup", () => {
  it("collects on the fourth digit and states that a reservation was paid at the booth", async () => {
    api.collectOrder.mockResolvedValue({
      ok: true,
      value: order({ status: "collected", collectedAt: "2026-11-13T14:14:00Z" }),
    });
    open("/vendor/pickup");
    const input = await screen.findByLabelText("Pickup code");
    fireEvent.change(input, { target: { value: "0427" } });
    await waitFor(() => expect(api.collectOrder).toHaveBeenCalledWith("b1", "0427"));
    expect(await screen.findByText("Hand over the items. Payment of $36.00 taken at the booth.")).toBeTruthy();
  });

  it("says an unknown code was not found and keeps the entry open", async () => {
    api.collectOrder.mockResolvedValue({ ok: false, reason: "not_found" });
    open("/vendor/pickup");
    fireEvent.change(await screen.findByLabelText("Pickup code"), { target: { value: "0000" } });
    expect(await screen.findByText("Code not found. Check it with the customer.")).toBeTruthy();
  });

  it("shows when an order was already collected, and what a cancelled one means", async () => {
    api.collectOrder.mockResolvedValueOnce({
      ok: false,
      reason: "already_collected",
      at: "2026-11-13T14:14:00Z",
      order: order({ status: "collected" }),
    });
    open("/vendor/pickup");
    fireEvent.change(await screen.findByLabelText("Pickup code"), { target: { value: "0427" } });
    expect(await screen.findByRole("heading", { name: "Already collected" })).toBeTruthy();
    // The refusal names the order, so its items are shown on a grey pass.
    expect(screen.getByText("Patch")).toBeTruthy();
    expect(document.querySelector(".vendor-pass--grey")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enter another code" }));

    api.collectOrder.mockResolvedValueOnce({
      ok: false,
      reason: "cancelled",
      order: order({ status: "cancelled", cancelReason: "Sold out" }),
    });
    fireEvent.change(await screen.findByLabelText("Pickup code"), { target: { value: "1111" } });
    expect(await screen.findByText("This order was cancelled. Items stay at the booth.")).toBeTruthy();
    expect(screen.getByText("Sold out")).toBeTruthy();
  });
});

describe("sign in", () => {
  it("sends a visitor with no session to the sign-in form", async () => {
    api.getMyBooth.mockResolvedValue({ ok: false, reason: "not_signed_in" });
    open("/vendor/orders");
    expect(await screen.findByRole("heading", { name: "Vendor sign in" })).toBeTruthy();
  });

  it("shows a wrong password as its own message", async () => {
    api.getMyBooth.mockResolvedValue({ ok: false, reason: "not_signed_in" });
    api.signInVendor.mockResolvedValue({ ok: false, reason: "invalid_credentials" });
    open("/vendor");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("That email and password do not match.")).toBeTruthy();
  });
});

describe("stock", () => {
  it("saves a quantity and pauses ordering", async () => {
    api.setProductStock.mockResolvedValue({ ok: true, value: { availableQty: 9 } });
    api.setOrderingPaused.mockResolvedValue({ ok: true, value: { paused: true } });
    open("/vendor/stock");

    fireEvent.change(await screen.findByLabelText("Available"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stock for Patch" }));
    await waitFor(() => expect(api.setProductStock).toHaveBeenCalledWith("p1", 9));
    expect(await screen.findByText("Saved")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pause orders" }));
    expect(await screen.findByRole("button", { name: "Resume orders" })).toBeTruthy();
  });
});
