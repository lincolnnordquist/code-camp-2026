import type { ReactNode } from "react";
import "./components.css";

type PickupCodeCardProps = {
  label: string;
  code: string;
  // The time inside the footer takes the .timer class (the design system's Timer role).
  footer?: ReactNode;
};

export function PickupCodeCard({ label, code, footer }: PickupCodeCardProps) {
  return (
    <div className="ec-pickup-card">
      <div className="label-medium ec-pickup-card-label">{label}</div>
      <div className="code">{code}</div>
      {footer && <div className="body-medium ec-pickup-card-label">{footer}</div>}
    </div>
  );
}
