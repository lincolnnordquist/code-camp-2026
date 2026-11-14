import { useEffect, type MouseEvent } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useOnlineStatus } from "../../shared/live";
import { Banner, Button, Icon, Snackbar, type IconName } from "../../shared/ui";
import { SkeletonGroup, Skeleton } from "../../shell/Skeleton";
import { VendorHeader } from "./VendorHeader";
import { VendorState } from "./VendorState";
import { inTab, orderSummary } from "./queueModel";
import { useVendor } from "./vendorSession";

const ARRIVAL_SHOWN_MS = 6_000;

// Links inside the vendor area move within the app instead of reloading it, which would
// read the session and the booth again on every tap. The shared rows and the navigation
// bar render plain links, so one handler here covers them all.
export function useSoftLinks() {
  const navigate = useNavigate();
  return (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest("a");
    const href = link?.getAttribute("href");
    if (!link || !href || !href.startsWith("/vendor") || link.target === "_blank") return;
    event.preventDefault();
    navigate(href);
  };
}

const NAV: { label: string; icon: IconName; href: string }[] = [
  { label: "Orders", icon: "receipt_long", href: "/vendor/orders" },
  { label: "Pickup", icon: "qr_code_scanner", href: "/vendor/pickup" },
  { label: "Stock", icon: "inventory_2", href: "/vendor/stock" },
];

export function VendorLayout() {
  const { pathname } = useLocation();
  const online = useOnlineStatus();
  const softLink = useSoftLinks();
  const { boothState, reloadBooth, ordersState, arrival, dismissArrival } = useVendor();

  useEffect(() => {
    if (!arrival) return;
    const timer = setTimeout(dismissArrival, ARRIVAL_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [arrival, dismissArrival]);

  if (boothState.status === "signed_out") return <Navigate to="/vendor" replace />;

  // The Orders destination carries the count still to prepare, as the attendee Orders tab carries open orders.
  const toPrepare = ordersState.status === "ready" ? ordersState.orders.filter((o) => inTab(o, "confirmed")).length : 0;

  return (
    <div className="vendor-app" onClick={softLink}>
      {boothState.status !== "ready" && <VendorHeader title="Vendor" />}
      {/* Always mounted, so the message is announced when it appears. */}
      <div className="vendor-offline">
        {!online && (
          <Banner tone="offline" icon="wifi_off">
            You are offline. Orders on screen may be out of date. Changes are paused.
          </Banner>
        )}
      </div>
      {boothState.status === "loading" && (
        <SkeletonGroup label="Loading your booth..." className="vendor-screen">
          <Skeleton width="40%" height={36} />
          <Skeleton height={52} shape="pill" />
          <Skeleton height={148} shape="card" />
          <Skeleton height={148} shape="card" />
        </SkeletonGroup>
      )}
      {boothState.status === "error" && (
        <main className="vendor-screen">
          <VendorState icon="wifi_off" tone="error" alert title="Could not load your booth." body="Check your connection and try again.">
            <Button onClick={reloadBooth}>Try again</Button>
          </VendorState>
        </main>
      )}
      {boothState.status === "ready" && <Outlet />}
      <div className="bottom-bars vendor-bottom">
        {arrival && (
          <div className="vendor-toast">
            <Snackbar>
              New order {arrival.pickupCode}: {orderSummary(arrival)}
            </Snackbar>
          </div>
        )}
        {/* The attendee app's navigation bar (index.css .tab-bar), with the vendor's three destinations. */}
        <nav className="tab-bar vendor-tab-bar" aria-label="Vendor">
          <ul className="tab-bar__list" role="list">
            {NAV.map((item) => {
              const selected = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    className={`tab-bar__link${selected ? " is-active" : ""}`}
                    to={item.href}
                    aria-current={pathname === item.href ? "page" : undefined}
                  >
                    <Icon name={item.icon} filled={selected} />
                    <span className="tab-bar__label">
                      <span className="tab-bar__label-text">{item.label}</span>
                      {item.href === "/vendor/orders" && toPrepare > 0 && (
                        <span className="tab-bar__badge">
                          <span aria-hidden="true">{toPrepare}</span>
                          <span className="visually-hidden">, {toPrepare} confirmed</span>
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
