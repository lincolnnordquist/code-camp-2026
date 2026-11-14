import type { ReactNode } from "react";
import { Icon, type IconName } from "../../shared/ui";

type VendorStateProps = {
  icon: IconName;
  title: string;
  body?: ReactNode;
  // An error is announced; an empty list is not.
  alert?: boolean;
  tone?: "quiet" | "error";
  children?: ReactNode;
};

// One empty or error message, centred in the free space like the attendee wallet's empty state,
// so a screen with nothing to show is calm instead of a heading stranded at the top.
export function VendorState({ icon, title, body, alert = false, tone = "quiet", children }: VendorStateProps) {
  return (
    <div className={`vendor-state vendor-state--${tone}`} role={alert ? "alert" : undefined}>
      <span className="vendor-state__icon" aria-hidden="true">
        <Icon name={icon} size={28} />
      </span>
      <p className="vendor-state__title">{title}</p>
      {body && <p className="vendor-state__body">{body}</p>}
      {children}
    </div>
  );
}
