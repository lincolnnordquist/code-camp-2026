import type { ReactNode } from "react";
import "./components.css";

export function Snackbar({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="body-medium ec-snackbar">
      {children}
    </div>
  );
}
