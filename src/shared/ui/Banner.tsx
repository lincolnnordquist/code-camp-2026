import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type BannerTone = "error" | "warning" | "neutral" | "offline";

type BannerProps = {
  tone: BannerTone;
  icon: IconName;
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
};

export function Banner({ tone, icon, title, action, children }: BannerProps) {
  const multiLine = title !== undefined || action !== undefined;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`ec-banner ec-banner-${tone}${multiLine ? " ec-banner-multi" : ""}`}
    >
      <Icon name={icon} />
      {multiLine ? (
        <div>
          {title !== undefined && <div className="ec-banner-title">{title}</div>}
          <div>{children}</div>
          {action}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
