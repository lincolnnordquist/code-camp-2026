import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])'

interface CancelSheetProps {
  vendorName: string
  /** A prepaid order is refunded by the vendor (FR-10), so the sheet says so and names it an order. */
  prepaid: boolean
  /** The question heading; focused when the sheet opens, so it is read first. */
  titleRef: RefObject<HTMLHeadingElement | null>
  cancelling: boolean
  /** Offline, the confirm button stays focusable but does nothing. */
  online: boolean
  onConfirm: () => void
  onKeep: () => void
}

/**
 * The cancel confirmation as a bottom sheet over the order page (design:
 * OrderCancelSheet). The page behind is inert while it is open; Escape, the
 * scrim and the keep button close it.
 */
export function CancelSheet({ vendorName, prepaid, titleRef, cancelling, online, onConfirm, onKeep }: CancelSheetProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const noun = prepaid ? 'order' : 'reservation'

  // A layout effect, so the page is inert from the sheet's first frame and live again in the commit
  // that removes the sheet, before the page moves focus back to it.
  useLayoutEffect(() => {
    const root = rootRef.current
    const others = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== root && !el.hasAttribute('inert'),
    )
    others.forEach((el) => el.setAttribute('inert', ''))
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      others.forEach((el) => el.removeAttribute('inert'))
      document.body.style.overflow = overflow
    }
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onKeep()
      return
    }
    if (e.key !== 'Tab') return
    // Focus stays in the sheet, wrapping at the ends; from the heading it goes to the first button.
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (items.length === 0) return
    e.preventDefault()
    const at = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1
    const next = at < 0 ? (e.shiftKey ? items.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + items.length) % items.length
    items[next].focus()
  }

  return createPortal(
    <div className="cancel-sheet" ref={rootRef} onKeyDown={onKeyDown} data-no-pull="" data-no-swipe-back="">
      <div className="cancel-sheet__scrim" aria-hidden="true" onClick={onKeep} />
      <section className="cancel-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="cancel-q" aria-describedby="cancel-sheet-text">
        <div className="cancel-sheet__handle" aria-hidden="true" />
        <div className="cancel-sheet__text">
          <h2 id="cancel-q" ref={titleRef} tabIndex={-1}>
            Cancel this {noun}?
          </h2>
          <p id="cancel-sheet-text">
            {prepaid
              ? `Your items go back on sale at ${vendorName}, and ${vendorName} refunds your payment through Square. You can't undo this.`
              : `Your items go back on sale at ${vendorName}. You can't undo this.`}
          </p>
        </div>
        {/* Says why the confirm button does nothing; it describes that button. */}
        {!online && (
          <p className="cancel-sheet__offline" id="cancel-sheet-offline">
            You're offline. Connect to cancel.
          </p>
        )}
        <div className="cancel-sheet__buttons">
          <button
            type="button"
            className="order-button order-button--danger"
            // aria-disabled, not disabled, so focus stays on the button while it works or goes offline.
            aria-disabled={cancelling || !online}
            aria-describedby={online ? undefined : 'cancel-sheet-offline'}
            onClick={onConfirm}
          >
            {cancelling ? 'Cancelling...' : `Cancel ${noun}`}
          </button>
          <button type="button" className="order-button order-button--outlined" onClick={onKeep}>
            Keep {noun}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
