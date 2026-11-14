import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";
import "./components.css";

export type ButtonVariant = "filled" | "tonal" | "outlined" | "text" | "destructive" | "vendor";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "medium" | "small";
  icon?: ReactNode;
  // Outlined buttons on the vendor side use a neutral label and Atkinson.
  vendorSide?: boolean;
  // A loading button shows only the spinner, so the label moves to aria-label.
  loadingLabel?: string;
  soldOut?: boolean;
};

export function Button({
  variant = "filled",
  size = "medium",
  icon,
  vendorSide = false,
  loadingLabel,
  soldOut = false,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const loading = loadingLabel !== undefined;
  const classes = [
    "ec-btn",
    size === "medium" ? "ec-btn-md" : "ec-btn-sm",
    `ec-btn-${variant}`,
    vendorSide && variant === "outlined" ? "is-vendor" : "",
    soldOut ? "ec-btn-soldout" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  if (loading) {
    // onClick is dropped so a second tap cannot send the request again.
    return (
      <button {...rest} onClick={undefined} type={type} className={classes} aria-busy="true" aria-label={loadingLabel}>
        <Icon name="progress" className="ec-spin" />
      </button>
    );
  }

  return (
    <button {...rest} type={type} className={classes} disabled={soldOut || rest.disabled}>
      {icon}
      {children}
    </button>
  );
}
