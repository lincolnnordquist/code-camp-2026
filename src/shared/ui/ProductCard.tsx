import type { ReactNode } from "react";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Icon } from "./Icon";
import "./components.css";

const LOW_STOCK_LIMIT = 5;

// "adding" lasts while the request is in flight; "added" appears only after the server accepts it (FR-26).
export type ProductCardAction = "add" | "adding" | "added";

type ProductCardProps = {
  name: string;
  description: string;
  price: string;
  availableQty: number;
  imageUrl?: string;
  // Omitted when the booth does not take orders or ordering is paused (FR-05).
  action?: ProductCardAction;
  onAdd?: () => void;
  disabled?: boolean;
};

export function ProductGrid({ children }: { children: ReactNode }) {
  return <div className="ec-product-grid">{children}</div>;
}

export function ProductCard({ name, description, price, availableQty, imageUrl, action, onAdd, disabled }: ProductCardProps) {
  const soldOut = availableQty <= 0;
  return (
    <article className="ec-product-card">
      {imageUrl ? (
        <img className="ec-product-photo" src={imageUrl} alt="" />
      ) : (
        <div className="ec-product-photo" />
      )}
      <h3 className="body-large ec-product-name">{name}</h3>
      <p className="body-medium ec-product-name ec-product-description">{description}</p>
      <div className="title-medium">{price}</div>
      {!soldOut && availableQty <= LOW_STOCK_LIMIT && <Badge tone="warning">Only {availableQty} left</Badge>}
      {soldOut && action === undefined && <Badge tone="error">Sold out</Badge>}
      {action !== undefined && <ProductCardButton action={action} soldOut={soldOut} onAdd={onAdd} disabled={disabled} />}
    </article>
  );
}

function ProductCardButton({
  action,
  soldOut,
  onAdd,
  disabled,
}: {
  action: ProductCardAction;
  soldOut: boolean;
  onAdd?: () => void;
  disabled?: boolean;
}) {
  if (soldOut) {
    return (
      <Button size="small" soldOut>
        Sold out
      </Button>
    );
  }
  if (action === "adding") {
    return <Button size="small" loadingLabel="Adding" />;
  }
  if (action === "added") {
    return (
      <Button size="small" variant="tonal" icon={<Icon name="check" size={20} />} onClick={onAdd} disabled={disabled}>
        Added
      </Button>
    );
  }
  return (
    <Button size="small" icon={<Icon name="add" size={20} />} onClick={onAdd} disabled={disabled}>
      Add
    </Button>
  );
}
