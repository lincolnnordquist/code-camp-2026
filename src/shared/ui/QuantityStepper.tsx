import { Icon } from "./Icon";
import "./components.css";

type QuantityStepperProps = {
  itemName: string;
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  canDecrease: boolean;
  canIncrease: boolean;
};

export function QuantityStepper({ itemName, value, onDecrease, onIncrease, canDecrease, canIncrease }: QuantityStepperProps) {
  return (
    <div className="ec-stepper">
      <button
        type="button"
        className="ec-btn ec-btn-tonal ec-stepper-button"
        aria-label={`Decrease ${itemName}`}
        disabled={!canDecrease}
        onClick={onDecrease}
      >
        <Icon name="remove" />
      </button>
      <span className="title-medium ec-stepper-value" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="ec-btn ec-btn-tonal ec-stepper-button"
        aria-label={`Increase ${itemName}`}
        disabled={!canIncrease}
        onClick={onIncrease}
      >
        <Icon name="add" />
      </button>
    </div>
  );
}
