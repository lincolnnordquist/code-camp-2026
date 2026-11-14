import { useId, useState } from "react";
import { Icon } from "./Icon";
import "./components.css";

const CODE_LENGTH = 4;

type CodeEntryProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  vendorSide?: boolean;
  error?: string;
};

export function CodeEntry({ label, value, onChange, vendorSide = false, error }: CodeEntryProps) {
  const [focused, setFocused] = useState(false);
  const errorId = useId();
  const activeIndex = focused && !error ? Math.min(value.length, CODE_LENGTH - 1) : -1;
  const classes = ["ec-code-entry", vendorSide ? "is-vendor" : "", error ? "is-error" : ""].filter(Boolean).join(" ");

  return (
    <div>
      <div className={classes}>
        {/* One transparent input covers the boxes, so typing, pasting and the phone keyboard behave like a normal field. */}
        <input
          className="ec-code-entry-input"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          value={value}
          maxLength={CODE_LENGTH}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {Array.from({ length: CODE_LENGTH }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={`ec-code-entry-box${index === activeIndex ? " is-active" : ""}`}
          >
            {value[index] ?? ""}
          </span>
        ))}
      </div>
      {error && (
        <div id={errorId} className="body-small ec-code-entry-error">
          <Icon name="error" size={16} />
          {error}
        </div>
      )}
    </div>
  );
}
