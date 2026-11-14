import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { listMyOrders } from '../../shared/api'
import { primedOrders } from './openOrders'
import { subscribeToMyOrders } from '../../shared/live'
import type { Booth, Order } from '../../shared/types'
import { BoothLogo } from '../../shared/ui/BoothLogo'
import { orderStatusLabels } from '../../shared/ui/labels'

const OPEN_STATUSES: Order['status'][] = ['pending_payment', 'confirmed', 'ready']

/** From this many open orders the strip folds into one summary card, so it never pushes browsing off the screen. */
const SUMMARY_FROM = 3

/** How many booth plates the summary card stacks. */
const SUMMARY_PLATES = 3

/** Last open orders shown per event, so returning to the home screen does not pop the strip in late. */
const lastShown = new Map<string, Order[]>()
const openFor = (all: Order[], eventId: string) => readyFirst(all.filter((o) => o.eventId === eventId && OPEN_STATUSES.includes(o.status)))


/** How a status change reads as the end of "Your order from X, Booth A1, ..." */
const statusChangePhrase: Record<Order['status'], string> = {
  pending_payment: 'is waiting for a payment check',
  confirmed: 'is confirmed',
  ready: 'is ready for pickup',
  collected: 'was picked up',
  cancelled: 'was cancelled',
  expired: 'is no longer held',
}

/** The design system's badge tone per open status: ready is the one loud status. */
const statusTone: Record<Order['status'], 'success' | 'info' | 'error' | 'neutral'> = {
  pending_payment: 'info',
  confirmed: 'info',
  ready: 'success',
  collected: 'neutral',
  cancelled: 'error',
  expired: 'error',
}

/** Ready orders lead, as in the Orders wallet; the sort is stable, so the rest keep the server's order. */
const readyFirst = (orders: Order[]) => [...orders].sort((a, b) => Number(b.status === 'ready') - Number(a.status === 'ready'))

