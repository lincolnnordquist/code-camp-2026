import { useId, type InputHTMLAttributes } from "react";
import "./components.css";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  label: string;
  supportingText?: string;
  // Shown in place of supportingText.
  error?: string;
  className?: string;
};

export function TextField({ label, supportingText, error, className, id, ...rest }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const supportId = `${inputId}-support`;
  const support = error ?? supportingText;
  return (
    <div className={`ec-field${error ? " is-error" : ""}${className ? ` ${className}` : ""}`}>
      <div className="ec-field-box">
        <label className="ec-field-label" htmlFor={inputId}>
          {label}
        </label>
        <input
          {...rest}
          id={inputId}
          className="ec-field-input"
          aria-invalid={error ? true : undefined}
          aria-describedby={support ? supportId : undefined}
        />
      </div>
      {support && (
        <div id={supportId} className="ec-field-support">
          {support}
        </div>
      )}
    </div>
  );
}
