import { useEffect, useId, useLayoutEffect, useRef, type MouseEvent } from 'react'
import { focusQuietly } from '../../shell/inputModality'
import { activeFilterCount, NO_FILTERS, PRICE_BANDS, SORT_LABELS, type ProductFilters, type SortOrder } from './filters'

/**
 * The Filters chip that leads a chip row. It opens the filters sheet instead of adding six more
 * chips to a row that already scrolls past a phone's width.
 */
export function FiltersChip({
  filters,
  expanded,
  onOpen,
  onMouseDown,
}: {
  filters: ProductFilters
  expanded: boolean
  onOpen: () => void
  onMouseDown?: (e: MouseEvent) => void
}) {
  const count = activeFilterCount(filters)
  return (
    <button
      type="button"
      className={`chip chip--filters${count > 0 ? ' is-active' : ''}`}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onMouseDown={onMouseDown}
      onClick={() => {
        onOpen()
      }}
    >
      <svg className="chip__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="10" cy="17" r="2" />
      </svg>
      Filters
      {count > 0 && (
        <span className="chip__count">
          <span className="visually-hidden">, </span>
          {count}
          <span className="visually-hidden"> on</span>
        </span>
      )}
    </button>
  )
}

interface FiltersSheetProps {
  open: boolean
  filters: ProductFilters
  onChange: (next: ProductFilters) => void
  onClose: () => void
  /** The order with no sort chosen: "Relevance" for search, "Featured" on a storefront. */
  defaultSortLabel: string
  /** How many products the current filters show, spoken and on the Show button. */
  resultCount: number
  /** Where focus goes when the sheet closes. */
  returnFocus: () => HTMLElement | null
}

/** Filters and sort in a bottom sheet. Every change applies at once; the list behind updates. */
export function FiltersSheet({ open, filters, onChange, onClose, defaultSortLabel, resultCount, returnFocus }: FiltersSheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const sortName = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      // jsdom has no showModal; the open attribute shows the same content there.
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      headingRef.current?.focus({ preventScroll: true })
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      const target = returnFocus()
      if (target) focusQuietly(target)
    }
  }, [open, returnFocus])

  // The page behind stops scrolling while the sheet is up, as under the product sheet: a drag in the
  // sheet scrolls the sheet (iOS otherwise chains it to the page), and the page is where it was after.
  useLayoutEffect(() => {
    if (!open) return
    const root = document.documentElement
    const overflow = root.style.overflow
    const scrollY = window.scrollY
    root.style.overflow = 'hidden'
    return () => {
      root.style.overflow = overflow
      if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: 'instant' })
    }
  }, [open])

  const set = (patch: Partial<ProductFilters>) => {
    onChange({ ...filters, ...patch })
  }
  const count = `${resultCount} ${resultCount === 1 ? 'product' : 'products'}`
  const sorts: Array<[SortOrder, string]> = [['default', defaultSortLabel], ...(Object.entries(SORT_LABELS) as Array<[SortOrder, string]>)]

  return (
    <dialog
      ref={ref}
      className="filters-sheet"
      aria-labelledby={titleId}
      // Escape, and a tap on the dimmed page around the sheet, close it like the product sheet.
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="filters-sheet__body">
        <span className="filters-sheet__handle" aria-hidden="true" />
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="filters-sheet__title">
          Filter and sort
        </h2>

        <div className="filters-sheet__group" role="group" aria-labelledby={`${titleId}-show`}>
          <h3 id={`${titleId}-show`}>Availability</h3>
          <div className="filters-sheet__chips">
            <button type="button" className="chip" aria-pressed={filters.inStock} onClick={() => set({ inStock: !filters.inStock })}>
              {filters.inStock && <Check />}
              In stock
            </button>
          </div>
        </div>

        <div className="filters-sheet__group" role="group" aria-labelledby={`${titleId}-price`}>
          <h3 id={`${titleId}-price`}>Price</h3>
          <div className="filters-sheet__chips">
            {PRICE_BANDS.map((band) => {
              const on = filters.price === band.id
              return (
                <button key={band.id} type="button" className="chip" aria-pressed={on} onClick={() => set({ price: on ? null : band.id })}>
                  {on && <Check />}
                  {band.label}
                </button>
              )
            })}
          </div>
        </div>

        <fieldset className="filters-sheet__group filters-sheet__sort">
          <legend>Sort</legend>
          {sorts.map(([value, label]) => (
            <label key={value} className="filters-sheet__option">
              <input type="radio" name={sortName} checked={filters.sort === value} onChange={() => set({ sort: value })} />
              {label}
            </label>
          ))}
        </fieldset>

        <p className="visually-hidden" role="status">
          {open ? count : ''}
        </p>
      </div>
      <div className="filters-sheet__actions">
        <button
          type="button"
          className="button button--ghost"
          aria-disabled={activeFilterCount(filters) === 0 ? true : undefined}
          onClick={() => {
            if (activeFilterCount(filters) > 0) set(NO_FILTERS)
          }}
        >
          Clear filters
        </button>
        <button type="button" className="button" onClick={onClose}>
          Show {count}
        </button>
      </div>
    </dialog>
  )
}

function Check() {
  return (
    <svg className="chip__check" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}
