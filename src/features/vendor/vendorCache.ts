import type { Order, VendorBooth } from "../../shared/types";

// FR-26: the last loaded booth and orders stay viewable offline. The copy belongs to this
// browser and holds pickup codes, so it is removed on sign-out and whenever the session is
// found to be gone.
const KEY = "vendor.cache";

type Saved = { booth?: VendorBooth; orders?: { boothId: string; list: Order[] } };

function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : {};
  } catch {
    return {};
  }
}

function write(saved: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // A full or blocked storage only costs the offline copy.
  }
}

export const readCachedBooth = (): VendorBooth | null => read().booth ?? null;

export function saveBooth(booth: VendorBooth) {
  const saved = read();
  // Another booth's orders are not this booth's.
  const keep = saved.orders?.boothId === booth.booth.id ? saved.orders : undefined;
  write({ booth, orders: keep });
}

export function readCachedOrders(boothId: string): Order[] | null {
  const orders = read().orders;
  return orders?.boothId === boothId ? orders.list : null;
}

export function saveOrders(boothId: string, list: Order[]) {
  write({ ...read(), orders: { boothId, list } });
}

export function clearVendorCache() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to remove.
  }
}
