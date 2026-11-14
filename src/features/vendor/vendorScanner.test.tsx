// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order, VendorBooth } from "../../shared/types";
import { pickupCodeFromScan, readScanFrame, SAME_CODE_GONE_MS, SAME_CODE_HOLD_MAX_MS } from "./scanHold";

const api = vi.hoisted(() => ({
  getMyBooth: vi.fn(),
  listBoothOrders: vi.fn(),
  collectOrder: vi.fn(),
  markOrderReady: vi.fn(),
  cancelOrder: vi.fn(),
  setProductStock: vi.fn(),
  setOrderingPaused: vi.fn(),
  signInVendor: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../../shared/api", () => api);
vi.mock("../../shared/live", () => ({ subscribeToBoothOrders: () => () => undefined, useOnlineStatus: () => true }));

import VendorApp from "./VendorApp";

const booth = {
  event: { id: "e", slug: "ev", name: "Code Camp", venueName: "Hall", currency: "USD", floorPlanUrl: null, reservationHoldMinutes: 120 },
  booth: { id: "b1", vendorName: "Wall Rose Goods", logoUrl: "", slogan: "", bannerUrl: "", code: "B12", mode: "reservation", orderingPaused: false, mapX: 0, mapY: 0, pickupInstructions: "" },
  products: [],
} satisfies VendorBooth;

const collected: Order = {
  id: "o1",
  boothId: "b1",
  eventId: "e",
  boothCode: "B12",
  boothName: "Wall Rose Goods",
  type: "reservation",
  status: "collected",
  totalCents: 3600,
  currency: "USD",
  pickupCode: "0427",
  holdEndsAt: null,
  createdAt: "2026-11-13T13:52:00Z",
  collectedAt: "2026-11-13T14:14:00Z",
  cancelReason: null,
  refundStatus: "none",
  refundedCents: 0,
  items: [{ productId: "p1", name: "Patch", quantity: 2, unitPriceCents: 1800 }],
};

// What the camera "sees", frame by frame; the last entry repeats, as a code held in view does.
let frames: (string | null)[] = [];
const stopTrack = vi.fn();
const getUserMedia = vi.fn();

class FakeBarcodeDetector {
  static getSupportedFormats = async () => ["qr_code"];
  async detect() {
    const value = frames.length > 1 ? frames.shift() : frames[0];
    return value ? [{ rawValue: value }] : [];
  }
}

beforeEach(() => {
  frames = [];
  stopTrack.mockClear();
  api.getMyBooth.mockResolvedValue({ ok: true, value: booth });
  api.listBoothOrders.mockResolvedValue([]);
  const track = { stop: stopTrack, getCapabilities: () => ({}) };
  getUserMedia.mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] });
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.stubGlobal("BarcodeDetector", FakeBarcodeDetector);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  api.collectOrder.mockReset();
  getUserMedia.mockReset();
});

const openScanner = async () => {
  render(
    <MemoryRouter initialEntries={["/vendor/pickup"]}>
      <VendorApp />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Scan QR code" }));
  fireEvent.click(await screen.findByRole("button", { name: "Turn on camera" }));
};

describe("reading a scanned QR", () => {
  it("takes exactly a 4-digit code and nothing else", () => {
    expect(pickupCodeFromScan("0427")).toBe("0427");
    expect(pickupCodeFromScan(" 0427\n")).toBe("0427");
    for (const other of ["427", "04271", "abcd", "https://dibspot.app/orders/1", "", null, 427, ["0427"]]) {
      expect(pickupCodeFromScan(other)).toBeNull();
    }
  });

  it("uses a code once while it stays in view, and again once it has been away", () => {
    const first = readScanFrame(null, "0427", 0);
    expect(first.kind).toBe("code");
    const held = readScanFrame(first.hold, "0427", 500);
    expect(held.kind).toBe("none");
    const away = readScanFrame(held.hold, null, 600);
    // Last seen at 500: still held just under the gone time, a new scan once it has passed.
    expect(readScanFrame(away.hold, "0427", 500 + SAME_CODE_GONE_MS - 1).kind).toBe("none");
    expect(readScanFrame(away.hold, "0427", 500 + SAME_CODE_GONE_MS).kind).toBe("code");
    // A code left in view is asked about again after the longest hold.
    let hold = first.hold;
    for (let t = 200; t < SAME_CODE_HOLD_MAX_MS; t += 200) hold = readScanFrame(hold, "0427", t).hold;
    expect(readScanFrame(hold, "0427", SAME_CODE_HOLD_MAX_MS).kind).toBe("code");
    expect(readScanFrame(null, "hello", 0).kind).toBe("not_pickup");
    expect(readScanFrame(null, "1936", 0).kind).toBe("code");
  });
});

describe("scanning at pickup", () => {
  it("ignores another QR, then runs the code lookup once and releases the camera", async () => {
    api.collectOrder.mockResolvedValue({ ok: true, value: collected });
    frames = ["https://example.com", "0427"];
    await openScanner();

    expect(await screen.findByText(/not a pickup code/)).toBeTruthy();
    await waitFor(() => expect(api.collectOrder).toHaveBeenCalledWith("b1", "0427"), { timeout: 3000 });
    expect(await screen.findByRole("heading", { name: "Collected" })).toBeTruthy();
    // The code stayed in view, but it was looked up once.
    await act(() => new Promise((r) => setTimeout(r, 600)));
    expect(api.collectOrder).toHaveBeenCalledTimes(1);
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: "environment" } }, audio: false });
  });

  it("stops the camera when closed, and focus goes back to the scan button", async () => {
    frames = [null];
    await openScanner();
    await screen.findByText(/Point the camera/);
    fireEvent.click(screen.getByRole("button", { name: "Type the code instead" }));
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Scan QR code" }));
    expect(api.collectOrder).not.toHaveBeenCalled();
  });

  it("says when camera access is refused and keeps typing open", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    await openScanner();
    expect(await screen.findByRole("heading", { name: "Camera access is off" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Pickup code")).toBeTruthy();
  });
});
