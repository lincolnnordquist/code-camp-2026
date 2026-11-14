import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../shared/ui";
import { useVendor } from "./vendorSession";

type VendorHeaderProps = {
  title: string;
  // A link back (the order detail) or a handler (the pickup result, which is not a route).
  back?: { label: string; to?: string; onClick?: () => void };
  // The screens with no heading of their own use the title as their h1.
  heading?: boolean;
};

export function VendorHeader({ title, back, heading = false }: VendorHeaderProps) {
  const { boothState } = useVendor();
  const booth = boothState.status === "ready" ? boothState.booth.booth : null;
  useEffect(() => {
    document.title = `${title} | Vendor`;
  }, [title]);

  const Title = heading ? "h1" : "p";
  return (
    <header className="vendor-header">
      {back &&
        (back.to ? (
          <Link className="vendor-back" to={back.to} aria-label={back.label}>
            <Icon name="arrow_back" />
          </Link>
        ) : (
          <button type="button" className="vendor-back" onClick={back.onClick} aria-label={back.label}>
            <Icon name="arrow_back" />
          </button>
        ))}
      <div className="vendor-header-text">
        <Title className="title-large vendor-header-title">{title}</Title>
        {booth && (
          <span className="body-small vendor-header-sub">
            {booth.vendorName} · Booth {booth.code}
          </span>
        )}
      </div>
    </header>
  );
}
