import { useState } from "react";
import { markOrderReady } from "../../shared/api";
import { useOnlineStatus } from "../../shared/live";
import type { Order } from "../../shared/types";
import { Badge, Banner, Button, orderLabels, VendorOrderRow } from "../../shared/ui";
import { refusalLabels } from "../../shared/ui/labels";
import { Skeleton, SkeletonGroup } from "../../shell/Skeleton";
import { VendorHeader } from "./VendorHeader";
import { clockTime, inTab, orderSummary, QUEUE_TABS, tabCounts, type QueueTab } from "./queueModel";
import { useVendor } from "./vendorSession";

const emptyText: Record<QueueTab, { title: string; body: string }> = {
  confirmed: { title: "No confirmed orders", body: "New orders show up here as they come in." },
  ready: { title: "No orders ready", body: "Orders you mark ready wait here until they are collected." },
  refund: { title: "No refunds due", body: "A cancelled or expired paid order shows here until you refund it in Square." },
};

export function OrderQueue() {
  const { ordersState, reloadOrders, applyOrder } = useVendor();
  const online = useOnlineStatus();
  const [tab, setTab] = useState<QueueTab>("confirmed");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const markReady = async (order: Order) => {
    if (busyId) return;
    setBusyId(order.id);
    setProblem(null);
    try {
      const result = await markOrderReady(order.id);
      if (result.ok) applyOrder(result.value);
      else {
        // The order changed under us (cancelled or collected elsewhere): show what is true now.
        setProblem(`Order ${order.pickupCode} changed, so it was not marked ready. The list is refreshed.`);
        reloadOrders();
      }
    } catch {
      setProblem(refusalLabels.network);
    } finally {
      setBusyId(null);
    }
  };

  if (ordersState.status === "loading") {
    return (
      <>
        <VendorHeader title="Orders" heading />
        <SkeletonGroup label="Loading orders..." className="vendor-screen">
          <Skeleton height={48} />
          <Skeleton height={120} shape="card" />
          <Skeleton height={120} shape="card" />
        </SkeletonGroup>
      </>
    );
  }
  if (ordersState.status === "error") {
    return (
      <>
        <VendorHeader title="Orders" heading />
        <div className="vendor-screen vendor-state" role="alert">
          <p className="title-medium">Could not load orders.</p>
          <p className="body-medium">Check your connection and try again.</p>
          <Button variant="vendor" onClick={reloadOrders}>
            Try again
          </Button>
        </div>
      </>
    );
  }

  const { orders, stale } = ordersState;
  const counts = tabCounts(orders);
  const shown = orders.filter((o) => inTab(o, tab));
  const nothingAtAll = orders.every((o) => !inTab(o, "confirmed") && !inTab(o, "ready") && !inTab(o, "refund"));

  return (
    <>
      <VendorHeader title="Orders" heading />
      <div role="tablist" aria-label="Order status" className="vendor-tabs">
        {QUEUE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="queue-panel"
            className="vendor-tab"
            onClick={() => setTab(t.id)}
          >
            {t.label} ({counts[t.id]})
          </button>
        ))}
      </div>
      <main className="vendor-screen" id="queue-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {stale && (
          <Banner tone="warning" icon="warning" action={<Button size="small" variant="text" onClick={reloadOrders}>Refresh</Button>}>
            The latest orders could not be loaded. What you see may be out of date.
          </Banner>
        )}
        {problem && (
          <Banner tone="error" icon="error">
            {problem}
          </Banner>
        )}
        {shown.length === 0 ? (
          <div className="vendor-state">
            <p className="title-medium">{nothingAtAll ? "No orders yet" : emptyText[tab].title}</p>
            <p className="body-medium">{nothingAtAll ? "New orders show up here as they come in." : emptyText[tab].body}</p>
          </div>
        ) : (
          shown.map((order) => {
            const labels = orderLabels(order);
            return (
              <VendorOrderRow
                key={order.id}
                href={`/vendor/orders/${order.id}`}
                pickupCode={order.pickupCode}
                time={clockTime(order.createdAt)}
                itemCount={orderSummary(order)}
                total=""
                badges={
                  <>
                    {tab === "refund" && <Badge tone={labels.statusBadge.tone}>{labels.statusBadge.label}</Badge>}
                    {labels.paymentBadge && <Badge tone={labels.paymentBadge.tone}>{labels.paymentBadge.label}</Badge>}
                  </>
                }
                action={
                  order.status === "confirmed" &&
                  (busyId === order.id ? (
                    <Button size="small" variant="vendor" loadingLabel={`Marking order ${order.pickupCode} ready`} />
                  ) : (
                    <Button
                      size="small"
                      variant="vendor"
                      disabled={!online}
                      aria-label={`Mark order ${order.pickupCode} ready`}
                      onClick={() => markReady(order)}
                    >
                      Mark ready
                    </Button>
                  ))
                }
              />
            );
          })
        )}
      </main>
    </>
  );
}
