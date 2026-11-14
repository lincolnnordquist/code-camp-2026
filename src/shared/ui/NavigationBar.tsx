import { Icon, type IconName } from "./Icon";
import "./components.css";

export type NavigationItem = {
  label: string;
  icon: IconName;
  href: string;
  current: boolean;
};

type NavigationBarProps = {
  label: string;
  items: NavigationItem[];
};

export function NavigationBar({ label, items }: NavigationBarProps) {
  return (
    <nav className="ec-nav-bar" aria-label={label}>
      {items.map((item) => (
        <a
          key={item.href}
          className="ec-nav-item"
          href={item.href}
          aria-current={item.current ? "page" : undefined}
        >
          <span className="ec-nav-indicator">
            <Icon name={item.icon} filled={item.current} />
          </span>
          <span className="label-medium">{item.label}</span>
        </a>
      ))}
    </nav>
  );
}
