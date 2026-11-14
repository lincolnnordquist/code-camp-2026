import type { ReactNode } from "react";

export type BadgeTone = "info" | "success" | "warning" | "error" | "neutral" | "outlined";

type BadgeProps = {
  tone: BadgeTone;
  children: ReactNode;
};

export function Badge({ tone, children }: BadgeProps) {
  return <span className={`ec-badge ec-badge-${tone}`}>{children}</span>;
}
