import type { Order, Product } from "../../shared/types";
import { formatMoney } from "../../shared/ui";
import { ProductImage } from "../../shared/ui/ProductImage";
import { useVendor } from "./vendorSession";

// An order item's photo from the booth's own products, so staff match the shelf by sight.
export function ItemPhoto({ productId }: { productId: string }) {
  const { boothState } = useVendor();
  const product = boothState.status === "ready" ? boothState.booth.products.find((p) => p.id === productId) : undefined;
  return <span className="vendor-photo">{product && <ProductImage product={product} size="small" />}</span>;
}

export function OrderItems({ order, products }: { order: Order; products: Product[] }) {
  const money = (cents: number) => formatMoney(cents, order.currency);
  return (
    <section className="vendor-items" aria-labelledby={`items-${order.id}`}>
      <h2 id={`items-${order.id}`} className="title-medium">
        Items
      </h2>
      <ul role="list">
        {order.items.map((item) => {
          const product = products.find((p) => p.id === item.productId);
          return (
            <li key={item.productId} className="vendor-item">
              <span className="vendor-photo">{product && <ProductImage product={product} size="small" />}</span>
              <span className="vendor-item__qty">{item.quantity}×</span>
              <span className="body-medium vendor-item__name">{item.name}</span>
              <span className="vendor-item__price">{money(item.quantity * item.unitPriceCents)}</span>
            </li>
          );
        })}
      </ul>
      <div className="vendor-items__total">
        <span>Total</span>
        <span>{money(order.totalCents)}</span>
      </div>
    </section>
  );
}

export function PassItems({ order }: { order: Order }) {
  return (
    <ul className="vendor-pass-items" role="list">
      {order.items.map((item) => (
        <li key={item.productId} className="vendor-pass-item">
          <ItemPhoto productId={item.productId} />
          <span className="body-medium vendor-pass-item__name">{item.name}</span>
          <span className="vendor-order__qty">×{item.quantity}</span>
        </li>
      ))}
    </ul>
  );
}
