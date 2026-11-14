import type { Order, Product } from "../../shared/types";
import { formatMoney } from "../../shared/ui";
import { ProductImage } from "../../shared/ui/ProductImage";

// The items card of the attendee order page: photo, quantity pill, name and line price, then the
// total. The photo comes from the booth's own products, so staff match the shelf by sight.
export function OrderItems({ order, products }: { order: Order; products: Product[] }) {
  const money = (cents: number) => formatMoney(cents, order.currency);
  return (
    <section className="vendor-items" aria-labelledby={`items-${order.id}`}>
      <h2 id={`items-${order.id}`}>Items</h2>
      <ul role="list">
        {order.items.map((item) => {
          const product = products.find((p) => p.id === item.productId);
          return (
            <li key={item.productId} className="vendor-item">
              <span className="vendor-item__photo">{product && <ProductImage product={product} size="small" />}</span>
              <span className="vendor-item__qty">{item.quantity}×</span>
              <span className="vendor-item__name">{item.name}</span>
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
