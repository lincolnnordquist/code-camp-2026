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

// A tab screen shows the booth's header: its banner, logo, name and booth code. A pushed screen
// shows Back and its title in the top app bar, which takes the frosted card tone once content
// scrolls under it. Before the booth has loaded, the bar shows the product name.
export function VendorHeader({ title, back }: VendorHeaderProps) {
  const { boothState } = useVendor();
  const scrolled = useScrolled();
  const booth = boothState.status === "ready" ? boothState.booth.booth : null;
  useEffect(() => {
    document.title = `${title} | Vendor`;
  }, [title]);

  if (!back && booth) {
    return (
      <header className="vendor-booth-header">
        {booth.bannerUrl && <img className="vendor-booth-header__banner" src={booth.bannerUrl} alt="" />}
        <div className="vendor-booth-header__row">
          <BoothLogo booth={booth} size="md" className="vendor-booth-header__logo" />
          <p className="vendor-booth-header__text">
            <span className="title-medium vendor-booth-header__name">{booth.vendorName}</span>
            <span className="label-medium">Vendor</span>
          </p>
          <p className="vendor-booth-header__plate">
            <span className="label-small">Booth </span>
            <span className="vendor-booth-header__code">{booth.code}</span>
          </p>
        </div>
      </header>
    );
  }

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
          <p className="vendor-bar__brand">
            <span className="vendor-wordmark">DibSpot</span>
            <span className="vendor-bar__kicker">Vendor</span>
          </p>
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
