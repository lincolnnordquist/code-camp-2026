import "./components.css";

type CartBarProps = {
  href: string;
  itemCount: string;
  total: string;
};

export function CartBar({ href, itemCount, total }: CartBarProps) {
  return (
    <a className="ec-cart-bar" href={href}>
      <span className="body-medium">{itemCount}</span>
      <span className="button-medium">View cart</span>
      <span className="title-medium">{total}</span>
    </a>
  );
}
