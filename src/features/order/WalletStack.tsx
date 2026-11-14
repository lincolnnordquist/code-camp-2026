import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Order } from '../../shared/types'
import { formatMoney, orderStatusLabels } from '../../shared/ui/labels'
import { formatClock, formatTimeLeft } from './HoldTimer'
import { OrderBoothLogo } from './OrderBoothLogo'
import { PickupQr } from './PickupQr'
import { useCatalogProduct } from './boothDetails'
import { useNow } from './useNow'
import { attendeeOrderLabels } from './orderStatus'
import { bringToFront, PROGRESS_STEPS, progressStep, restack } from './walletOrder'

/** The visible top of each pass behind the front one. */
const STRIP_PX = 56
/** A pass behind the front one; only its top strip shows. */
const BACK_PASS_PX = 76
/** The front pass before its body is measured. */
const FRONT_FALLBACK_PX = 290

const PENDING_HINT = 'Your pickup code appears once payment is confirmed.'
const WITHHELD_HINT = 'Checking the latest status.'

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** A hold's time left, ticking each second, or each minute under reduced motion. */
function HeldCountdown({ endsAt }: { endsAt: string }) {
  const [withSeconds] = useState(() => !reducedMotion())
  const now = useNow(withSeconds ? 1_000 : 60_000)
  const left = formatTimeLeft(Date.parse(endsAt) - now, withSeconds).replace(/ left$/, '')
  return (
    <>
      Held <span className="wallet-pass__countdown">{left}</span>
    </>
  )
}

function StripStatus({ order: o }: { order: Order }) {
  if (o.status === 'ready') return <>{attendeeOrderLabels(o).headline}</>
  if (o.type === 'reservation' && o.status === 'confirmed' && o.holdEndsAt) return <HeldCountdown endsAt={o.holdEndsAt} />
  return <>{orderStatusLabels[o.status]}</>
}

function headline(o: Order): string {
  if (o.type === 'reservation' && o.status === 'confirmed' && o.holdEndsAt) return `Held until ${formatClock(o.holdEndsAt)}`
  return attendeeOrderLabels(o).headline
}

function Thumb({ productId }: { productId: string }) {
  const product = useCatalogProduct(productId)
  return (
    <span className="wallet-pass__thumb">
      {product && <img src={product.imageUrl} alt="" width={36} height={36} loading="lazy" decoding="async" />}
    </span>
  )
}

function ProgressTrack({ status }: { status: Order['status'] }) {
  const reached = progressStep(status)
  return (
    <div className="wallet-progress">
      <div className="wallet-progress__track" aria-hidden="true">
        {PROGRESS_STEPS.map((step, i) => (
          <span key={step} className="wallet-progress__segment">
            {i < reached && <span className="wallet-progress__fill" style={{ '--i': i } as CSSProperties} />}
          </span>
        ))}
      </div>
      <ol className="wallet-progress__labels body-small">
        {PROGRESS_STEPS.map((step, i) => (
          <li
            key={step}
            className={i + 1 === reached ? 'is-current' : i + 1 > reached ? 'is-ahead' : undefined}
            aria-current={i + 1 === reached ? 'step' : undefined}
          >
            {step}
          </li>
        ))}
      </ol>
    </div>
  )
}

function PassBody({
  order: o,
  showCode,
  withheld,
  onShow,
}: {
  order: Order
  showCode: boolean
  withheld: boolean
  onShow: (e: MouseEvent<HTMLButtonElement>, id: string) => void
}) {
  const payment = o.status === 'pending_payment' ? null : attendeeOrderLabels(o).paymentBadge?.label
  const hint = o.status === 'pending_payment' ? PENDING_HINT : withheld ? WITHHELD_HINT : null
  return (
    <>
      <p className="wallet-pass__headline title-large">{headline(o)}</p>
      <ProgressTrack status={o.status} />
      {showCode ? (
        <button
          type="button"
          className="wallet-pass__code-card"
          // Spelled out, so the code is read character by character, as staff will check it.
          aria-label={`Show at booth: pickup code ${o.pickupCode.split('').join(' ')}`}
          onClick={(e) => onShow(e, o.id)}
        >
          <span className="wallet-pass__code-block">
            <span className="label-medium wallet-pass__code-label">Pickup code</span>
            <span className="code">{o.pickupCode}</span>
          </span>
          {/* A thumbnail for recognition only; pickup mode shows the scannable one. */}
          <span className="wallet-pass__qr-wrap" aria-hidden="true">
            <PickupQr code={o.pickupCode} className="wallet-pass__qr" />
          </span>
        </button>
      ) : (
        <Link className="wallet-pass__code-card wallet-pass__code-card--hint body-medium" to={`/orders/${o.id}`}>
          {hint}
        </Link>
      )}
      <div className="wallet-pass__items">
        <span className="wallet-pass__thumbs">
          {o.items.slice(0, 3).map((item) => (
            <Thumb key={item.productId} productId={item.productId} />
          ))}
        </span>
        {payment && <span className="body-medium wallet-pass__payment">{payment}</span>}
        <span className="button-medium wallet-pass__total">{formatMoney(o.totalCents, o.currency)}</span>
      </div>
    </>
  )
}

