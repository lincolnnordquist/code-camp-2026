import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { cancelOrder, markOrderReady } from "../../shared/api";
import { useOnlineStatus } from "../../shared/live";
import { Badge, Banner, Button, formatMoney, orderLabels } from "../../shared/ui";
import { refusalLabels } from "../../shared/ui/labels";
import { Skeleton, SkeletonGroup } from "../../shell/Skeleton";
import { CancelDialog } from "./CancelDialog";
import { OrderItems } from "./OrderItems";
import { VendorHeader } from "./VendorHeader";
import { VendorState } from "./VendorState";
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
  const { ordersState, reloadOrders, applyOrder, boothState } = useVendor();
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
        <SkeletonGroup label="Loading the order..." className="vendor-screen vendor-detail">
          <Skeleton height={176} shape="card" />
          <Skeleton height={120} shape="card" />
          <Skeleton height={160} shape="card" />
        </SkeletonGroup>
      </>
    );
  }
  if (ordersState.status === "error") {
    return (
      <>
        <VendorHeader title="Order" back={back} />
        <main className="vendor-screen">
          <VendorState icon="wifi_off" tone="error" alert title="Could not load this order." body="Check your connection and try again.">
            <Button onClick={reloadOrders}>Try again</Button>
          </VendorState>
        </main>
      </>
    );
  }
  const order = ordersState.orders.find((o) => o.id === orderId);
  if (!order) {
    return (
      <>
        <VendorHeader title="Order" back={back} />
        <main className="vendor-screen">
          <VendorState icon="info" title={refusalLabels.order_not_found}>
            <Link className="ec-btn ec-btn-md ec-btn-filled" to="/vendor/orders">
              Back to orders
            </Link>
          </VendorState>
        </main>
      </>
    );
  }

  const labels = orderLabels(order);
  const products = boothState.status === "ready" ? boothState.booth.products : [];
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
        <section className="vendor-pass" aria-labelledby="order-code">
          <div className="vendor-badges">
            <Badge tone={labels.statusBadge.tone}>{labels.statusBadge.label}</Badge>
            {labels.paymentBadge && <Badge tone={labels.paymentBadge.tone}>{labels.paymentBadge.label}</Badge>}
          </div>
          <p className="vendor-pass__label">Pickup code</p>
          <h1 className="vendor-pass__code" id="order-code">
            {order.pickupCode}
          </h1>
          <p className="vendor-pass__meta">Placed at {clockTime(order.createdAt)}</p>
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

        {((order.status === "cancelled" && order.cancelReason) || labels.vendorPayment || holdEnd) && (
          <dl className="vendor-facts">
            {order.status === "cancelled" && order.cancelReason && (
              <div>
                <dt>Reason</dt>
                <dd>{order.cancelReason}</dd>
              </div>
            )}
            {labels.vendorPayment && (
              <div>
                <dt>Payment</dt>
                <dd>{labels.vendorPayment}</dd>
              </div>
            )}
            {holdEnd && (
              <div>
                <dt>Held until</dt>
                <dd className="vendor-hold">
                  <time dateTime={holdEnd}>{clockTime(holdEnd)}</time>
                  <span className="vendor-timer">{Date.parse(holdEnd) > now ? timeLeft(Date.parse(holdEnd) - now) : "Hold ended"}</span>
                </dd>
              </div>
            )}
          </dl>
        )}

        <OrderItems order={order} products={products} />

        {active && (
          <div className="vendor-actions">
            {offline && <p className="vendor-actions__note">You are offline. Connect to change this order.</p>}
            {order.status === "confirmed" &&
              (busy === "ready" ? (
                <Button loadingLabel="Marking ready" />
              ) : (
                <Button disabled={offline} onClick={markReady}>
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
