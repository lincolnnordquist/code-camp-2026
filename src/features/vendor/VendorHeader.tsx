import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../shared/ui";
import { BoothLogo } from "../../shared/ui/BoothLogo";
import { useVendor } from "./vendorSession";

type VendorHeaderProps = {
  title: string;
  // A link back (the order detail) or a handler (the pickup result, which is not a route).
  back?: { label: string; to?: string; onClick?: () => void };
};

// True once the page has scrolled under the bar, so the bar can take the frosted card tone.
function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return scrolled;
}

// The vendor top app bar, after the attendee shell's: page tone at rest, frosted card once content
// scrolls under it. A tab screen shows the product and the booth it runs; a pushed screen shows
// Back and its title, as the attendee order page does.
export function VendorHeader({ title, back }: VendorHeaderProps) {
  const { boothState } = useVendor();
  const scrolled = useScrolled();
  const booth = boothState.status === "ready" ? boothState.booth.booth : null;
  useEffect(() => {
    document.title = `${title} | Vendor`;
  }, [title]);

  return (
    <header className={`vendor-bar${scrolled ? " is-scrolled" : ""}`}>
      <div className="vendor-bar__inner">
        {back ? (
          <>
            {back.to ? (
              <Link className="vendor-bar__back" to={back.to} aria-label={back.label}>
                <Icon name="arrow_back" />
              </Link>
            ) : (
              <button type="button" className="vendor-bar__back" onClick={back.onClick} aria-label={back.label}>
                <Icon name="arrow_back" />
              </button>
            )}
            <p className="vendor-bar__title">{title}</p>
          </>
        ) : (
          <>
            <p className="vendor-bar__brand">
              <span className="vendor-wordmark">DibSpot</span>
              <span className="vendor-bar__kicker">Vendor</span>
            </p>
            {booth && (
              <p className="vendor-bar__booth">
                <BoothLogo booth={booth} size="sm" />
                <span className="vendor-bar__booth-name">{booth.vendorName}</span>
                <span className="vendor-bar__booth-code">Booth {booth.code}</span>
              </p>
            )}
          </>
        )}
      </div>
    </header>
  );
}

// A tab screen's large title, as on the attendee tab roots, with an optional line under it.
export function VendorTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="vendor-title">
      <h1>{title}</h1>
      {children && <p className="vendor-title__sub">{children}</p>}
    </div>
  );
}
