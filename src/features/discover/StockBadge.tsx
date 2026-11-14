import { stockState } from './stockState'

/** The design system's badge for the FR-05 stock state; renders nothing while stock is plentiful. */
export function StockBadge({ qty, className = '' }: { qty: number; className?: string }) {
  const state = stockState(qty)
  if (!state) return null
  return <span className={`stock-badge stock-badge--${state.tone} ${className}`.trim()}>{state.label}</span>
}
