import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { cancelOrder, markOrderReady } from "../../shared/api";
import { useOnlineStatus } from "../../shared/live";
import { Badge, Banner, Button, formatMoney, orderLabels } from "../../shared/ui";
import { refusalLabels } from "../../shared/ui/labels";
import { Skeleton, SkeletonGroup } from "../../shell/Skeleton";
import { CancelDialog } from "./CancelDialog";
import { VendorHeader } from "./VendorHeader";
import { clockTime } from "./queueModel";
import { useVendor } from "./vendorSession";

const HOLD_TICK_MS = 1_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), HOLD_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

function timeLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h > 0 ? `${h}:${pad(m)}` : m}:${pad(total % 60)} left`;
}

export function OrderDetail() {
  const { orderId } = useParams();
  const { ordersState, reloadOrders, applyOrder } = useVendor();
  const online = useOnlineStatus();
  const now = useNow();
  const [busy, setBusy] = useState<"ready" | "cancel" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const back = { label: "Back to orders", to: "/vendor/orders" };
  if (ordersState.status === "loading") {
    return (
      <>
        <VendorHeader title="Order" back={back} />
        <SkeletonGroup label="Loading the order..." className="vendor-screen">
          <Skeleton width="40%" height={24} />
          <Skeleton width="50%" height={44} />
          <Skeleton height={120} shape="card" />
        </SkeletonGroup>
      </>
    );
  }
  if (ordersState.status === "error") {
    return (
      <>
        <VendorHeader title="Order" back={back} />
        <div className="vendor-screen vendor-state" role="alert">
          <p className="title-medium">Could not load this order.</p>
          <Button variant="vendor" onClick={reloadOrders}>
            Try again
          </Button>
        </div>
      </>
    );
  }
  const order = ordersState.orders.find((o) => o.id === orderId);
  if (!order) {
    return (
      <>
        <VendorHeader title="Order" back={back} />
        <div className="vendor-screen vendor-state">
          <p className="title-medium">{refusalLabels.order_not_found}</p>
          <Link className="ec-btn ec-btn-md ec-btn-vendor" to="/vendor/orders">
            Back to orders
          </Link>
        </div>
      </>
    );
  }

  const labels = orderLabels(order);
  const money = (cents: number) => formatMoney(cents, order.currency);
  const active = order.status === "confirmed" || order.status === "ready";
  // Only an unpaid reservation has a hold to show; a prepaid order is already paid.
  const holdEnd = order.type === "reservation" && active && order.holdEndsAt ? order.holdEndsAt : null;
  const offline = !online;

  const markReady = async () => {
    setBusy("ready");
    setProblem(null);
    try {
      const result = await markOrderReady(order.id);
      if (result.ok) applyOrder(result.value);
      else {
        setProblem("This order changed, so it was not marked ready. It is refreshed below.");
        reloadOrders();
      }
    } catch {
      setProblem(refusalLabels.network);
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (reason: string) => {
    setBusy("cancel");
    setCancelError(null);
    try {
      const result = await cancelOrder(order.id, reason);
      if (result.ok) {
        applyOrder(result.value);
        setCancelling(false);
      } else if (result.reason === "reason_required") {
        setCancelError("Enter a reason. The customer sees it.");
      } else {
        setCancelling(false);
        setProblem("This order can no longer be cancelled. It is refreshed below.");
        reloadOrders();
      }
    } catch {
      setCancelError(refusalLabels.network);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <VendorHeader title="Order" back={back} />
      <main className="vendor-screen vendor-detail">
        <section className="vendor-section vendor-section-top">
          <div className="vendor-badges">
            <Badge tone={labels.statusBadge.tone}>{labels.statusBadge.label}</Badge>
            {labels.paymentBadge && <Badge tone={labels.paymentBadge.tone}>{labels.paymentBadge.label}</Badge>}
          </div>
          <h1 className="code">{order.pickupCode}</h1>
          <p className="body-large">Placed at {clockTime(order.createdAt)}</p>
        </section>

        {problem && (
          <Banner tone="error" icon="error">
            {problem}
          </Banner>
        )}
        {order.refundStatus === "due" && (
          <Banner tone="warning" icon="error" title="Refund due:">
            Refund {money(order.totalCents)} in Square. It shows as refunded here once Square confirms it.
          </Banner>
        )}
        {order.refundStatus === "refunded" && (
          <Banner tone="neutral" icon="info" title="Refunded:">
            {money(order.refundedCents)} went back to the customer.
          </Banner>
        )}
        {order.status === "cancelled" && order.cancelReason && (
          <dl className="vendor-facts">
            <div>
              <dt className="body-small">Reason</dt>
              <dd className="body-large">{order.cancelReason}</dd>
            </div>
          </dl>
        )}

        <section className="vendor-section">
          <h2 className="title-medium">Items</h2>
          <div className="vendor-lines body-large">
            {order.items.map((item) => (
              <div key={item.productId}>
                <span>
                  {item.quantity} × {item.name}
                </span>
                <span>{money(item.quantity * item.unitPriceCents)}</span>
              </div>
            ))}
          </div>
          <div className="vendor-total title-medium">
            <span>Total</span>
            <span>{money(order.totalCents)}</span>
          </div>
        </section>

        {(labels.vendorPayment || holdEnd) && (
          <dl className="vendor-facts">
            {labels.vendorPayment && (
              <div>
                <dt className="body-small">Payment</dt>
                <dd className="body-large">{labels.vendorPayment}</dd>
              </div>
            )}
            {holdEnd && (
              <div>
                <dt className="body-small">Held until</dt>
                <dd className="body-large vendor-hold">
                  <time dateTime={holdEnd}>{clockTime(holdEnd)}</time>
                  <span className="timer">{Date.parse(holdEnd) > now ? timeLeft(Date.parse(holdEnd) - now) : "Hold ended"}</span>
                </dd>
              </div>
            )}
          </dl>
        )}

        {active && (
          <div className="vendor-actions">
            {offline && <p className="body-small">You are offline. Connect to change this order.</p>}
            {order.status === "confirmed" &&
              (busy === "ready" ? (
                <Button variant="vendor" loadingLabel="Marking ready" />
              ) : (
                <Button variant="vendor" disabled={offline} onClick={markReady}>
                  Mark ready
                </Button>
              ))}
            <Button variant="destructive" disabled={offline} onClick={() => setCancelling(true)}>
              Cancel order
            </Button>
          </div>
        )}
      </main>
      {cancelling && (
        <CancelDialog
          order={order}
          busy={busy === "cancel"}
          online={online}
          error={cancelError}
          onConfirm={cancel}
          onKeep={() => {
            setCancelling(false);
            setCancelError(null);
          }}
        />
      )}
    </>
  );
}
