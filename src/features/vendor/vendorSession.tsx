import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getMyBooth, listBoothOrders } from "../../shared/api";
import { subscribeToBoothOrders } from "../../shared/live";
import type { MyBoothRefusal, Order, VendorBooth } from "../../shared/types";
import { newConfirmedOrders } from "./queueModel";

export type BoothState =
  | { status: "loading" }
  | { status: "ready"; booth: VendorBooth }
  | { status: "signed_out"; reason: MyBoothRefusal }
  | { status: "error" };

export type OrdersState =
  | { status: "loading" }
  | { status: "error" }
  // `stale`: the last refresh failed, so what is shown may be out of date.
  | { status: "ready"; orders: Order[]; stale: boolean };

type VendorContextValue = {
  boothState: BoothState;
  reloadBooth: () => void;
  // Replaces the booth's data after a stock or pause change the server confirmed.
  applyBooth: (booth: VendorBooth) => void;
  ordersState: OrdersState;
  reloadOrders: () => void;
  // Shows an order the server just returned from an action.
  applyOrder: (order: Order) => void;
  // The newest order that arrived while the screen was open, or null.
  arrival: Order | null;
  dismissArrival: () => void;
};

const VendorContext = createContext<VendorContextValue | null>(null);

export function useVendor(): VendorContextValue {
  const value = useContext(VendorContext);
  if (!value) throw new Error("useVendor needs a VendorProvider");
  return value;
}

export function VendorProvider({ children }: { children: ReactNode }) {
  const [boothState, setBoothState] = useState<BoothState>({ status: "loading" });
  const [boothTry, setBoothTry] = useState(0);

  // getMyBooth also restores a vendor after a page refresh.
  useEffect(() => {
    let active = true;
    getMyBooth().then(
      (result) => {
        if (!active) return;
        setBoothState(
          result.ok
            ? { status: "ready", booth: result.value }
            : { status: "signed_out", reason: result.reason },
        );
      },
      () => active && setBoothState({ status: "error" }),
    );
    return () => {
      active = false;
    };
  }, [boothTry]);

  const reloadBooth = useCallback(() => {
    setBoothState({ status: "loading" });
    setBoothTry((n) => n + 1);
  }, []);
  const applyBooth = useCallback(
    (booth: VendorBooth) => setBoothState({ status: "ready", booth }),
    [],
  );

  const boothId = boothState.status === "ready" ? boothState.booth.booth.id : null;
  const orders = useBoothOrders(boothId);

  return (
    <VendorContext.Provider
      value={{ boothState, reloadBooth, applyBooth, ...orders }}
    >
      {children}
    </VendorContext.Provider>
  );
}

// The booth's orders: read once, then re-read whenever one changes (FR-20). A failed read
// keeps what was already shown and marks it stale (FR-26).
function useBoothOrders(boothId: string | null) {
  // Tagged with the booth it belongs to, so a different booth reads as loading without
  // resetting state inside the effect.
  const [tagged, setTagged] = useState<{ boothId: string | null; state: OrdersState }>({
    boothId,
    state: { status: "loading" },
  });
  const ordersState: OrdersState =
    tagged.boothId === boothId ? tagged.state : { status: "loading" };
  const setOrdersState = useCallback(
    (next: OrdersState | ((prev: OrdersState) => OrdersState)) =>
      setTagged((t) => {
        const prev: OrdersState = t.boothId === boothId ? t.state : { status: "loading" };
        return { boothId, state: typeof next === "function" ? next(prev) : next };
      }),
    [boothId],
  );
  const [arrival, setArrival] = useState<Order | null>(null);
  // The ids seen so far. Null until the first read, so opening the screen announces nothing.
  const known = useRef<Set<string> | null>(null);
  const loadRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!boothId) return;
    let active = true;
    known.current = null;

    const show = (orders: Order[]) => {
      if (!active) return;
      if (known.current) {
        const arrived = newConfirmedOrders(known.current, orders);
        if (arrived.length > 0) setArrival(arrived[arrived.length - 1]);
      }
      known.current = new Set(orders.map((o) => o.id));
      setOrdersState({ status: "ready", orders, stale: false });
    };
    const load = () =>
      listBoothOrders(boothId).then(show, () => {
        if (!active) return;
        setOrdersState((s) =>
          s.status === "ready" ? { ...s, stale: true } : { status: "error" },
        );
      });
    loadRef.current = () => {
      void load();
    };

    void load();
    window.addEventListener("online", loadRef.current);
    const stop = subscribeToBoothOrders(boothId, show);
    return () => {
      active = false;
      window.removeEventListener("online", loadRef.current);
      stop();
    };
  }, [boothId, setOrdersState]);

  const reloadOrders = useCallback(() => loadRef.current(), []);
  const applyOrder = useCallback((order: Order) => {
    setOrdersState((s) => {
      if (s.status !== "ready") return s;
      const exists = s.orders.some((o) => o.id === order.id);
      const orders = exists
        ? s.orders.map((o) => (o.id === order.id ? order : o))
        : [order, ...s.orders];
      return { status: "ready", orders, stale: false };
    });
    // Our own change is not "new".
    known.current?.add(order.id);
  }, [setOrdersState]);
  const dismissArrival = useCallback(() => setArrival(null), []);

  return { ordersState, reloadOrders, applyOrder, arrival, dismissArrival };
}
