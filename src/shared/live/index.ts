import { useSyncExternalStore } from "react";
import { listBoothOrders, listMyOrders } from "../api";
import { onChange } from "../api/sample-store";
import type { Order } from "../types";

// Real version: Supabase Realtime subscriptions. The stub re-reads the sample data on every change.
export function subscribeToMyOrders(
  callback: (orders: Order[]) => void,
): () => void {
  return onChange(() => void listMyOrders().then(callback));
}

export function subscribeToBoothOrders(
  boothId: string,
  callback: (orders: Order[]) => void,
): () => void {
  return onChange(() => void listBoothOrders(boothId).then(callback));
}

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}
