import type { ReactNode } from "react";
import { Icon } from "./Icon";
import "./components.css";

type AttendeeOrderRowProps = {
  href: string;
  vendorName: string;
  // Booth code and order time, for example "Booth A12 · Sat 2:14 PM".
  detail: string;
  logoUrl?: string;
  statusBadge: ReactNode;
};

export function AttendeeOrderRow({ href, vendorName, detail, logoUrl, statusBadge }: AttendeeOrderRowProps) {
  return (
    <a className="ec-card ec-attendee-row" href={href}>
      {logoUrl ? (
        <img className="ec-attendee-row-logo" src={logoUrl} alt="" />
      ) : (
        <div className="ec-attendee-row-logo" />
      )}
      <div className="ec-attendee-row-text">
        <div className="title-medium">{vendorName}</div>
        <div className="body-medium ec-attendee-row-detail">{detail}</div>
      </div>
      {statusBadge}
    </a>
  );
}

type VendorOrderRowProps = {
  href: string;
  pickupCode: string;
  time: string;
  itemCount: string;
  total: string;
  badges: ReactNode;
  action: ReactNode;
};

export function VendorOrderRow({ href, pickupCode, time, itemCount, total, badges, action }: VendorOrderRowProps) {
  return (
    <article className="ec-card ec-vendor-row">
      {/* The link stretches over the whole card; the action button sits above it. */}
      <a className="ec-vendor-row-line ec-vendor-row-open" href={href}>
        <span className="timer">{pickupCode}</span>
        <span className="body-medium ec-vendor-row-time">
          {time}
          <Icon name="chevron_right" />
        </span>
      </a>
      <div className="ec-vendor-row-line body-medium">
        <span>{itemCount}</span>
        <span>{total}</span>
      </div>
      <div className="ec-vendor-row-badges">{badges}</div>
      {action}
    </article>
  );
}
