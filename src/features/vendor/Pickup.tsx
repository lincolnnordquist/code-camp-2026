import { useEffect, useRef, useState } from "react";
import { collectOrder } from "../../shared/api";
import { useOnlineStatus } from "../../shared/live";
import type { Order } from "../../shared/types";
import { Badge, Button, CodeEntry, formatMoney, orderLabels } from "../../shared/ui";
import { refusalLabels } from "../../shared/ui/labels";
import { VendorHeader } from "./VendorHeader";
import { clockTime } from "./queueModel";
import { useVendor } from "./vendorSession";

// What the last code led to. A refusal carries no order, so those screens show only what
// the server told us: the code, and the time for an order that was already collected.
type Outcome =
  | { kind: "collected"; order: Order }
  | { kind: "already_collected"; code: string; at?: string }
  | { kind: "cancelled" | "expired"; code: string };

export function Pickup() {
  const { boothState, applyOrder } = useVendor();
  const online = useOnlineStatus();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const entryRef = useRef<HTMLDivElement>(null);
  const boothId = boothState.status === "ready" ? boothState.booth.booth.id : null;

  // Staff can type straight away: the code field has focus whenever it is on screen.
  useEffect(() => {
    if (!outcome) entryRef.current?.querySelector("input")?.focus();
  }, [outcome]);

  const submit = async (value: string) => {
    if (!boothId || busy) return;
    if (!online) return setError("You are offline. Connect to hand over an order.");
    setBusy(true);
    setError(null);
    try {
      const result = await collectOrder(boothId, value);
      if (result.ok) {
        applyOrder(result.value);
        setOutcome({ kind: "collected", order: result.value });
      } else if (result.reason === "not_found") {
        setError("Code not found. Check it with the customer.");
      } else if (result.reason === "already_collected") {
        setOutcome({ kind: "already_collected", code: value, at: result.at });
      } else {
        setOutcome({ kind: result.reason, code: value });
      }
    } catch {
      setError(refusalLabels.network);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setOutcome(null);
    setCode("");
    setError(null);
  };

  if (outcome) return <PickupOutcome outcome={outcome} onAnother={reset} />;

  return (
    <>
      <VendorHeader title="Pickup" />
      <main className="vendor-screen vendor-pickup">
        <section className="vendor-section">
          <h1 className="headline-small">Enter pickup code</h1>
          <p className="body-large">Ask for the 4-digit code on the customer's order page.</p>
        </section>
        <div ref={entryRef}>
          <CodeEntry
            label="Pickup code"
            vendorSide
            value={code}
            error={error ?? undefined}
            onChange={(value) => {
              setCode(value);
              setError(null);
              if (value.length === 4) void submit(value);
            }}
          />
        </div>
        {busy && (
          <p className="body-medium" role="status">
            Checking the code...
          </p>
        )}
        {error === refusalLabels.network && code.length === 4 && (
          <Button variant="outlined" vendorSide onClick={() => submit(code)}>
            Try again
          </Button>
        )}
      </main>
    </>
  );
}

function PickupOutcome({ outcome, onAnother }: { outcome: Outcome; onAnother: () => void }) {
  const back = { label: "Back to pickup", onClick: onAnother };
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  if (outcome.kind === "collected") {
    const { order } = outcome;
    const labels = orderLabels(order);
    return (
      <>
        <VendorHeader title="Pickup" back={back} />
        <main className="vendor-screen vendor-detail">
          <section className="vendor-section vendor-section-top">
            <Badge tone={labels.statusBadge.tone}>{labels.statusBadge.label}</Badge>
            <h1 className="headline-medium" ref={headingRef} tabIndex={-1}>
              Collected
            </h1>
            <p className="body-large" role="status">
              Hand over the items.{order.collectedAt ? ` Marked collected at ${clockTime(order.collectedAt)}.` : ""}
            </p>
          </section>
          <dl className="vendor-facts">
            <div>
              <dt className="body-small">Pickup code</dt>
              <dd className="timer">{order.pickupCode}</dd>
            </div>
            {labels.vendorPayment && (
              <div>
                <dt className="body-small">Payment</dt>
                <dd className="body-large">{labels.vendorPayment}</dd>
              </div>
            )}
          </dl>
          <section className="vendor-section">
            <h2 className="title-medium">Items</h2>
            <div className="vendor-lines body-large">
              {order.items.map((item) => (
                <div key={item.productId}>
                  <span>
                    {item.quantity} × {item.name}
                  </span>
                  <span>{formatMoney(item.quantity * item.unitPriceCents, order.currency)}</span>
                </div>
              ))}
            </div>
            <div className="vendor-total title-medium">
              <span>Total</span>
              <span>{formatMoney(order.totalCents, order.currency)}</span>
            </div>
          </section>
          <div className="vendor-actions">
            <Button variant="vendor" onClick={onAnother}>
              Enter another code
            </Button>
          </div>
        </main>
      </>
    );
  }

  const copy = {
    already_collected: {
      badge: <Badge tone="neutral">Collected</Badge>,
      title: "Already collected",
      body: outcome.kind === "already_collected" && outcome.at ? `This order was collected at ${clockTime(outcome.at)}.` : "This order was already collected.",
    },
    cancelled: {
      badge: <Badge tone="error">Cancelled</Badge>,
      title: "Order cancelled",
      body: "This order was cancelled. Don't hand over the items.",
    },
    expired: {
      badge: <Badge tone="error">Expired</Badge>,
      title: "Order expired",
      body: "This order expired. Don't hand over the items.",
    },
  }[outcome.kind];

  return (
    <>
      <VendorHeader title="Pickup" back={back} />
      <main className="vendor-screen vendor-detail">
        <section className="vendor-section vendor-section-top">
          {copy.badge}
          <h1 className="headline-medium" ref={headingRef} tabIndex={-1}>
            {copy.title}
          </h1>
          <p className="body-large" role="status">
            {copy.body}
          </p>
        </section>
        <dl className="vendor-facts">
          <div>
            <dt className="body-small">Pickup code</dt>
            <dd className="timer">{outcome.code}</dd>
          </div>
        </dl>
        <div className="vendor-actions">
          <Button variant="vendor" onClick={onAnother}>
            Enter another code
          </Button>
        </div>
      </main>
    </>
  );
}
