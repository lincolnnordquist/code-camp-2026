import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Product } from '../../shared/types'
import { focusQuietly } from '../../shell/inputModality'
import { photoLabel, type ProductPhoto } from './productImages'
import { clampPan, dismisses, NO_ZOOM, swipeStep, toggleZoom, zoomAround, type Frame, type Zoom } from './photoZoom'
import './photoViewer.css'

const FOCUSABLE = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
/** Movement before a one-finger drag picks what it does, so a tap stays a tap. */
const DRAG_SLOP_PX = 8
/** Two taps within this time and distance are a double tap. */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30
/** How long a swipe down takes to carry the photo away before the viewer goes. */
const DISMISS_MS = 180
/** A key press zooms by this factor. */
const KEY_ZOOM = 1.5

type Point = { x: number; y: number }

interface Gesture {
  kind: 'undecided' | 'pan' | 'swipe' | 'dismiss' | 'none' | 'pinch'
  x0: number
  y0: number
  t0: number
  start: Zoom
  /** Pinch only: the fingers' distance and midpoint when the second finger landed. */
  dist0?: number
  mid0?: Point
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** One photo, falling back to its plain photo, then to a quiet line, when it does not load. */
function ViewerPhoto({ photo, imgRef }: { photo: ProductPhoto; imgRef?: (el: HTMLImageElement | null) => void }) {
  const [failed, setFailed] = useState<readonly string[]>([])
  const url = [photo.url, photo.fallback].find((u): u is string => Boolean(u) && !failed.includes(u!))
  if (!url) return <p className="viewer__missing">Photo unavailable</p>
  return (
    <img
      ref={imgRef}
      className="viewer__photo"
      src={url}
      alt=""
      draggable={false}
      onError={() => setFailed((f) => [...f, url])}
    />
  )
}

interface ViewerProps {
  product: Product
  photos: readonly ProductPhoto[]
  startIndex: number
  /** Asks to close; the viewer goes when its owner stops rendering it (Back pops its history entry). */
  onClose: () => void
  /** Where focus goes back to when the viewer goes: the photo that opened it. */
  returnFocusTo: () => HTMLElement | null
}

/**
 * The product's photos full screen over a dark backdrop: swipe or the arrows between them, pinch,
 * double tap, wheel or trackpad to zoom, drag to pan once zoomed, and close with the X, Escape, Back
 * or a swipe down while not zoomed. Rendered beside the sheet, not in it, so its gestures and keys
 * never reach the sheet's own drag and Escape.
 */
export function PhotoViewer({ product, photos, startIndex, onClose, returnFocusTo }: ViewerProps) {
  const last = photos.length - 1
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), last))
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM)
  const [drag, setDrag] = useState({ dx: 0, dy: 0 })
  const [dragging, setDragging] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const photoRef = useRef<HTMLImageElement | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const lastPointerType = useRef('mouse')
  // The wheel listener is native (it must cancel the page zoom), so it reads the zoom from here.
  const zoomRef = useRef(zoom)
  useLayoutEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  // The latest opener lookup, read only when the viewer goes.
  const returnFocus = useRef(returnFocusTo)
  useLayoutEffect(() => {
    returnFocus.current = returnFocusTo
  }, [returnFocusTo])

  // Everything else leaves the tab order and the accessibility tree while the viewer is up; focus
  // starts on Close and goes back to the photo that opened it.
  useLayoutEffect(() => {
    const root = rootRef.current
    const behind = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== root && !el.inert,
    )
    behind.forEach((el) => {
      el.inert = true
    })
    if (closeRef.current) focusQuietly(closeRef.current)
    return () => {
      behind.forEach((el) => {
        el.inert = false
      })
      const target = returnFocus.current()
      if (target?.isConnected) focusQuietly(target)
    }
  }, [])

  const frame = (): Frame => {
    const stage = stageRef.current
    const img = photoRef.current
    const stageW = stage?.clientWidth ?? 0
    const stageH = stage?.clientHeight ?? 0
    return { stageW, stageH, photoW: img?.offsetWidth ?? stageW, photoH: img?.offsetHeight ?? stageH }
  }

  /** A pointer's place relative to the stage's centre, where the zoom arithmetic measures from. */
  const fromCentre = (clientX: number, clientY: number): Point => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 }
  }

  const go = (next: number) => {
    const target = Math.max(0, Math.min(last, next))
    setDrag({ dx: 0, dy: 0 })
    if (target === index) return
    setIndex(target)
    setZoom(NO_ZOOM)
    setAnnouncement(photoLabel(product, photos, target))
  }

  const close = () => {
    if (leaving) return
    onClose()
  }

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // A trackpad pinch arrives as a wheel with ctrlKey and small steps; a mouse wheel as larger ones.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))
      const point = fromCentre(e.clientX, e.clientY)
      setZoom(zoomAround(zoomRef.current, zoomRef.current.s * factor, point, frame()))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  })

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    lastPointerType.current = e.pointerType
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // A pointer the browser no longer tracks cannot be captured; the gesture still works over the stage.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    if (pts.length === 2) {
      const [a, b] = pts
      setDrag({ dx: 0, dy: 0 })
      gesture.current = {
        kind: 'pinch',
        x0: 0,
        y0: 0,
        t0: e.timeStamp,
        start: zoomRef.current,
        dist0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid0: fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2),
      }
      setDragging(true)
      return
    }
    if (pts.length === 1) {
      gesture.current = { kind: 'undecided', x0: e.clientX, y0: e.clientY, t0: e.timeStamp, start: zoomRef.current }
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()]
      if (pts.length < 2) return
      const [a, b] = pts
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2)
      setZoom(zoomAround(g.start, g.start.s * (dist / g.dist0!), g.mid0!, frame(), mid))
      return
    }
    const dx = e.clientX - g.x0
    const dy = e.clientY - g.y0
    if (g.kind === 'undecided') {
      if (Math.hypot(dx, dy) < DRAG_SLOP_PX) return
      g.kind = g.start.s > 1 ? 'pan' : Math.abs(dx) > Math.abs(dy) ? 'swipe' : dy > 0 ? 'dismiss' : 'none'
      setDragging(true)
    }
    if (g.kind === 'pan') setZoom(clampPan({ s: g.start.s, tx: g.start.tx + dx, ty: g.start.ty + dy }, frame()))
    else if (g.kind === 'swipe') {
      // Past the first or last photo the strip gives a little and springs back.
      const atEdge = (index === 0 && dx > 0) || (index === last && dx < 0)
      setDrag({ dx: atEdge ? dx / 3 : dx, dy: 0 })
    } else if (g.kind === 'dismiss') setDrag({ dx: 0, dy: Math.max(0, dy) })
  }

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      // Let go near the whole photo: back to it exactly. A finger left down carries on as a pan.
      const settled = zoomRef.current.s < 1.05 ? NO_ZOOM : zoomRef.current
      setZoom(settled)
      const rest = [...pointers.current.values()][0]
      gesture.current = rest ? { kind: settled.s > 1 ? 'pan' : 'none', x0: rest.x, y0: rest.y, t0: e.timeStamp, start: settled } : null
      if (!rest) setDragging(false)
      return
    }
    gesture.current = null
    setDragging(false)
    const dx = e.clientX - g.x0
    const dy = e.clientY - g.y0
    const elapsed = e.timeStamp - g.t0
    if (g.kind === 'swipe') {
      go(index + swipeStep(dx, elapsed, frame().stageW))
      return
    }
    if (g.kind === 'dismiss') {
      if (!dismisses(dy, elapsed)) {
        setDrag({ dx: 0, dy: 0 })
        return
      }
      if (reducedMotion()) {
        close()
        return
      }
      setLeaving(true)
      setDrag({ dx: 0, dy: frame().stageH })
      window.setTimeout(onClose, DISMISS_MS)
      return
    }
    if (g.kind !== 'undecided' || e.type === 'pointercancel' || e.pointerType === 'mouse') return
    // A tap: two in quick succession in about the same place zoom in or back out (touch and pen;
    // a mouse uses the double click below).
    const prev = lastTap.current
    if (prev && e.timeStamp - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX) {
      lastTap.current = null
      setZoom(toggleZoom(zoomRef.current, fromCentre(e.clientX, e.clientY), frame()))
      return
    }
    lastTap.current = { t: e.timeStamp, x: e.clientX, y: e.clientY }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const zoomBy = (factor: number) => setZoom(zoomAround(zoomRef.current, zoomRef.current.s * factor, { x: 0, y: 0 }, frame()))
    switch (e.key) {
      case 'Escape':
        close()
        break
      case 'ArrowLeft':
        go(index - 1)
        break
      case 'ArrowRight':
        go(index + 1)
        break
      case '+':
      case '=':
        zoomBy(KEY_ZOOM)
        break
      case '-':
        zoomBy(1 / KEY_ZOOM)
        break
      case '0':
        setZoom(NO_ZOOM)
        break
      case 'Tab': {
        const focusable = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
          (el) => el.getAttribute('aria-hidden') !== 'true',
        )
        if (focusable.length === 0) break
        const first = focusable[0]
        const lastEl = focusable[focusable.length - 1]
        const active = document.activeElement
        const inList = focusable.includes(active as HTMLElement)
        if (e.shiftKey && (active === first || !inList)) lastEl.focus()
        else if (!e.shiftKey && (active === lastEl || !inList)) first.focus()
        else return
        break
      }
      default:
        return
    }
    e.preventDefault()
  }

  const zoomed = zoom.s > 1
  // A swipe down fades the backdrop with the distance, so the sheet shows through as it goes.
  const backdrop = drag.dy > 0 ? Math.max(0.2, 1 - drag.dy / 500) : 1
  const several = photos.length > 1

  return createPortal(
    <div
      ref={rootRef}
      className={`viewer${dragging ? ' is-dragging' : ''}${zoomed ? ' is-zoomed' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Photos of ${product.name}`}
      // Takes focus when a press lands on the photo, so the arrow keys and Escape still reach it.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // The viewer's drags are its own, not the shell's pull-to-refresh or edge swipe-back.
      data-no-pull=""
      data-no-swipe-back=""
    >
      <div className="viewer__backdrop" style={{ opacity: backdrop }} aria-hidden="true" />
      <div
        ref={stageRef}
        className="viewer__stage"
        style={{ transform: drag.dy ? `translateY(${drag.dy}px)` : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={(e) => {
          if (lastPointerType.current === 'mouse') setZoom(toggleZoom(zoomRef.current, fromCentre(e.clientX, e.clientY), frame()))
        }}
      >
        <div className="viewer__strip" style={{ transform: `translateX(calc(${-index * 100}% + ${drag.dx}px))` }}>
          {photos.map((photo, i) => (
            <div
              key={photo.url}
              className="viewer__slide"
              role="group"
              aria-roledescription="slide"
              aria-label={photoLabel(product, photos, i)}
              aria-hidden={i === index ? undefined : true}
            >
              <div
                className="viewer__zoom"
                style={i === index && zoomed ? { transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.s})` } : undefined}
              >
                <ViewerPhoto
                  photo={photo}
                  imgRef={
                    i === index
                      ? (el) => {
                          photoRef.current = el
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="viewer__bar">
        {several && (
          <p className="viewer__count" aria-hidden="true">
            {index + 1} of {photos.length}
          </p>
        )}
        <button ref={closeRef} type="button" className="viewer__button viewer__close" aria-label="Close photos" onClick={close}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {several && (
        <>
          <button
            type="button"
            className="viewer__button viewer__nav viewer__nav--prev"
            aria-label="Previous image"
            aria-disabled={index === 0 ? true : undefined}
            onClick={() => go(index - 1)}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            className="viewer__button viewer__nav viewer__nav--next"
            aria-label="Next image"
            aria-disabled={index === last ? true : undefined}
            onClick={() => go(index + 1)}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </div>,
    document.body,
  )
}
