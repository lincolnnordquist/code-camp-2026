import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { setOrderingPaused, setProductStock, signOut } from "../../shared/api";
import { useOnlineStatus } from "../../shared/live";
import type { Product, VendorBooth } from "../../shared/types";
import { Badge, Banner, Button, formatMoney, TextField } from "../../shared/ui";
import { refusalLabels } from "../../shared/ui/labels";
import { VendorHeader } from "./VendorHeader";
import { clearVendorCache } from "./vendorCache";
import { useVendor } from "./vendorSession";

// FR-24 and FR-25. The design has a Stock tab but no screen for it, so this one is built
// from the design system's parts and the spec's words.
export function Stock() {
  const { boothState, applyBooth, reloadBooth } = useVendor();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  if (boothState.status !== "ready") return null;
  const { booth, products, event } = boothState.booth;
  const data: VendorBooth = boothState.booth;

  const togglePause = async () => {
    setPausing(true);
    setProblem(null);
    try {
      const result = await setOrderingPaused(booth.id, !booth.orderingPaused);
      if (result.ok) applyBooth({ ...data, booth: { ...booth, orderingPaused: result.value.paused } });
      else setProblem("We could not find your booth.");
    } catch {
      setProblem(refusalLabels.network);
    } finally {
      setPausing(false);
    }
  };

  const savedStock = (productId: string, availableQty: number) =>
    applyBooth({
      ...data,
      products: products.map((p) => (p.id === productId ? { ...p, availableQty } : p)),
    });

  const leave = async () => {
    try {
      await signOut();
      clearVendorCache();
      reloadBooth();
      navigate("/vendor", { replace: true });
    } catch {
      setProblem(refusalLabels.network);
    }
  };

  return (
    <>
      <VendorHeader title="Stock" heading />
      <main className="vendor-screen">
        <section className="vendor-card" aria-labelledby="pause-title">
          <div className="vendor-card-head">
            <h2 id="pause-title" className="title-medium">
              Online orders
            </h2>
            {booth.orderingPaused ? <Badge tone="warning">Paused</Badge> : <Badge tone="success">Open</Badge>}
          </div>
          <p className="body-medium">
            {booth.orderingPaused
              ? "Customers cannot place new orders. Orders already placed continue."
              : "Pause to stop new orders. Orders already placed continue."}
          </p>
          {pausing ? (
            <Button size="small" variant="vendor" loadingLabel="Updating" />
          ) : (
            <Button size="small" variant="vendor" disabled={!online} onClick={togglePause}>
              {booth.orderingPaused ? "Resume orders" : "Pause orders"}
            </Button>
          )}
        </section>

        {problem && (
          <Banner tone="error" icon="error">
            {problem}
          </Banner>
        )}
        {!online && <p className="body-small">You are offline. Connect to change stock.</p>}

        <section className="vendor-section">
          <h2 className="title-medium">Products</h2>
          <p className="body-small">
            The quantity open to new orders. Stock held by existing orders is not changed.
          </p>
          {products.length === 0 ? (
            <div className="vendor-state">
              <p className="title-medium">No products yet</p>
              <p className="body-medium">Products for {event.name} show up here.</p>
            </div>
          ) : (
            <ul className="vendor-products">
              {products.map((product) => (
                <ProductStock key={product.id} product={product} currency={event.currency} online={online} onSaved={savedStock} />
              ))}
            </ul>
          )}
        </section>

        <Button variant="outlined" vendorSide onClick={leave}>
          Sign out
        </Button>
      </main>
    </>
  );
}

function ProductStock({
  product,
  currency,
  online,
  onSaved,
}: {
  product: Product;
  currency: string;
  online: boolean;
  onSaved: (productId: string, availableQty: number) => void;
}) {
  const [draft, setDraft] = useState(String(product.availableQty));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const quantity = /^\d+$/.test(draft.trim()) ? Number(draft) : null;
  const changed = quantity !== null && quantity !== product.availableQty;

  const save = async () => {
    if (quantity === null) return setError("Enter a whole number, 0 or more.");
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await setProductStock(product.id, quantity);
      if (result.ok) {
        onSaved(product.id, result.value.availableQty);
        setSaved(true);
      } else setError(result.reason === "invalid_quantity" ? "Enter a whole number, 0 or more." : "This product is no longer yours to change.");
    } catch {
      setError(refusalLabels.network);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="vendor-card vendor-product">
      <div className="vendor-card-head">
        <span className="title-medium">{product.name}</span>
        <span className="body-medium">{formatMoney(product.priceCents, currency)}</span>
      </div>
      <div className="vendor-stock-row">
        <TextField
          label="Available"
          inputMode="numeric"
          value={draft}
          error={error ?? undefined}
          supportingText={saved ? "Saved" : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
            setError(null);
          }}
        />
        {busy ? (
          <Button size="small" variant="vendor" loadingLabel={`Saving ${product.name}`} />
        ) : (
          <Button size="small" variant="vendor" disabled={!online || !changed} aria-label={`Save stock for ${product.name}`} onClick={save}>
            Save
          </Button>
        )}
      </div>
    </li>
  );
}
