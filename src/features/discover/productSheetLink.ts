import { useLocation } from 'react-router-dom'

/** The open product lives in the URL, so Back closes the sheet and a reload or shared link reopens it. */
export const PRODUCT_PARAM = 'product'

/** Marks a sheet this app opened by pushing a history entry, so closing it can go Back instead of adding one. */
export interface SheetState {
  productSheet: true
}

const SHEET_STATE: SheetState = { productSheet: true }

export function withProduct(search: string, productId: string | null): string {
  const params = new URLSearchParams(search)
  if (productId === null) params.delete(PRODUCT_PARAM)
  else params.set(PRODUCT_PARAM, productId)
  const next = params.toString()
  return next === '' ? '' : `?${next}`
}

/** Props for a card's Link: opens the sheet over the current screen and keeps its filters. */
export function useProductSheetLink() {
  const { pathname, search } = useLocation()
  return (productId: string): { to: { pathname: string; search: string }; state: SheetState; 'data-product-card': string } => ({
    to: { pathname, search: withProduct(search, productId) },
    state: SHEET_STATE,
    'data-product-card': productId,
  })
}
