import { useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { markOrderReady } from "../../shared/api";
import { useOnlineStatus } from "../../shared/live";
import type { Order } from "../../shared/types";
import { Badge, Banner, Button, Icon, orderLabels } from "../../shared/ui";
import { refusalLabels } from "../../shared/ui/labels";
import { Skeleton, SkeletonGroup } from "../../shell/Skeleton";
import { VendorHeader, VendorTitle } from "./VendorHeader";
import { VendorState } from "./VendorState";
import { clockTime, inTab, orderSummary, QUEUE_TABS, tabCounts, type QueueTab } from "./queueModel";
import { useVendor } from "./vendorSession";

const emptyText: Record<QueueTab, { title: string; body: string; icon: "receipt_long" | "check_circle" | "info" }> = {
  confirmed: { title: "No confirmed orders", body: "New orders show up here as they come in.", icon: "receipt_long" },
  ready: { title: "No orders ready", body: "Orders you mark ready wait here until they are collected.", icon: "check_circle" },
  refund: { title: "No refunds due", body: "A cancelled or expired paid order shows here until you refund it in Square.", icon: "info" },
};

export function OrderQueue() {
  const { ordersState, reloadOrders, applyOrder } = useVendor();
  const online = useOnlineStatus();
  const [tab, setTab] = useState<QueueTab>("confirmed");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const tabRefs = useRef<Partial<Record<QueueTab, HTMLButtonElement | null>>>({});

  // The tabs pattern: arrows, Home and End move between the tabs and select the one they land on.
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const at = QUEUE_TABS.findIndex((t) => t.id === tab);
    const last = QUEUE_TABS.length - 1;
    const next = { ArrowRight: at === last ? 0 : at + 1, ArrowLeft: at === 0 ? last : at - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const id = QUEUE_TABS[next].id;
    setTab(id);
    tabRefs.current[id]?.focus();
  };

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
        <VendorHeader title="Orders" />
        <SkeletonGroup label="Loading orders..." className="vendor-screen">
          <Skeleton width="40%" height={36} />
          <Skeleton height={52} shape="pill" />
          <Skeleton height={148} shape="card" />
          <Skeleton height={148} shape="card" />
        </SkeletonGroup>
      </>
    );
  }
  if (ordersState.status === "error") {
    return (
      <>
        <VendorHeader title="Orders" />
        <main className="vendor-screen">
          <VendorTitle title="Orders" />
          <VendorState icon="wifi_off" tone="error" alert title="Could not load orders." body="Check your connection and try again.">
            <Button onClick={reloadOrders}>Try again</Button>
          </VendorState>
        </main>
      </>
    );
  }

  const { orders, stale } = ordersState;
  const counts = tabCounts(orders);
  const shown = orders.filter((o) => inTab(o, tab));
  const nothingAtAll = orders.every((o) => !inTab(o, "confirmed") && !inTab(o, "ready") && !inTab(o, "refund"));
  const empty = nothingAtAll ? { title: "No orders yet", body: "New orders show up here as they come in.", icon: "receipt_long" as const } : emptyText[tab];

  return (
    <>
      <VendorHeader title="Orders" />
      <main className="vendor-screen vendor-queue">
        <VendorTitle title="Orders" />
        <div role="tablist" aria-label="Order status" className="vendor-segments">
          {QUEUE_TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="queue-panel"
              tabIndex={tab === t.id ? 0 : -1}
              className={`vendor-segment${t.id === "refund" && counts.refund > 0 ? " has-refund" : ""}`}
              onClick={() => setTab(t.id)}
              onKeyDown={onTabKey}
            >
              {/* The count shows as a badge; the tab's name stays "Confirmed (3)" for screen readers. */}
              {t.label}{" "}
              <span className="visually-hidden">({counts[t.id]})</span>
              <span className="vendor-segment__count" aria-hidden="true">
                {counts[t.id]}
              </span>
            </button>
          ))}
        </div>
        <div className="vendor-queue__panel" id="queue-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
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
            <VendorState icon={empty.icon} title={empty.title} body={empty.body} />
          ) : (
            <ul className="vendor-queue__list" role="list">
              {shown.map((order) => {
                const labels = orderLabels(order);
                return (
                  <li key={order.id}>
                    <article className={`vendor-order vendor-order--${order.status}`}>
                      <div className="vendor-order__top">
                        <Link className="vendor-order__open" to={`/vendor/orders/${order.id}`}>
                          <span className="vendor-order__label">Pickup code</span>
                          <span className="vendor-order__code">{order.pickupCode}</span>
                        </Link>
                        <span className="vendor-order__badges">
                          {tab === "refund" && <Badge tone={labels.statusBadge.tone}>{labels.statusBadge.label}</Badge>}
                          {labels.paymentBadge && <Badge tone={labels.paymentBadge.tone}>{labels.paymentBadge.label}</Badge>}
                        </span>
                        <Icon name="chevron_right" className="vendor-order__chevron" />
                      </div>
                      <p className="vendor-order__meta">
                        <span>{orderSummary(order)}</span>
                        <time dateTime={order.createdAt}>{clockTime(order.createdAt)}</time>
                      </p>
                      {order.status === "confirmed" &&
                        (busyId === order.id ? (
                          <Button variant="tonal" className="vendor-order__action" loadingLabel={`Marking order ${order.pickupCode} ready`} />
                        ) : (
                          <Button
                            variant="tonal"
                            className="vendor-order__action"
                            disabled={!online}
                            aria-label={`Mark order ${order.pickupCode} ready`}
                            onClick={() => markReady(order)}
                          >
                            Mark ready
                          </Button>
                        ))}
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
