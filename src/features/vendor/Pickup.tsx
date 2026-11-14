import { useEffect, useRef, useState } from "react";
import { collectOrder } from "../../shared/api";
import { useOnlineStatus } from "../../shared/live";
import type { Order } from "../../shared/types";
import { Button, CodeEntry, Icon, orderLabels, type IconName } from "../../shared/ui";
import { refusalLabels } from "../../shared/ui/labels";
import { OrderItems } from "./OrderItems";
import { QrScanner } from "./QrScanner";
import type { ScanHold } from "./scanHold";
import { VendorHeader, VendorTitle } from "./VendorHeader";
import { clockTime } from "./queueModel";
import { useVendor } from "./vendorSession";

// What the last code led to. A refusal for an order that exists carries that order, so its
// screen can show the items and the reason.
type Outcome =
  | { kind: "collected"; order: Order }
  | { kind: "already_collected" | "cancelled" | "expired"; code: string; order?: Order; at?: string };

export function Pickup() {
  const { boothState, applyOrder } = useVendor();
  const online = useOnlineStatus();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const entryRef = useRef<HTMLDivElement>(null);
  const [scanning, setScanning] = useState(false);
  const scanHold = useRef<ScanHold>(null);
  // Where focus goes once the closed scanner has left the page live again (it was inert): the scan
  // button after a cancel, the code after a scan, where a refusal shows. A result screen takes its
  // own heading.
  const focusAfterScan = useRef<"scan" | "code" | null>(null);
  useEffect(() => {
    const target = focusAfterScan.current;
    if (scanning || !target) return;
    focusAfterScan.current = null;
    if (target === "scan") document.getElementById("pickup-scan")?.focus();
    else entryRef.current?.querySelector("input")?.focus();
  }, [scanning]);
  const boothId = boothState.status === "ready" ? boothState.booth.booth.id : null;

  // Staff can type straight away: the code field has focus whenever it is on screen.
  useEffect(() => {
    if (!outcome) entryRef.current?.querySelector("input")?.focus();
  }, [outcome]);

  // FR-30: a scanned code fills the boxes and runs the same lookup as a typed one.
  const scanned = (value: string) => {
    setScanning(false);
    setCode(value);
    setError(null);
    focusAfterScan.current = "code";
    void submit(value);
  };

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
        setOutcome({ kind: "already_collected", code: value, at: result.at, order: result.order });
      } else {
        setOutcome({ kind: result.reason, code: value, order: result.order });
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
        <VendorTitle title="Pickup">Ask for the 4-digit code on the customer's order page.</VendorTitle>
        <section className="vendor-code-card" aria-labelledby="pickup-entry-title">
          <Button
            id="pickup-scan"
            className="vendor-code-card__scan"
            icon={<Icon name="qr_code_scanner" />}
            disabled={busy}
            onClick={() => setScanning(true)}
          >
            Scan QR code
          </Button>
          <p className="vendor-code-card__or" aria-hidden="true">
            or
          </p>
          <h2 id="pickup-entry-title" className="vendor-code-card__title">
            Enter pickup code
          </h2>
          <div ref={entryRef} className="vendor-code-entry">
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
            <p className="vendor-code-card__status" role="status">
              <Icon name="progress" size={20} className="ec-spin" />
              Checking the code...
            </p>
          )}
          {error === refusalLabels.network && code.length === 4 && (
            <Button variant="outlined" vendorSide onClick={() => submit(code)}>
              Try again
            </Button>
          )}
        </section>
      </main>
      {scanning && (
        <QrScanner
          holdRef={scanHold}
          onCode={scanned}
          onClose={() => {
            focusAfterScan.current = "scan";
            setScanning(false);
          }}
        />
      )}
    </>
  );
}

const OUTCOME_ICON: Record<Outcome["kind"], { icon: IconName; tone: "success" | "neutral" | "error" }> = {
  collected: { icon: "check_circle", tone: "success" },
  already_collected: { icon: "info", tone: "neutral" },
  cancelled: { icon: "error", tone: "error" },
  expired: { icon: "error", tone: "error" },
};

function PickupOutcome({ outcome, onAnother }: { outcome: Outcome; onAnother: () => void }) {
  const { boothState } = useVendor();
  const products = boothState.status === "ready" ? boothState.booth.products : [];
  const back = { label: "Back to pickup", onClick: onAnother };
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const mark = OUTCOME_ICON[outcome.kind];

  if (outcome.kind === "collected") {
    const { order } = outcome;
    const labels = orderLabels(order);
    return (
      <>
        <VendorHeader title="Pickup" back={back} />
        <main className="vendor-screen vendor-detail">
          <section className={`vendor-pass vendor-outcome vendor-outcome--${mark.tone}`}>
            <span className="vendor-outcome__icon" aria-hidden="true">
              <Icon name={mark.icon} size={32} />
            </span>
            <h1 className="vendor-outcome__title" ref={headingRef} tabIndex={-1}>
              Collected
            </h1>
            <p className="vendor-outcome__body" role="status">
              Hand over the items.{order.collectedAt ? ` Marked collected at ${clockTime(order.collectedAt)}.` : ""}
            </p>
            <Button className="vendor-outcome__next" onClick={onAnother}>
              Enter another code
            </Button>
          </section>
          <dl className="vendor-facts">
            <div>
              <dt>Pickup code</dt>
              <dd className="vendor-facts__code">{order.pickupCode}</dd>
            </div>
            {labels.vendorPayment && (
              <div>
                <dt>Payment</dt>
                <dd>{labels.vendorPayment}</dd>
              </div>
            )}
          </dl>
          <OrderItems order={order} products={products} />
        </main>
      </>
    );
  }

  const copy = {
    already_collected: {
      title: "Already collected",
      body: outcome.kind === "already_collected" && outcome.at ? `This order was collected at ${clockTime(outcome.at)}.` : "This order was already collected.",
    },
    cancelled: {
      title: "Order cancelled",
      body: "This order was cancelled. Don't hand over the items.",
    },
    expired: {
      title: "Order expired",
      body: "This order expired. Don't hand over the items.",
    },
  }[outcome.kind];

  return (
    <>
      <VendorHeader title="Pickup" back={back} />
      <main className="vendor-screen vendor-detail">
        <section className={`vendor-pass vendor-outcome vendor-outcome--${mark.tone}`}>
          <span className="vendor-outcome__icon" aria-hidden="true">
            <Icon name={mark.icon} size={32} />
          </span>
          <h1 className="vendor-outcome__title" ref={headingRef} tabIndex={-1}>
            {copy.title}
          </h1>
          <p className="vendor-outcome__body" role="status">
            {copy.body}
          </p>
          <Button className="vendor-outcome__next" onClick={onAnother}>
            Enter another code
          </Button>
        </section>
        <dl className="vendor-facts">
          <div>
            <dt>Pickup code</dt>
            <dd className="vendor-facts__code">{outcome.code}</dd>
          </div>
          {outcome.kind === "cancelled" && outcome.order?.cancelReason && (
            <div>
              <dt>Reason</dt>
              <dd>{outcome.order.cancelReason}</dd>
            </div>
          )}
        </dl>
        {outcome.order && <OrderItems order={outcome.order} products={products} />}
      </main>
    </>
  );
}
