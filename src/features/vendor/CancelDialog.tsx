import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Banner, Button, formatMoney, TextField } from "../../shared/ui";
import type { Order } from "../../shared/types";

type CancelDialogProps = {
  order: Order;
  busy: boolean;
  online: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  onKeep: () => void;
};

// FR-23: staff cancel with a reason the attendee sees. The dialog states what does not happen
// for them: stock is not returned, and a paid order will be owed a refund.
export function CancelDialog({ order, busy, online, error, onConfirm, onKeep }: CancelDialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);

  // The page behind is inert while the dialog is open, and focus starts on the reason field.
  useEffect(() => {
    const root = rootRef.current;
    const others = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== root && !el.hasAttribute("inert"),
    );
    others.forEach((el) => el.setAttribute("inert", ""));
    root?.querySelector("input")?.focus();
    return () => others.forEach((el) => el.removeAttribute("inert"));
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onKeep();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !online) return;
    if (reason.trim() === "") return setMissing(true);
    onConfirm(reason.trim());
  };

  return createPortal(
    <div className="vendor-dialog-root" ref={rootRef} onKeyDown={onKeyDown}>
      <div className="vendor-scrim" aria-hidden="true" onClick={onKeep} />
      <form className="vendor-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-title" onSubmit={submit}>
        <h2 id="cancel-title" className="headline-small">
          Cancel order {order.pickupCode}?
        </h2>
        <div className="body-medium vendor-dialog-text">
          <p>Stock is not returned automatically. Add the items back on the Stock page.</p>
          {order.type === "prepaid" && (
            <p>This order is paid, so a refund of {formatMoney(order.totalCents, order.currency)} will be due.</p>
          )}
        </div>
        <TextField
          label="Reason"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setMissing(false);
          }}
          supportingText="The customer sees this reason."
          error={missing ? "Enter a reason. The customer sees it." : undefined}
        />
        {error && (
          <Banner tone="error" icon="error">
            {error}
          </Banner>
        )}
        {!online && <p className="body-small">You are offline. Connect to cancel.</p>}
        <div className="vendor-dialog-actions">
          <Button type="button" size="small" variant="text" vendorSide onClick={onKeep}>
            Keep order
          </Button>
          {busy ? (
            <Button size="small" variant="destructive" loadingLabel="Cancelling order" />
          ) : (
            <Button type="submit" size="small" variant="destructive" disabled={!online}>
              Cancel order
            </Button>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}
