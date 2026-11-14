import { useEffect, type MouseEvent } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useOnlineStatus } from "../../shared/live";
import { Banner, Button, NavigationBar, Snackbar } from "../../shared/ui";
import { SkeletonGroup, Skeleton } from "../../shell/Skeleton";
import { orderSummary } from "./queueModel";
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

export function VendorLayout() {
  const { pathname } = useLocation();
  const online = useOnlineStatus();
  const softLink = useSoftLinks();
  const { boothState, reloadBooth, arrival, dismissArrival } = useVendor();

  useEffect(() => {
    if (!arrival) return;
    const timer = setTimeout(dismissArrival, ARRIVAL_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [arrival, dismissArrival]);

  if (boothState.status === "signed_out") return <Navigate to="/vendor" replace />;

  const nav = [
    { label: "Orders", icon: "receipt_long", href: "/vendor/orders" },
    { label: "Pickup", icon: "qr_code_scanner", href: "/vendor/pickup" },
    { label: "Stock", icon: "inventory_2", href: "/vendor/stock" },
  ] as const;

  return (
    <div className="vendor-app" onClick={softLink}>
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
          <Skeleton width="50%" height={28} />
          <Skeleton height={96} shape="card" />
          <Skeleton height={96} shape="card" />
        </SkeletonGroup>
      )}
      {boothState.status === "error" && (
        <div className="vendor-screen vendor-state" role="alert">
          <p className="title-medium">Could not load your booth.</p>
          <p className="body-medium">Check your connection and try again.</p>
          <Button variant="vendor" onClick={reloadBooth}>
            Try again
          </Button>
        </div>
      )}
      {boothState.status === "ready" && <Outlet />}
      {arrival && (
        <div className="vendor-toast">
          <Snackbar>
            New order {arrival.pickupCode}: {orderSummary(arrival)}
          </Snackbar>
        </div>
      )}
      <NavigationBar
        label="Vendor"
        items={nav.map((item) => ({
          ...item,
          current: pathname === item.href || pathname.startsWith(`${item.href}/`),
        }))}
      />
    </div>
  );
}
