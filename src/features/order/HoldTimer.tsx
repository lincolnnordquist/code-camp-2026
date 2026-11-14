import { useEffect, useRef, useState } from 'react'

const SECOND_MS = 1_000
const MINUTE_MS = 60_000
/** Minutes left at which the hold is read out once, and the timer turns to the warning colour. */
const ANNOUNCE_AT_MINUTES = [10, 1] as const
const SOON_MINUTES = 10

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const pad = (n: number) => String(n).padStart(2, '0')

/** "1:42:08 left", or "12:48 left" under an hour; minutes only ("102 min left") when seconds would tick. */
export function formatTimeLeft(ms: number, withSeconds: boolean): string {
  const total = Math.max(0, Math.ceil(ms / SECOND_MS))
  if (!withSeconds) return `${Math.ceil(total / 60)} min left`
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)} left` : `${m}:${pad(s)} left`
}

export const formatClock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * The hold's end time and a live countdown. It ticks each second, or each
 * minute when the attendee asked for reduced motion. The countdown itself is
 * never a live region; only crossing 10 and 1 minutes left is read out.
 */
export function HoldTimer({ endsAt }: { endsAt: string }) {
  const end = Date.parse(endsAt)
  const [withSeconds] = useState(() => !reducedMotion())
  const [now, setNow] = useState(() => Date.now())
  const announcerRef = useRef<HTMLSpanElement>(null)
  const lastMinutes = useRef<number | null>(null)
  const left = end - now
  const minutesLeft = Math.ceil(Math.max(0, left) / MINUTE_MS)
  const ended = left <= 0

  useEffect(() => {
    if (ended) return
    const id = setInterval(() => setNow(Date.now()), withSeconds ? SECOND_MS : MINUTE_MS)
    return () => clearInterval(id)
  }, [withSeconds, ended])

  useEffect(() => {
    const previous = lastMinutes.current
    lastMinutes.current = minutesLeft
    // The first reading only sets the baseline, so opening the page never announces.
    if (previous === null || minutesLeft >= previous) return
    // An ended hold says nothing here, even when a throttled tab jumped past a threshold to the end.
    const crossed = ended ? undefined : ANNOUNCE_AT_MINUTES.find((m) => previous > m && minutesLeft <= m)
    // Written directly, so the region stays mounted and only speaks at a threshold. Between
    // thresholds (and once the hold ends) it is cleared, silently, so it never holds a stale count.
    const region = announcerRef.current
    if (region) region.textContent = crossed ? `${crossed} ${crossed === 1 ? 'minute' : 'minutes'} left on the hold.` : ''
  }, [minutesLeft, ended])

  return (
    <>
      <span className="order-detail__value-row">
        <time dateTime={endsAt}>{formatClock(endsAt)}</time>
        <span className={`order-timer${!ended && minutesLeft <= SOON_MINUTES ? ' order-timer--soon' : ''}`}>
          {!ended ? formatTimeLeft(left, withSeconds) : 'Hold ended'}
        </span>
      </span>
      <span className="visually-hidden" role="status" ref={announcerRef} />
    </>
  )
}
