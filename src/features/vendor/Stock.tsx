import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setOrderingPaused, setProductStock, signOut } from "../../shared/api";
import { useOnlineStatus } from "../../shared/live";
import type { Product, VendorBooth } from "../../shared/types";
import { Badge, Banner, Button, formatMoney, Icon } from "../../shared/ui";
import { ProductImage } from "../../shared/ui/ProductImage";
import { refusalLabels } from "../../shared/ui/labels";
import { VendorHeader, VendorTitle } from "./VendorHeader";
import { VendorState } from "./VendorState";
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
      reloadBooth();
      navigate("/vendor", { replace: true });
    } catch {
      setProblem(refusalLabels.network);
    }
  };

  return (
    <>
      <VendorHeader title="Stock" />
      <main className="vendor-screen vendor-stock">
        <VendorTitle title="Stock" />
        <section className="vendor-card" aria-labelledby="pause-title">
          <div className="vendor-card-head">
            <h2 id="pause-title">Online orders</h2>
            {booth.orderingPaused ? <Badge tone="warning">Paused</Badge> : <Badge tone="success">Open</Badge>}
          </div>
          <p className="vendor-card__text">
            {booth.orderingPaused
              ? "Customers cannot place new orders. Orders already placed continue."
              : "Pause to stop new orders. Orders already placed continue."}
          </p>
          {pausing ? (
            <Button variant={booth.orderingPaused ? "filled" : "outlined"} vendorSide loadingLabel="Updating" />
          ) : (
            <Button variant={booth.orderingPaused ? "filled" : "outlined"} vendorSide disabled={!online} onClick={togglePause}>
              {booth.orderingPaused ? "Resume orders" : "Pause orders"}
            </Button>
          )}
        </section>

        {problem && (
          <Banner tone="error" icon="error">
            {problem}
          </Banner>
        )}
        {!online && <p className="vendor-note">You are offline. Connect to change stock.</p>}

        <section className="vendor-section" aria-labelledby="products-title">
          <div className="vendor-section__head">
            <h2 id="products-title">Products</h2>
            <p>The quantity open to new orders. Stock held by existing orders is not changed.</p>
          </div>
          {products.length === 0 ? (
            <VendorState icon="inventory_2" title="No products yet" body={`Products for ${event.name} show up here.`} />
          ) : (
            <ul className="vendor-products" role="list">
              {products.map((product) => (
                <ProductStock key={product.id} product={product} currency={event.currency} online={online} onSaved={savedStock} />
              ))}
            </ul>
          )}
        </section>

        <div className="vendor-signout">
          <Button variant="outlined" vendorSide onClick={leave}>
            Sign out
          </Button>
        </div>
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

  const inputId = useId();
  const supportId = `${inputId}-support`;
  const support = error ?? (saved ? "Saved" : null);
  const step = (by: number) => {
    const base = quantity ?? product.availableQty;
    setDraft(String(Math.max(0, base + by)));
    setSaved(false);
    setError(null);
  };

  return (
    <li className="vendor-product">
      <div className="vendor-product__head">
        <span className="vendor-product__photo">
          <ProductImage product={product} size="small" />
        </span>
        <span className="vendor-product__name">{product.name}</span>
        <span className="vendor-product__price">{formatMoney(product.priceCents, currency)}</span>
        {product.availableQty === 0 && <Badge tone="error">Sold out</Badge>}
      </div>
      <div className="vendor-product__edit">
        {/* A stepper around the quantity, as in the cart, so a few more is two taps; typing still works. */}
        <div className={`vendor-stepper${error ? " is-error" : ""}`}>
          <button
            type="button"
            className="vendor-stepper__button"
            aria-label={`One fewer ${product.name}`}
            disabled={(quantity ?? product.availableQty) <= 0}
            onClick={() => step(-1)}
          >
            <Icon name="remove" />
          </button>
          <label className="visually-hidden" htmlFor={inputId}>
            Available
          </label>
          <input
            id={inputId}
            className="vendor-stepper__input"
            inputMode="numeric"
            value={draft}
            aria-invalid={error ? true : undefined}
            aria-describedby={support ? supportId : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              setSaved(false);
              setError(null);
            }}
          />
          <button type="button" className="vendor-stepper__button" aria-label={`One more ${product.name}`} onClick={() => step(1)}>
            <Icon name="add" />
          </button>
        </div>
        {busy ? (
          <Button size="small" loadingLabel={`Saving ${product.name}`} />
        ) : (
          <Button size="small" disabled={!online || !changed} aria-label={`Save stock for ${product.name}`} onClick={save}>
            Save
          </Button>
        )}
      </div>
      {support && (
        <p id={supportId} className={`vendor-product__support${error ? " is-error" : " is-saved"}`}>
          {!error && <Icon name="check" size={18} />}
          {support}
        </p>
      )}
    </li>
  );
}
