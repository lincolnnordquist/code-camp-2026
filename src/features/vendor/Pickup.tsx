import { useEffect, useRef, useState } from "react";
import { collectOrder } from "../../shared/api";
import { useOnlineStatus } from "../../shared/live";
import type { Order } from "../../shared/types";
import { Button, CodeEntry, Icon, orderLabels, type IconName } from "../../shared/ui";
import { refusalLabels } from "../../shared/ui/labels";
import { PassItems } from "./OrderItems";
import { BoothAside, PassCode, VendorPass } from "./VendorPass";
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
        <VendorTitle title="Pickup">Scan the customer's pass, or enter their code.</VendorTitle>
        <Button id="pickup-scan" className="vendor-scan" icon={<Icon name="qr_code_scanner" />} disabled={busy} onClick={() => setScanning(true)}>
          Scan QR code
        </Button>
        <p className="body-small vendor-or" aria-hidden="true">
          or
        </p>
        <section className="vendor-code-card">
          <p className="label-medium vendor-code-card__title" aria-hidden="true">
            Pickup code
          </p>
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

const OUTCOME: Record<Outcome["kind"], { icon: IconName; tone: "success" | "neutral" | "error"; pass: string }> = {
  collected: { icon: "check_circle", tone: "success", pass: "Collected" },
  already_collected: { icon: "info", tone: "neutral", pass: "Collected" },
  cancelled: { icon: "error", tone: "error", pass: "Cancelled" },
  expired: { icon: "error", tone: "error", pass: "Expired" },
};

function PickupOutcome({ outcome, onAnother }: { outcome: Outcome; onAnother: () => void }) {
  const { boothState } = useVendor();
  const boothCode = boothState.status === "ready" ? boothState.booth.booth.code : "";
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const mark = OUTCOME[outcome.kind];
  const order = outcome.order;

  let title: string;
  let body: string;
  if (outcome.kind === "collected") {
    // FR-22: for a reservation this states that payment was taken at the booth.
    const payment = orderLabels(outcome.order).vendorPayment;
    title = "Collected";
    body = payment ? `Hand over the items. ${payment}.` : "Hand over the items.";
  } else if (outcome.kind === "already_collected") {
    title = "Already collected";
    body = outcome.at ? `This order was collected at ${clockTime(outcome.at)}.` : "This order was already collected.";
  } else if (outcome.kind === "cancelled") {
    title = "Order cancelled";
    body = "This order was cancelled. Items stay at the booth.";
  } else {
    title = "Order expired";
    body = "This order expired. Items stay at the booth.";
  }
  const code = outcome.kind === "collected" ? outcome.order.pickupCode : outcome.code;
  const reason = outcome.kind === "cancelled" ? order?.cancelReason : null;

  return (
    <>
      <VendorHeader title="Pickup" />
      <main className="vendor-screen vendor-result">
        <div className={`vendor-result__head vendor-result__head--${mark.tone}`}>
          <Icon name={mark.icon} size={32} filled className="vendor-result__icon" />
          <div className="vendor-result__text">
            <h1 className="headline-medium" ref={headingRef} tabIndex={-1}>
              {title}
            </h1>
            <p className="body-medium" role="status">
              {body}
            </p>
          </div>
        </div>
        <VendorPass
          tone={outcome.kind === "collected" ? "violet" : "grey"}
          title={mark.pass}
          aside={<BoothAside code={boothCode} />}
          step={outcome.kind === "collected" ? 4 : null}
          titleAs="p"
        >
          <PassCode code={code} />
          {reason && (
            <div className="vendor-pass__reason">
              <span className="label-medium">Reason</span>
              <span className="body-medium">{reason}</span>
            </div>
          )}
          {order && <PassItems order={order} />}
        </VendorPass>
        <Button className="vendor-result__next" onClick={onAnother}>
          Enter another code
        </Button>
      </main>
    </>
  );
}
