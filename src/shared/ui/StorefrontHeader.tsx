import type { BoothMode } from "../types";
import { Badge } from "./Badge";
import { boothModeBadges } from "./labels";
import "./components.css";

type StorefrontHeaderProps = {
  bannerUrl: string;
  logoUrl: string;
  vendorName: string;
  slogan: string;
  boothLabel: string;
  mode: BoothMode;
  mapHref: string;
};

export function StorefrontHeader({ bannerUrl, logoUrl, vendorName, slogan, boothLabel, mode, mapHref }: StorefrontHeaderProps) {
  const modeBadge = boothModeBadges[mode];
  return (
    <header className="ec-storefront-header">
      <img className="ec-storefront-banner" src={bannerUrl} alt="" />
      <div className="ec-storefront-body">
        <img className="ec-storefront-logo" src={logoUrl} alt="" />
        <div>
          <h1 className="headline-small ec-storefront-name">{vendorName}</h1>
          <div className="body-medium ec-storefront-slogan">{slogan}</div>
        </div>
        <div className="ec-storefront-line">
          <span className="body-medium">{boothLabel}</span>
          <Badge tone={modeBadge.tone}>{modeBadge.label}</Badge>
          <a className="ec-storefront-map" href={mapHref}>
            Map
          </a>
        </div>
      </div>
    </header>
  );
}