export function WalletStack({
  orders,
  showCode,
  withheld,
  onShow,
}: {
  orders: Order[]
  showCode: (o: Order) => boolean
  withheld: (o: Order) => boolean
  onShow: (e: MouseEvent<HTMLButtonElement>, id: string) => void
}) {
  const [stack, setStack] = useState<string[]>(() => restack([], orders))
  const [bodyHeights, setBodyHeights] = useState<Record<string, number>>({})
  const bodies = useRef(new Map<string, HTMLDivElement>())

  const next = restack(stack, orders)
  // Adjusted during render, so a new or finished order never paints in the old stack first.
  if (next.length !== stack.length || next.some((id, i) => id !== stack[i])) setStack(next)

  useLayoutEffect(() => {
    const measure = () =>
      setBodyHeights((prev) => {
        const heights: Record<string, number> = {}
        bodies.current.forEach((el, id) => (heights[id] = el.offsetHeight))
        return Object.keys(heights).every((id) => heights[id] === prev[id]) && Object.keys(prev).length === Object.keys(heights).length
          ? prev
          : heights
      })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    bodies.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [orders])

  const front = next.at(-1)
  const frontHeight = front && bodyHeights[front] ? STRIP_PX + bodyHeights[front] : FRONT_FALLBACK_PX
  const height = (next.length - 1) * STRIP_PX + frontHeight

  const raise = (id: string) => setStack((s) => bringToFront(s, id))
  const onKey = (e: KeyboardEvent<HTMLElement>, id: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    raise(id)
  }

  // A stable DOM order, so a pass keeps its element and its move animates.
  const byId = [...orders].sort((a, b) => (a.id < b.id ? -1 : 1))
  return (
    <div className="wallet-stack" style={{ height }}>
      {byId.map((o) => {
        const index = next.indexOf(o.id)
        const isFront = o.id === front
        const tone = isFront ? 'front' : index === 0 ? 'rear' : 'back'
        const strip = (
          <span className="wallet-pass__head">
            <span className="wallet-pass__logo">
              <OrderBoothLogo order={o} size="sm" />
            </span>
            <span className="title-medium wallet-pass__vendor">{o.boothName}</span>
            <span className="wallet-pass__right">
              <span className="body-medium wallet-pass__strip" aria-hidden={isFront || undefined}>
                <StripStatus order={o} />
              </span>
              <span className="wallet-pass__booth" aria-hidden={!isFront || undefined}>
                <span className="label-small">Booth</span>
                <span className="headline-small wallet-pass__booth-code">{o.boothCode}</span>
              </span>
            </span>
          </span>
        )
        return (
          <div
            key={o.id}
            className={`wallet-pass wallet-pass--${tone}`}
            style={{ top: index * STRIP_PX, height: isFront ? frontHeight : BACK_PASS_PX, zIndex: index + 1 }}
            {...(isFront
              ? { role: 'group', 'aria-label': `${o.boothName}, Booth ${o.boothCode}, ${headline(o)}` }
              : {
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': `${o.boothName}, ${o.status === 'ready' ? attendeeOrderLabels(o).headline : orderStatusLabels[o.status]}. Show this order`,
                  onClick: () => raise(o.id),
                  onKeyDown: (e: KeyboardEvent<HTMLElement>) => onKey(e, o.id),
                })}
          >
            {strip}
            <div
              className="wallet-pass__body"
              aria-hidden={!isFront || undefined}
              inert={!isFront}
              ref={(el) => {
                if (el) bodies.current.set(o.id, el)
                else bodies.current.delete(o.id)
              }}
            >
              <PassBody order={o} showCode={showCode(o)} withheld={withheld(o)} onShow={onShow} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