function Chevron() {
  return (
    <svg className="active-order__chevron" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** "1 ready for pickup: Wall Rose Goods", naming the booth to walk to. */
function readySummary(open: Order[]) {
  const ready = open.filter((o) => o.status === 'ready')
  if (ready.length === 0) return 'None ready for pickup yet'
  const more = ready.length > 1 ? ` and ${ready.length - 1} more` : ''
  return `${ready.length} ready for pickup: ${ready[0].boothName}${more}`
}

/**
 * Keeps open orders one tap away while the attendee keeps browsing, so a
 * "ready" update is noticed even off the order page.
 */
/**
 * The strip's height on this device's last visit, so the first paint can hold its place while this
 * visit's orders load and the sections below do not jump down when it appears (layout shift). Only a
 * number is kept: no order details.
 */
const reservedKey = (eventId: string) => `discover.activeOrdersHeight.${eventId}`

function readReserved(eventId: string): number {
  try {
    const value = Number(localStorage.getItem(reservedKey(eventId)))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

function writeReserved(eventId: string, height: number) {
  try {
    if (height > 0) localStorage.setItem(reservedKey(eventId), String(Math.round(height)))
    else localStorage.removeItem(reservedKey(eventId))
  } catch {
    // Storage blocked: the strip just appears without a held place.
  }
}

export function ActiveOrders({ eventId, booths = [] }: { eventId: string; booths?: Booth[] }) {
  const [orders, setOrders] = useState<Order[]>(() => {
    const primed = primedOrders()
    return lastShown.get(eventId) ?? (primed ? openFor(primed, eventId) : [])
  })
  const [announcement, setAnnouncement] = useState('')
  // The remembered strip only avoids a late pop-in; its pickup codes stay hidden
  // until this visit's own refresh confirms them, so an expired or picked-up
  // order never shows a code as if it were current.
  const [confirmed, setConfirmed] = useState(false)
  // Last seen status per order. Null until the first load, which is never announced.
  const knownStatuses = useRef<Map<string, Order['status']> | null>(null)
  const [reserved] = useState(() => readReserved(eventId))
  const stripRef = useRef<HTMLElement>(null)

  // Once this visit's orders are in, remember how tall the strip is (0 when there is none).
  useLayoutEffect(() => {
    if (confirmed) writeReserved(eventId, stripRef.current?.offsetHeight ?? 0)
  }, [confirmed, orders, eventId])

  useEffect(() => {
    let active = true
    knownStatuses.current = null
    const show = (all: Order[]) => {
      if (!active) return
      const forEvent = all.filter((o) => o.eventId === eventId)
      const known = knownStatuses.current
      // An order that just left the open list (picked up, cancelled) is announced too.
      const changed = known ? forEvent.filter((o) => known.has(o.id) && known.get(o.id) !== o.status) : []
      knownStatuses.current = new Map(forEvent.map((o) => [o.id, o.status]))
      if (changed.length > 0) {
        setAnnouncement(
          changed
            .map((o) => `Your order from ${o.boothName}, Booth ${o.boothCode}, ${statusChangePhrase[o.status]}.`)
            .join(' '),
        )
      }
      const open = openFor(forEvent, eventId)
      lastShown.set(eventId, open)
      setOrders(open)
      setConfirmed(true)
    }
    let latestRequest = 0
    // No orders yet, or no connection, simply shows nothing here.
    const load = () => {
      const request = ++latestRequest
      listMyOrders()
        .then((all) => request === latestRequest && show(all))
        .catch(() => undefined)
    }
    load()
    const unsubscribe = subscribeToMyOrders(load)
    return () => {
      active = false
      unsubscribe()
    }
  }, [eventId])

  const anyReady = orders.some((o) => o.status === 'ready')
  const boothsById = new Map(booths.map((b) => [b.id, b]))
  // The booth's logo, its one picture everywhere; an order whose booth is not in the catalog keeps its code tile.
  const boothMark = (o: Order) => {
    const booth = boothsById.get(o.boothId)
    if (booth) return <BoothLogo key={o.id} booth={booth} className="active-order__plate" />
    return (
      <span key={o.id} className="booth-plate active-order__plate" aria-hidden="true">
        {o.boothCode}
      </span>
    )
  }

  return (
    <>
      {/* Always mounted, so a status change is announced even when the strip appears or empties. */}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      {!confirmed && orders.length === 0 && reserved > 0 ? (
        <div className="active-orders active-orders--loading skeleton" style={{ blockSize: reserved }} aria-hidden="true" />
      ) : orders.length >= SUMMARY_FROM ? (
        <section className="active-orders" aria-label="Your open orders" ref={stripRef}>
          <Link className="active-order active-order--summary" to="/orders">
            <span className="active-order__stack" aria-hidden="true">
              {orders.slice(0, SUMMARY_PLATES).map(boothMark)}
            </span>
            <span className="active-order__text">
              <span className="active-order__vendor active-orders__title">{orders.length} open orders</span>
              <span className={`active-orders__meta${anyReady ? ' active-orders__meta--ready' : ''}`}>
                <span className="visually-hidden">, </span>
                {readySummary(orders)}
              </span>
            </span>
            <Chevron />
          </Link>
        </section>
      ) : (
        orders.length > 0 && (
          <section className="active-orders" aria-label="Your open orders" ref={stripRef}>
            {orders.map((o) => {
              const showCode = confirmed && o.status !== 'pending_payment'
              return (
                <Link key={o.id} className={`active-order active-order--${o.status}`} to="/orders">
                  {boothMark(o)}
                  <span className="active-order__text">
                    <span className="active-order__vendor">
                      <span className="visually-hidden">Booth {o.boothCode}, </span>
                      {o.boothName}
                    </span>
                    <span className={`active-order__badge active-order__badge--${statusTone[o.status]}`}>
                      <span className="visually-hidden">, </span>
                      {orderStatusLabels[o.status]}
                    </span>
                  </span>
                  {showCode && (
                    <span className="active-order__code-block">
                      <span className="visually-hidden">, pickup code </span>
                      <span className="active-order__code">{o.pickupCode}</span>
                    </span>
                  )}
                </Link>
              )
            })}
          </section>
        )
      )}
    </>
  )
}
