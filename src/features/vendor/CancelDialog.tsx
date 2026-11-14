import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
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

const FOCUSABLE = 'button, [href], input, [tabindex]:not([tabindex="-1"])';

// FR-23: staff cancel with a reason the attendee sees. The dialog states what does not happen
// for them: stock is not returned, and a paid order will be owed a refund. It is the attendee
// cancel sheet (order.css .cancel-sheet) with a reason field: a bottom sheet over a scrim.
export function CancelDialog({ order, busy, online, error, onConfirm, onKeep }: CancelDialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);

  // The page behind is inert and still while the sheet is open, and focus starts on the reason field.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const others = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== root && !el.hasAttribute("inert"),
    );
    others.forEach((el) => el.setAttribute("inert", ""));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root?.querySelector("input")?.focus();
    return () => {
      others.forEach((el) => el.removeAttribute("inert"));
      document.body.style.overflow = overflow;
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onKeep();
      return;
    }
    if (event.key !== "Tab") return;
    // Focus stays in the sheet, wrapping at the ends.
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => !el.hasAttribute("disabled"));
    if (items.length === 0) return;
    const at = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
    const wrap = event.shiftKey ? at <= 0 : at === items.length - 1;
    if (!wrap) return;
    event.preventDefault();
    items[event.shiftKey ? items.length - 1 : 0].focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !online) return;
    if (reason.trim() === "") {
      // The field says what is missing, so the person is taken there to type it.
      setMissing(true);
      rootRef.current?.querySelector("input")?.focus();
      return;
    }
    onConfirm(reason.trim());
  };

  return createPortal(
    <div className="vendor-sheet" ref={rootRef} onKeyDown={onKeyDown}>
      <div className="vendor-sheet__scrim" aria-hidden="true" onClick={onKeep} />
      <form className="vendor-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="cancel-title" onSubmit={submit}>
        <div className="vendor-sheet__handle" aria-hidden="true" />
        <div className="vendor-sheet__text">
          <h2 id="cancel-title">Cancel order {order.pickupCode}?</h2>
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
        {!online && <p className="vendor-sheet__offline">You are offline. Connect to cancel.</p>}
        <div className="vendor-sheet__buttons">
          {busy ? (
            <Button variant="destructive" className="vendor-danger" loadingLabel="Cancelling order" />
          ) : (
            <Button type="submit" variant="destructive" className="vendor-danger" disabled={!online}>
              Cancel order
            </Button>
          )}
          <Button type="button" variant="outlined" vendorSide onClick={onKeep}>
            Keep order
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
