import type { ButtonHTMLAttributes } from "react";
import { Icon } from "./Icon";

type FilterChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  selected: boolean;
};

export function FilterChip({ selected, children, type = "button", ...rest }: FilterChipProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={selected}
      className={`ec-chip${selected ? " is-selected" : ""}`}
    >
      {selected && <Icon name="check" size={18} />}
      {children}
    </button>
  );
}
