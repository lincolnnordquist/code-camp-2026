import type { Order } from '../../shared/types'
import { orderLabels, type OrderLabels, type RefusalReason } from '../../shared/ui/labels'

/** A refusal as the order screens show it; the API's own refusal fits it, and `network` stands for a call that threw. */
export interface Refusal {
  reason: RefusalReason
  /** Products that caused an insufficient_stock or over_max_per_order refusal. */
  productIds?: string[]
}

/**
 * The reason the server records when attendees cancel their own order
 * (`cancel_my_order`, and the shared stub). The order has no "cancelled by"
 * field, so this is how the page tells an attendee cancel from a vendor one.
 */
export const ATTENDEE_CANCEL_REASON = 'Cancelled by the attendee'

export const cancelledByAttendee = (order: Pick<Order, 'status' | 'cancelReason'>) =>
  order.status === 'cancelled' && order.cancelReason === ATTENDEE_CANCEL_REASON

/** Orders the attendee still has to act on or collect. */
export const OPEN_STATUSES: Order['status'][] = ['pending_payment', 'confirmed', 'ready']

/** Orders with a pickup code to hand over at the booth. */
export const PICKUP_STATUSES: Order['status'][] = ['confirmed', 'ready']

/** Orders that have ended; they never show a pickup code again. */
export const FINAL_STATUSES: Order['status'][] = ['collected', 'cancelled', 'expired']

export const holdIsOver = (order: Pick<Order, 'holdEndsAt'>, now: number) =>
  order.holdEndsAt !== null && Date.parse(order.holdEndsAt) <= now

/**
 * A saved copy past its hold may already be expired or collected, so its code
 * is withheld until the server confirms the status (FR-26).
 */
export const codeWithheld = (order: Order, provisional: boolean, now: number) =>
  provisional && holdIsOver(order, now)

/** Whether the pickup code and QR may be shown for this copy of the order. */
export const canShowCode = (order: Order, provisional: boolean, now: number) =>
  PICKUP_STATUSES.includes(order.status) && !codeWithheld(order, provisional, now)

/**
 * The shared module's labels for an order these screens show, guarded at two paths it does not
 * cover yet (proposed to Payments & design): it throws for a reservation in pending_payment, which
 * the data never holds, and it labels a prepaid order cancelled with no refund recorded as paid,
 * which FR-28 rules out (such an order was never paid).
 */
export function attendeeOrderLabels(order: Order): OrderLabels {
  if (order.type === 'reservation' && order.status === 'pending_payment') return orderLabels({ ...order, type: 'prepaid' })
  const labels = orderLabels(order)
  if (order.type === 'prepaid' && order.status === 'cancelled' && order.refundStatus === 'none') {
    return { ...labels, paymentBadge: null, attendeePayment: null, vendorPayment: null }
  }
  return labels
}
