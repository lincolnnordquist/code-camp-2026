import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setOrderingPaused, setProductStock, signOut } from "../../shared/api";
import { useOnlineStatus } from "../../shared/live";
import type { Product, VendorBooth } from "../../shared/types";
import { Banner, Button, formatMoney, Icon } from "../../shared/ui";
import { ProductImage } from "../../shared/ui/ProductImage";
import { refusalLabels } from "../../shared/ui/labels";
import { VendorHeader, VendorTitle } from "./VendorHeader";
import { VendorState } from "./VendorState";
import { clearVendorCache } from "./vendorCache";
import { useVendor } from "./vendorSession";

// FR-24 and FR-25.
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
      <VendorHeader title="Stock" />
      <main className="vendor-screen vendor-stock">
        <VendorTitle title="Stock" />
        <section className="vendor-card vendor-online" aria-labelledby="pause-title">
          <h2 id="pause-title" className="visually-hidden">
            Online orders
          </h2>
          <p className={`title-medium vendor-online__status${booth.orderingPaused ? " is-paused" : ""}`}>
            <Icon name={booth.orderingPaused ? "pause_circle" : "check_circle"} filled />
            {booth.orderingPaused ? "Online orders are paused" : "Online orders are open"}
          </p>
          <p className="body-medium vendor-card__text">
            {booth.orderingPaused ? "Placed orders still go through." : "Pausing won't affect placed orders."}
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
            <h2 id="products-title" className="title-large">
              Products
            </h2>
            <p>Items in placed orders are already set aside.</p>
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
        <span className="vendor-product__text">
          <span className="title-medium vendor-product__name">{product.name}</span>
          <span className="vendor-product__price">{formatMoney(product.priceCents, currency)}</span>
          {product.availableQty === 0 && <span className="label-medium vendor-product__soldout">Sold out</span>}
        </span>
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
          <Button className="vendor-save" loadingLabel={`Saving ${product.name}`} />
        ) : (
          <Button className="vendor-save" disabled={!online || !changed} aria-label={`Save stock for ${product.name}`} onClick={save}>
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
