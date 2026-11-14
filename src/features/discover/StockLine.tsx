import { stockState } from './stockState'

/**
 * The FR-05 stock state as a line of text. With `reserve`, the line keeps its height while stock is
 * plentiful, so the cards in a row line up.
 */
export function StockLine({ qty, reserve = false }: { qty: number; reserve?: boolean }) {
  const state = stockState(qty)
  if (!state) return reserve ? <span className="stock-line" aria-hidden="true" /> : null
  return <span className={`stock-line stock-line--${state.tone}`}>{state.label}</span>
}
