import { useSyncExternalStore } from "react";
import { listBoothOrders, listMyOrders } from "../api";
import { supabase } from "../api/client";
import { currentUserId } from "../api/session";
import type { Order } from "../types";

// Calls refresh whenever an order matching the filter changes, using Supabase Realtime.
// The rows the browser may hear about are the ones the access rules let it read. The
// filter needs a signed-in user, so with none the watch starts once a sign-in happens,
// such as an attendee's first order.
function watchOrders(
  filterFor: (userId: string) => string | null,
  refresh: () => void,
): () => void {
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let closed = false;
  let connecting = false;

  const disconnect = () => {
    if (channel) void supabase.removeChannel(channel);
    channel = null;
  };

  const connect = async () => {
    if (connecting) return;
    connecting = true;
    try {
      disconnect();
      const userId = await currentUserId();
      const filter = userId ? filterFor(userId) : null;
      if (closed || !filter) return;
      channel = supabase
        .channel(`orders:${filter}:${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders", filter },
          refresh,
        )
        // Changes made while the connection was down are missed, so refresh when it is back.
        .subscribe((status) => {
          if (status === "SUBSCRIBED") refresh();
        });
    } finally {
      connecting = false;
    }
  };

  void connect();
  // Not awaited inside the callback, which would block the auth client.
  const { data: listener } = supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
      setTimeout(() => void connect(), 0);
    }
  });

  return () => {
    closed = true;
    listener.subscription.unsubscribe();
    disconnect();
  };
}

// Calls refresh when an order changes, and stops answering the moment the watch is closed:
// a read that was already under way when the screen left must not call it back afterwards.
function watchAndRead(
  filterFor: (userId: string) => string | null,
  read: () => Promise<Order[]>,
  callback: (orders: Order[]) => void,
): () => void {
  let open = true;
  const stop = watchOrders(filterFor, () => {
    void read().then(
      (orders) => {
        if (open) callback(orders);
      },
      () => undefined,
    );
  });
  return () => {
    open = false;
    stop();
  };
}

// Calls back with the attendee's orders now and whenever one changes.
export function subscribeToMyOrders(
  callback: (orders: Order[]) => void,
): () => void {
  return watchAndRead(
    (userId) => `user_id=eq.${userId}`,
    listMyOrders,
    callback,
  );
}

// Calls back with a booth's orders now and whenever one changes. For vendor staff.
export function subscribeToBoothOrders(
  boothId: string,
  callback: (orders: Order[]) => void,
): () => void {
  return watchAndRead(
    () => `booth_id=eq.${boothId}`,
    () => listBoothOrders(boothId),
    callback,
  );
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
