import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type CSSProperties,
  type PointerEvent,
  type Ref,
} from 'react'
import type { Booth } from '../../shared/types'
import { boothBadgeLabel, isPaused } from './boothLabel'
import { rowTop, type FloorLayout } from './catalogExtras'
import {
  centreOnPlate,
  clampScroll,
  drawnAspectRatio,
  drawnWidth,
  flickVelocity,
  pinchScale,
  ROW_LABEL_GUTTER,
  scrollToPin,
  viewCentre,
  visibleFraction,
  type MapPosition,
  type PanSample,
  type PlanPoint,
} from './mapGeometry'
import './map.css'

/** What a page can ask of the interactive map. */
export interface FloorMapHandle {
  /** Zooms to at least 2x with the booth in the middle of the map, animated unless reduced motion is on. */
  centreOnBooth: (boothId: string) => void
}

interface FloorMapProps {
  ref?: Ref<FloorMapHandle>
  /** Optional (FR-02): without it, and without a layout, the plates sit on a plain plan. */
  floorPlanUrl: string | null
  /** When present the plan is drawn from it, with no image (no iOS image menu on long-press). */
  floorLayout?: FloorLayout
  venueName: string
  booths: Booth[]
  highlightedBoothId?: string | null
  /** Absent for the static preview on the home screen, which is one link to the map as a whole. */
  onSelectBooth?: (booth: Booth) => void
  /** Deselects: a tap on empty map or Escape. This is also how the selected plate's pulse is stopped. */
  onClearSelection?: () => void
}

/**
 * Shape of the image plan before it loads, and offline when it never does.
 * Booth positions are fractions of the plan, so the box must keep this shape.
 */
const DEFAULT_ASPECT_RATIO = '1000 / 840'

/**
 * A booth's map position is a point (mapX, mapY), so on the image plan its
 * plate gets this size, in percent of the plan, centred on the point. It
 * matches a table of the Code Camp layout (76 x 50 on 1000 x 840).
 */
const IMAGE_PLATE_PERCENT = { width: 7.6, height: 5.95 }

/**
 * Zoom is continuous between the whole hall at the container width and 3x,
 * like Maps or Photos. At fit a plate is drawn small; its 44 px target comes
 * from the ::after hit area in discover.css.
 */
const MIN_SCALE = 1
const MAX_SCALE = 3
const SCALE_EPSILON = 0.01
/** Each press of + or - multiplies or divides the scale by this. */
const BUTTON_STEP = 1.5
/** A double-tap at fit zooms to this; a double-tap when zoomed returns to fit. */
const DOUBLE_TAP_SCALE = 2
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP_PX = 30
/** A press that moves further than this is a drag, not a tap. */
const TAP_MOVE_PX = 10
/** Double-tap-and-drag (one-finger zoom, as in Apple Maps): dragging this far down doubles the scale. */
const TAP_DRAG_PX_PER_DOUBLING = 100
const ZOOM_ANIMATION_MS = 200
/** A wheel's line step, in px, for mice that report lines. */
const WHEEL_LINE_PX = 16
/** Ctrl and wheel (or a trackpad pinch): each px of wheel scales by e^(px * this), so 100 px is about 2x. */
const WHEEL_ZOOM_PER_PX = 0.007
/** A wheel zoom is settled (laid out and announced) once the wheel has rested this long. */
const WHEEL_SETTLE_MS = 150
/** Arrow keys pan the zoomed map by this much. */
const KEY_PAN_PX = 40
const ARROW_PAN = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const
/** The glide after a flick: its speed comes from the last this-many ms of the pan. */
const GLIDE_SAMPLE_MS = 80
/** A release slower than this, in px per ms, does not glide. */
const GLIDE_MIN_SPEED = 0.05
/** The glide slows by e every this-many ms, close to a native scroll's deceleration. */
const GLIDE_TIME_CONSTANT_MS = 325
const GLIDE_MAX_STEP_MS = 32
const GLIDE_STOP_PX = 0.05

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
/** Remembers that this viewer has seen the "pinch to zoom" tip. */
const HINT_SEEN_KEY = 'map.zoomHintSeen'

/** Clamps a scale to 1x..3x. A non-finite input (a 0/0 pinch) keeps `fallback`, so labels never read NaN. */
const clampScale = (s: number, fallback: number) => (Number.isFinite(s) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)) : fallback)
/** Two touches closer than this give no usable pinch distance. */
const MIN_PINCH_DISTANCE_PX = 1
const scaleName = (s: number) => (s < MIN_SCALE + SCALE_EPSILON ? 'fit' : `${Math.round(s * 100)}%`)

/** A plan point (0 to 1 of the canvas) pinned to a point in the scroller's viewport (px). */
interface Anchor {
  planX: number
  planY: number
  viewX: number
  viewY: number
}

/** WebKit's own pinch event (iOS Safari). Not in the DOM lib types. */
interface WebKitGestureEvent extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

function readHintSeen() {
  try {
    return localStorage.getItem(HINT_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeHintSeen() {
  try {
    localStorage.setItem(HINT_SEEN_KEY, '1')
  } catch {
    // Without storage the tip simply shows again next visit.
  }
}

const BOOTH_CODE = /^([A-Za-z]+)(\d+)$/

/**
 * Scrolls to a fractional offset. Engines round scrollLeft/scrollTop to whole pixels, so during a
 * zoom the plan would hop a pixel on some frames; the remainder (at most a pixel, never a clamp
 * against the scroll range) is made up with a translate on the canvas.
 */
function scrollExactly(scroller: HTMLElement, canvas: HTMLElement, left: number, top: number) {
  scroller.scrollLeft = left
  scroller.scrollTop = top
  const restX = Math.max(-1, Math.min(1, scroller.scrollLeft - left))
  const restY = Math.max(-1, Math.min(1, scroller.scrollTop - top))
  canvas.style.transform = restX || restY ? `translate(${restX}px, ${restY}px)` : ''
}

/** Corner radius of a table, in plan units. A plate covers its table with the same radius. */
const TABLE_RADIUS = 8
/** The table radius as a share of the drawn width, so plates keep it at every zoom (map.css). */
const plateRadius = (layout: FloorLayout) => ({ '--plate-radius': `${(TABLE_RADIUS / drawnWidth(layout)) * 100}cqw` }) as CSSProperties

/** Plan units between the column letters and the front row of tables. */
const COLUMN_LABEL_GAP = 28

/** A table's rectangle in plan units, from its code ("D5" is column D, row 5 from the back). Null when the code does not fit the layout. */
function tableRect(layout: FloorLayout, code: string) {
  const match = BOOTH_CODE.exec(code.trim())
  if (!match) return null
  const columnIndex = layout.columns.indexOf(match[1].toUpperCase())
  const row = Number(match[2])
  if (columnIndex < 0 || row < 1 || row > layout.rows) return null
  return {
    x: layout.firstTable.x + columnIndex * layout.pitch.x,
    y: rowTop(layout, row),
    width: layout.tableSize.width,
    height: layout.tableSize.height,
  }
}

/** Where a booth's plate goes, as percentages of the drawn box: its table from the layout, else a plate centred on its map point. */
function boothPosition(booth: Booth, layout: FloorLayout | undefined): MapPosition {
  if (!layout) {
    const { width, height } = IMAGE_PLATE_PERCENT
    return { x: booth.mapX * 100 - width / 2, y: booth.mapY * 100 - height / 2, width, height }
  }
  // The map point is a fraction of the layout itself, so a table-sized plate around it is moved into the drawn box too.
  const rect = tableRect(layout, booth.code) ?? {
    x: booth.mapX * layout.width - layout.tableSize.width / 2,
    y: booth.mapY * layout.height - layout.tableSize.height / 2,
    width: layout.tableSize.width,
    height: layout.tableSize.height,
  }
  return drawnPercent(layout, rect)
}

/** A plan rectangle as percentages of the drawn box, which adds the row-number gutter. */
function drawnPercent(layout: FloorLayout, rect: { x: number; y: number; width: number; height: number }): MapPosition {
  const w = drawnWidth(layout)
  return {
    x: ((rect.x + ROW_LABEL_GUTTER) / w) * 100,
    y: (rect.y / layout.height) * 100,
    width: (rect.width / w) * 100,
    height: (rect.height / layout.height) * 100,
  }
}

/** The room in one sentence, for screen readers, built from the layout itself. */
function describeLayout(layout: FloorLayout, venueName: string) {
  const named = layout.areas.filter((a) => a.kind !== 'other')
  const atFront = (a: FloorLayout['areas'][number]) => a.y + a.height / 2 < layout.height / 2
  const parts = named.map((a) => `${a.label.toLowerCase()} at the ${atFront(a) ? 'front' : 'back'}`)
  const back = named.find((a) => !atFront(a))
  const front = named.find(atFront)
  // Row 1 is the back row, so the rows run from the back area to the front one.
  const direction = back && front ? ` from the ${back.label.toLowerCase()} to the ${front.label.toLowerCase()}` : ' from the back to the front'
  const rows = `tables in columns ${layout.columns[0]} to ${layout.columns[layout.columns.length - 1]}, rows 1 to ${layout.rows}${direction}`
  return `Floor plan of ${venueName}: ${[...parts, rows].join(', ')}.`
}

const wallOutline = (layout: FloorLayout) => `M${layout.walls.map(([x, y]) => `${x},${y}`).join(' L')} Z`

/**
 * The hall drawn from its layout. Colours are design-system tokens (map.css); the map is light only.
 * Memoized: zoom commits re-render the map, and the tables never change with zoom.
 */
const DrawnPlan = memo(function DrawnPlan({ layout, label }: { layout: FloorLayout; label: string | null }) {
  const outline = wallOutline(layout)
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const }
  return (
    <svg className="floor-map__plan plan" viewBox={`${-ROW_LABEL_GUTTER} 0 ${drawnWidth(layout)} ${layout.height}`} {...a11y}>
      <path className="plan__floor" d={outline} />
      {layout.areas.map((area) => (
        <g key={area.label} className={`plan__area plan__area--${area.kind}`}>
          <rect x={area.x} y={area.y} width={area.width} height={area.height} rx={12} />
          <text x={area.x + area.width / 2} y={area.y + area.height / 2} dominantBaseline="central" textAnchor="middle">
            {area.label}
          </text>
        </g>
      ))}
      {/* Column letters across the top, over each column, between the stage and the front row. */}
      {layout.columns.map((column, i) => (
        <text
          key={column}
          className="plan__row"
          x={layout.firstTable.x + i * layout.pitch.x + layout.tableSize.width / 2}
          y={layout.firstTable.y - COLUMN_LABEL_GAP}
          dominantBaseline="central"
          textAnchor="middle"
        >
          {column}
        </text>
      ))}
      {Array.from({ length: layout.rows }, (_, r) => {
        const row = r + 1
        const y = rowTop(layout, row)
        return (
          <g key={row}>
            <text
              className="plan__row"
              x={-ROW_LABEL_GUTTER / 2}
              y={y + layout.tableSize.height / 2}
              dominantBaseline="central"
              textAnchor="middle"
            >
              {row}
            </text>
            {layout.columns.map((column, i) => {
              const x = layout.firstTable.x + i * layout.pitch.x
              return (
                <g key={column} className="plan__table" data-code={`${column}${row}`}>
                  <rect x={x} y={y} width={layout.tableSize.width} height={layout.tableSize.height} rx={TABLE_RADIUS} />
                  <text
                    x={x + layout.tableSize.width / 2}
                    y={y + layout.tableSize.height / 2}
                    dominantBaseline="central"
                    textAnchor="middle"
                  >
                    {`${column}${row}`}
                  </text>
                </g>
              )
            })}
          </g>
        )
      })}
      {/* Drawn last so the wall line sits over the floor edge and the kitchen recess. */}
      <path className="plan__walls" d={outline} />
    </svg>
  )
})

interface BoothPlatesProps {
  booths: Booth[]
  floorLayout: FloorLayout | undefined
  highlightedBoothId: string | null | undefined
  onSelectBooth: ((booth: Booth) => void) | undefined
}

/** Every vendor's plate over its table. Memoized so a zoom commit does not re-render the plates. */
const BoothPlates = memo(function BoothPlates({ booths, floorLayout, highlightedBoothId, onSelectBooth }: BoothPlatesProps) {
  const positions = useMemo(() => booths.map((booth) => boothPosition(booth, floorLayout)), [booths, floorLayout])
  return booths.map((booth, i) => {
    const isHighlighted = booth.id === highlightedBoothId
    const className = `floor-map__booth floor-map__booth--${isPaused(booth) ? 'paused' : booth.mode}${isHighlighted ? ' is-highlighted' : ''}`
    const p = positions[i]
    const position = { left: `${p.x}%`, top: `${p.y}%`, width: `${p.width}%`, height: `${p.height}%` }
    if (!onSelectBooth) {
      return (
        <span key={booth.id} className={className} style={position}>
          <span className="floor-map__code">{booth.code}</span>
        </span>
      )
    }
    return (
      <button
        key={booth.id}
        type="button"
        className={className}
        style={position}
        data-code={booth.code}
        aria-label={`Booth ${booth.code}, ${booth.vendorName}, ${boothBadgeLabel(booth)}`}
        aria-current={isHighlighted ? 'location' : undefined}
        onClick={() => onSelectBooth(booth)}
      >
        <span className="floor-map__code">{booth.code}</span>
      </button>
    )
  })
})

/** FR-02: the floor plan with every vendor's table drawn as a booth plate. */
export function FloorMap({ ref, floorPlanUrl, floorLayout, venueName, booths, highlightedBoothId, onSelectBooth, onClearSelection }: FloorMapProps) {
  const [imageAspectRatio, setImageAspectRatio] = useState(DEFAULT_ASPECT_RATIO)
  const [imageFailed, setImageFailed] = useState(false)
  const aspectRatio = floorLayout ? drawnAspectRatio(floorLayout) : imageAspectRatio
  const scrollerRef = useRef<HTMLDivElement>(null)
  const interactive = Boolean(onSelectBooth)
  const description = floorLayout
    ? describeLayout(floorLayout, venueName)
    : `Floor plan of ${venueName}. Booths are listed as buttons on the map.`
  const canvasRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<HTMLDivElement>(null)
  // Room around the zoomed plan, half the visible map on each side, so any booth (an edge one too)
  // can sit in the middle. Scroll offsets include it; plan points do not.
  const pad = useRef({ x: 0, y: 0 })
  // Opens at fit even with a highlighted booth; the attendee zooms in from there.
  // `zoom` is the committed scale (labels, button states); `liveScale` follows the fingers without re-rendering.
  const [zoom, setZoom] = useState(MIN_SCALE)
  const liveScale = useRef(MIN_SCALE)
  // The scale the canvas is laid out at (its width). While a gesture runs, the difference to
  // liveScale is a compositor transform, so no frame lays out the 60 plates and the plan again.
  const layoutScale = useRef(MIN_SCALE)
  // The plan point in the middle of the map, and the canvas width it was measured at, kept so a resize can restore it.
  const viewMiddle = useRef<{ point: PlanPoint; width: number } | null>(null)
  const overviewViewRef = useRef<HTMLDivElement>(null)
  // The scroll offset this component last set itself on a resize, so the scroll event it causes is not
  // taken as the person panning (a clamped restore would otherwise overwrite the middle to keep).
  const ownScroll = useRef<{ left: number; top: number } | null>(null)
  // "Centre on booth" target, applied again once the commit has added the end margin, which the
  // scroll range lacks while zooming from fit, so a plate near the far edges is not left short.
  const pendingPin = useRef<{ point: PlanPoint; viewX: number; viewY: number } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [hintVisible, setHintVisible] = useState(() => !readHintSeen())
  const frame = useRef(0)
  const pending = useRef<{ scale: number; anchor: Anchor; viewX: number; viewY: number } | null>(null)
  const animation = useRef(0)
  // The glide after a flicked one-finger pan.
  const glide = useRef(0)
  // Fingers on the map right now (touch events), so a WebKit gesture event never zooms over a touch pinch.
  const touchCount = useRef(0)
  // Pointers down on the map, and whether this press has had more than one (a pinch).
  const pointers = useRef(new Set<number>())
  const multiPress = useRef(false)
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  // The second press of a double-tap, held: vertical movement zooms around where it landed.
  const tapDrag = useRef<{ pointerId: number; startY: number; scale: number; anchor: Anchor; moved: boolean } | null>(null)
  // The second press of a double-tap must not also click the plate it landed on.
  const swallowClick = useRef(false)
  // A tap on empty map deselects, but only once it is clearly not the first half of a double-tap zoom.
  const pendingClear = useRef(0)
  useEffect(() => () => window.clearTimeout(pendingClear.current), [])
  // The selected plate's pulse pauses while the page is hidden (map.css).
  const [pageHidden, setPageHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  useEffect(() => {
    const onVisibility = () => setPageHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // The helpers the gesture listeners call are stable (they read refs and state setters only),
  // so the listeners are bound once per mounted scroller and always call current code.
  // Which plan point is under a screen point right now.
  const anchorAt = useCallback((clientX: number, clientY: number): Anchor => {
    const s = scrollerRef.current
    const c = canvasRef.current
    if (!s || !c) return { planX: 0.5, planY: 0.5, viewX: 0, viewY: 0 }
    const sr = s.getBoundingClientRect()
    const cr = c.getBoundingClientRect()
    return {
      planX: (clientX - cr.left) / cr.width,
      planY: (clientY - cr.top) / cr.height,
      viewX: clientX - sr.left,
      viewY: clientY - sr.top,
    }
  }, [])

  // The canvas size on screen: its laid-out size times the live transform.
  const contentSize = useCallback(() => {
    const c = canvasRef.current
    const ratio = liveScale.current / layoutScale.current
    return c ? { width: c.offsetWidth * ratio, height: c.offsetHeight * ratio } : { width: 0, height: 0 }
  }, [])

  // Moves the overview's rectangle to what is on screen. Imperative, so scrolling never re-renders.
  const applyPad = useCallback((scale: number) => {
    const s = scrollerRef.current
    const p = panRef.current
    const next = s && scale > MIN_SCALE + SCALE_EPSILON ? { x: s.clientWidth / 2, y: s.clientHeight / 2 } : { x: 0, y: 0 }
    if (p) p.style.padding = `${next.y}px ${next.x}px`
    const previous = pad.current
    pad.current = next
    return previous
  }, [])

  const drawOverview = useCallback(() => {
    const s = scrollerRef.current
    const v = overviewViewRef.current
    if (!s || !v) return
    const f = visibleFraction(
      { left: s.scrollLeft - pad.current.x, top: s.scrollTop - pad.current.y },
      { width: s.clientWidth, height: s.clientHeight },
      contentSize(),
    )
    if (f.width <= 0 || f.height <= 0) return
    // Size only changes with zoom; position is a translate in units of the rectangle's own size,
    // so panning moves it without a layout.
    const width = `${f.width * 100}%`
    const height = `${f.height * 100}%`
    if (v.style.width !== width) v.style.width = width
    if (v.style.height !== height) v.style.height = height
    v.style.transform = `translate(${(f.x / f.width) * 100}%, ${(f.y / f.height) * 100}%)`
  }, [contentSize])

  const rememberMiddle = useCallback(() => {
    const s = scrollerRef.current
    if (!s) return
    const content = contentSize()
    if (content.width <= 0) return
    viewMiddle.current = {
      point: viewCentre(
        { left: s.scrollLeft - pad.current.x, top: s.scrollTop - pad.current.y },
        { width: s.clientWidth, height: s.clientHeight },
        content,
      ),
      width: content.width,
    }
  }, [contentSize])

  // Lays the canvas out at `scale` and scrolls so the anchored plan point sits under (viewX, viewY)
  // of the scroller. Every frame of a zoom (buttons, keys, double-tap, pinch) is a real layout, not a
  // scaled picture: a transform drew a blurred bitmap that re-rendered sharp, with its plate text
  // re-laid out, the moment the zoom ended, which read as a jump. Reading the scroll range first lays
  // out the new width, so the scroll is never clamped to the old range (WebKit clamps otherwise).
  const applyScale = useCallback(
    (scale: number, anchor: Anchor, viewX = anchor.viewX, viewY = anchor.viewY) => {
      const s = scrollerRef.current
      const c = canvasRef.current
      if (!s || !c) return
      liveScale.current = scale
      layoutScale.current = scale
      applyPad(scale)
      // The pan layer carries the width, so its padding sits outside the whole plan at every scale.
      if (panRef.current) panRef.current.style.width = `${scale * 100}%`
      void s.scrollWidth
      // The laid-out size with its fractions, so the anchor does not drift by rounding.
      const box = c.getBoundingClientRect()
      const pin = scrollToPin(anchor, { width: box.width, height: box.height }, viewX, viewY)
      scrollExactly(s, c, pin.left + pad.current.x, pin.top + pad.current.y)
      rememberMiddle()
      drawOverview()
    },
    [applyPad, drawOverview, rememberMiddle],
  )

  // Settles a zoom: the canvas at its final width, the scroll where the last frame left it, so nothing moves.
  const layOut = useCallback(
    (scale: number) => {
      const s = scrollerRef.current
      const c = canvasRef.current
      if (!s || !c) return
      const { scrollLeft, scrollTop } = s
      liveScale.current = scale
      layoutScale.current = scale
      const before = applyPad(scale)
      if (panRef.current) panRef.current.style.width = `${scale * 100}%`
      // Reading the scroll range lays out the new width first, so the scroll below is not clamped to the old one.
      void s.scrollWidth
      s.scrollLeft = scrollLeft - before.x + pad.current.x
      s.scrollTop = scrollTop - before.y + pad.current.y
      rememberMiddle()
      drawOverview()
    },
    [applyPad, drawOverview, rememberMiddle],
  )

  // At most one resize per frame while the fingers move.
  const scheduleScale = useCallback(
    (scale: number, anchor: Anchor, viewX: number, viewY: number) => {
      pending.current = { scale, anchor, viewX, viewY }
      if (frame.current) return
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        const p = pending.current
        pending.current = null
        if (p) applyScale(p.scale, p.anchor, p.viewX, p.viewY)
      })
    },
    [applyScale],
  )

  // Applies a resize still waiting for its frame, so a release that beats the frame keeps the last movement.
  const flushPending = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    const p = pending.current
    pending.current = null
    if (p) applyScale(p.scale, p.anchor, p.viewX, p.viewY)
    return liveScale.current
  }, [applyScale])

  const applyPin = useCallback(() => {
    const s = scrollerRef.current
    const c = canvasRef.current
    const p = pendingPin.current
    if (!s || !c || !p) return
    void s.scrollWidth
    const box = c.getBoundingClientRect()
    const pin = scrollToPin(p.point, { width: box.width, height: box.height }, p.viewX, p.viewY)
    scrollExactly(s, c, pin.left + pad.current.x, pin.top + pad.current.y)
    rememberMiddle()
    drawOverview()
  }, [drawOverview, rememberMiddle])

  const hideHint = useCallback(() => {
    writeHintSeen()
    setHintVisible(false)
  }, [])

  // A gesture, button or double-tap has finished: lay out at the final scale, record it and say it once.
  const commit = useCallback(
    (scale: number, message?: string, pin?: { point: PlanPoint; viewX: number; viewY: number }) => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      pending.current = null
      const settled = scale < MIN_SCALE + SCALE_EPSILON ? MIN_SCALE : scale
      layOut(settled)
      pendingPin.current = pin ?? null
      applyPin()
      setZoom(settled)
      // animateTo adds is-zoomed directly; React won't remove it if zoom was already 1, and the class sets touch-action.
      scrollerRef.current?.classList.toggle('is-zoomed', settled > MIN_SCALE)
      setAnnouncement(message ?? `Map zoomed to ${scaleName(settled)}`)
      if (settled > MIN_SCALE) hideHint()
    },
    [applyPin, hideHint, layOut],
  )

  // Runs after the commit's render, when the zoomed class and its end margin are in place.
  useLayoutEffect(() => {
    applyPin()
    pendingPin.current = null
  }, [zoom, applyPin])

  // Buttons, keys, double-tap and "Centre on booth": a short eased zoom around one plan point, which
  // also slides from where it is on screen to `to`. Instant under reduced motion.
  const animateTo = useCallback((
    target: number,
    anchor: Anchor,
    to = { x: anchor.viewX, y: anchor.viewY },
    message?: string,
    // The end is pinned from the plan point once laid out, so the anchor lands exactly at `to`.
    pin: { point: PlanPoint; viewX: number; viewY: number } = { point: anchor, viewX: to.x, viewY: to.y },
  ) => {
    cancelAnimationFrame(animation.current)
    cancelAnimationFrame(glide.current)
    const from = liveScale.current
    const still = Math.abs(target - from) < SCALE_EPSILON && Math.hypot(to.x - anchor.viewX, to.y - anchor.viewY) < 1
    if (reducedMotion() || still) {
      applyScale(target, anchor, to.x, to.y)
      commit(target, message, pin)
      return
    }
    // Zooming in, the zoomed edge fade (map.css) shows from the first frame rather than appearing at the end.
    if (target > MIN_SCALE + SCALE_EPSILON) scrollerRef.current?.classList.add('is-zoomed')
    const startedAt = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / ZOOM_ANIMATION_MS)
      const eased = 1 - (1 - progress) ** 3
      const x = anchor.viewX + (to.x - anchor.viewX) * eased
      const y = anchor.viewY + (to.y - anchor.viewY) * eased
      applyScale(from + (target - from) * eased, anchor, x, y)
      if (progress < 1) animation.current = requestAnimationFrame(step)
      else commit(target, message, pin)
    }
    animation.current = requestAnimationFrame(step)
  }, [applyScale, commit])

  // A flicked one-finger pan carries on and slows to a stop, as a native scroll would have.
  // Stops at the edge of the scroll range; none under reduced motion.
  const startGlide = useCallback(
    (velocity: { x: number; y: number }) => {
      const s = scrollerRef.current
      const c = canvasRef.current
      if (!s || !c || reducedMotion()) return
      let v = velocity
      let at = { left: s.scrollLeft, top: s.scrollTop }
      let last = performance.now()
      const step = (now: number) => {
        const dt = Math.min(GLIDE_MAX_STEP_MS, now - last)
        last = now
        const decay = Math.exp(-dt / GLIDE_TIME_CONSTANT_MS)
        v = { x: v.x * decay, y: v.y * decay }
        const max = { left: s.scrollWidth - s.clientWidth, top: s.scrollHeight - s.clientHeight }
        const next = clampScroll({ left: at.left - v.x * dt, top: at.top - v.y * dt }, max)
        const moved = Math.hypot(next.left - at.left, next.top - at.top)
        at = next
        scrollExactly(s, c, next.left, next.top)
        if (moved > GLIDE_STOP_PX && Math.hypot(v.x, v.y) > GLIDE_MIN_SPEED) glide.current = requestAnimationFrame(step)
      }
      glide.current = requestAnimationFrame(step)
    },
    [],
  )

  useImperativeHandle(ref, () => ({
    centreOnBooth: (boothId: string) => {
      const s = scrollerRef.current
      const booth = booths.find((b) => b.id === boothId)
      if (!s || !booth) return
      const content = contentSize()
      const fit = { width: content.width / liveScale.current, height: content.height / liveScale.current }
      const view = { width: s.clientWidth, height: s.clientHeight }
      const { scale, point } = centreOnPlate(boothPosition(booth, floorLayout), liveScale.current, fit, view)
      // Starts from where the plate is now, so it visibly travels to the middle as the map zooms.
      const anchor = {
        ...point,
        viewX: point.planX * content.width + pad.current.x - s.scrollLeft,
        viewY: point.planY * content.height + pad.current.y - s.scrollTop,
      }
      const middle = { x: view.width / 2, y: view.height / 2 }
      animateTo(scale, anchor, middle, `Map zoomed to ${scaleName(scale)}, booth ${booth.code} in the middle`, { point, viewX: middle.x, viewY: middle.y })
    },
  }))

  // Buttons and keys zoom around the selected booth, brought to the middle so it stays in view,
  // or around the middle of what is on screen when nothing is selected.
  const buttonAnchor = (): Anchor => {
    const s = scrollerRef.current
    const c = canvasRef.current
    if (!s || !c) return anchorAt(0, 0)
    const view = { width: s.clientWidth, height: s.clientHeight }
    const selected = c.querySelector('.floor-map__booth.is-highlighted')
    if (!selected) {
      const point = viewCentre({ left: s.scrollLeft - pad.current.x, top: s.scrollTop - pad.current.y }, view, contentSize())
      return { ...point, viewX: view.width / 2, viewY: view.height / 2 }
    }
    const br = selected.getBoundingClientRect()
    const cr = c.getBoundingClientRect()
    const sr = s.getBoundingClientRect()
    // Starts from where the plate is now, so it travels to the middle as the map zooms.
    return {
      planX: (br.left + br.width / 2 - cr.left) / cr.width,
      planY: (br.top + br.height / 2 - cr.top) / cr.height,
      viewX: br.left + br.width / 2 - sr.left,
      viewY: br.top + br.height / 2 - sr.top,
    }
  }
  const viewMiddlePoint = () => {
    const s = scrollerRef.current
    return s ? { x: s.clientWidth / 2, y: s.clientHeight / 2 } : undefined
  }
  const zoomByButton = (factor: number) => {
    animateTo(clampScale(liveScale.current * factor, liveScale.current), buttonAnchor(), viewMiddlePoint())
  }

  // Touch, on iOS Safari and Chromium alike: two fingers pinch around their midpoint, which the map
  // follows as they move; one finger pans the zoomed map. The map scroller does not scroll natively
  // (map.css), so every movement is a scroll this code writes, in the same frame as the zoom it goes
  // with: no native scroll or momentum can race it and move the map after the fingers lift. Whenever
  // the number of fingers changes, the anchor is read again under the fingers still down, so lifting
  // one finger of a pinch carries on as a pan from where that finger is, with no jump. All listeners
  // are non-passive so preventDefault reaches Safari before it commits a pinch to page zoom.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    // This touch sequence moves the map: it is zoomed, or a second finger made it a pinch.
    let owned = false
    let pinched = false
    let pinchStart: { distance: number; scale: number; anchor: Anchor } | null = null
    let panStart: { scale: number; anchor: Anchor } | null = null
    let lastMiddle = { x: 0, y: 0 }
    let samples: PanSample[] = []
    const twoFingers = (list: TouchList) => {
      const [a, b] = [list[0], list[1]]
      return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) }
    }
    const rebase = (list: TouchList) => {
      // A frame still waiting would be applied against the old anchor; apply it first.
      flushPending()
      pinchStart = null
      panStart = null
      samples = []
      if (list.length >= 2) {
        const m = twoFingers(list)
        // At one point two touches give no distance; the next move starts the pinch.
        if (m.distance >= MIN_PINCH_DISTANCE_PX) pinchStart = { distance: m.distance, scale: liveScale.current, anchor: anchorAt(m.x, m.y) }
        lastMiddle = { x: m.x, y: m.y }
      } else if (list.length === 1) {
        panStart = { scale: liveScale.current, anchor: anchorAt(list[0].clientX, list[0].clientY) }
        lastMiddle = { x: list[0].clientX, y: list[0].clientY }
      }
    }
    const onTouchStart = (e: TouchEvent) => {
      touchCount.current = e.touches.length
      cancelAnimationFrame(glide.current)
      if (tapDrag.current) return
      if (e.touches.length >= 2) {
        e.preventDefault()
        cancelAnimationFrame(animation.current)
        owned = true
        pinched = true
        lastTap.current = null
      } else if (liveScale.current > MIN_SCALE + SCALE_EPSILON) {
        // A press is a tap until it moves, so its click still selects a plate; only the moves are held.
        cancelAnimationFrame(animation.current)
        owned = true
      }
      if (owned) rebase(e.touches)
    }
    const onTouchMove = (e: TouchEvent) => {
      if (tapDrag.current) {
        e.preventDefault()
        return
      }
      if (!owned) return
      e.preventDefault()
      const r = scroller.getBoundingClientRect()
      if (e.touches.length >= 2) {
        if (!pinchStart) rebase(e.touches)
        const start = pinchStart
        if (!start) return
        const m = twoFingers(e.touches)
        lastMiddle = { x: m.x, y: m.y }
        scheduleScale(pinchScale(start.scale, start.distance, m.distance, MIN_SCALE, MAX_SCALE), start.anchor, m.x - r.left, m.y - r.top)
      } else if (panStart && e.touches.length === 1) {
        const t = e.touches[0]
        lastMiddle = { x: t.clientX, y: t.clientY }
        const now = performance.now()
        samples.push({ t: now, x: t.clientX, y: t.clientY })
        while (samples.length > 1 && now - samples[0].t > GLIDE_SAMPLE_MS) samples.shift()
        scheduleScale(panStart.scale, panStart.anchor, t.clientX - r.left, t.clientY - r.top)
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      touchCount.current = e.touches.length
      if (!owned) return
      if (e.touches.length > 0) {
        rebase(e.touches)
        return
      }
      const flick = flickVelocity(samples, performance.now(), GLIDE_SAMPLE_MS, GLIDE_MIN_SPEED)
      owned = false
      pinchStart = null
      panStart = null
      samples = []
      const scale = flushPending()
      if (!pinched) {
        if (flick) startGlide(flick)
        return
      }
      pinched = false
      // A pinch let go a hair above fit eases the last bit down to fit rather than snapping there.
      if (scale !== MIN_SCALE && scale < MIN_SCALE + SCALE_EPSILON) animateTo(MIN_SCALE, anchorAt(lastMiddle.x, lastMiddle.y))
      else commit(scale)
    }
    const onClickCapture = (e: MouseEvent) => {
      if (!swallowClick.current) return
      swallowClick.current = false
      e.preventDefault()
      e.stopPropagation()
    }
    // WebKit gesture events: always cancelled, so iOS Safari never zooms the page from the map. They zoom
    // the map only with no finger down, which is a Mac trackpad pinch in Safari (iOS pinches are touches,
    // handled above, since iOS gesture events carry no position to anchor on).
    let start: { scale: number; anchor: Anchor } | null = null
    const view = (g: WebKitGestureEvent, fallback: Anchor) => {
      const r = scroller.getBoundingClientRect()
      return Number.isFinite(g.clientX) && Number.isFinite(g.clientY)
        ? { x: g.clientX - r.left, y: g.clientY - r.top }
        : { x: fallback.viewX, y: fallback.viewY }
    }
    const onStart = (e: Event) => {
      e.preventDefault()
      if (touchCount.current > 0) return
      cancelAnimationFrame(animation.current)
      const g = e as WebKitGestureEvent
      const r = scroller.getBoundingClientRect()
      const x = Number.isFinite(g.clientX) ? g.clientX : r.left + r.width / 2
      const y = Number.isFinite(g.clientY) ? g.clientY : r.top + r.height / 2
      start = { scale: liveScale.current, anchor: anchorAt(x, y) }
    }
    const onChange = (e: Event) => {
      e.preventDefault()
      if (!start) return
      const g = e as WebKitGestureEvent
      const v = view(g, start.anchor)
      scheduleScale(clampScale(start.scale * g.scale, liveScale.current), start.anchor, v.x, v.y)
    }
    const onEnd = (e: Event) => {
      e.preventDefault()
      if (!start) return
      const g = e as WebKitGestureEvent
      const v = view(g, start.anchor)
      const final = clampScale(start.scale * g.scale, liveScale.current)
      cancelAnimationFrame(frame.current)
      frame.current = 0
      applyScale(final, start.anchor, v.x, v.y)
      start = null
      commit(final)
    }
    // Wheel and trackpad. Ctrl (a trackpad pinch in Chromium and Firefox, or Ctrl and the wheel) zooms
    // around the cursor; a plain wheel or two-finger swipe pans the zoomed map. At fit, or once the map
    // cannot move further that way, the wheel is left to scroll the page.
    let wheelCommit = 0
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroller.clientHeight : 1
      if (e.ctrlKey) {
        e.preventDefault()
        cancelAnimationFrame(animation.current)
        cancelAnimationFrame(glide.current)
        const from = flushPending()
        const r = scroller.getBoundingClientRect()
        const scale = clampScale(from * Math.exp(-e.deltaY * unit * WHEEL_ZOOM_PER_PX), from)
        scheduleScale(scale, anchorAt(e.clientX, e.clientY), e.clientX - r.left, e.clientY - r.top)
        window.clearTimeout(wheelCommit)
        wheelCommit = window.setTimeout(() => commit(flushPending()), WHEEL_SETTLE_MS)
        return
      }
      if (liveScale.current <= MIN_SCALE + SCALE_EPSILON) return
      const { scrollLeft, scrollTop } = scroller
      scroller.scrollLeft = scrollLeft + e.deltaX * unit
      scroller.scrollTop = scrollTop + e.deltaY * unit
      if (scroller.scrollLeft !== scrollLeft || scroller.scrollTop !== scrollTop) e.preventDefault()
    }
    const passive = { passive: false }
    scroller.addEventListener('touchstart', onTouchStart, passive)
    scroller.addEventListener('touchmove', onTouchMove, passive)
    scroller.addEventListener('touchend', onTouchEnd, passive)
    scroller.addEventListener('touchcancel', onTouchEnd, passive)
    scroller.addEventListener('wheel', onWheel, passive)
    scroller.addEventListener('gesturestart', onStart, passive)
    scroller.addEventListener('gesturechange', onChange, passive)
    scroller.addEventListener('gestureend', onEnd, passive)
    scroller.addEventListener('click', onClickCapture, true)
    return () => {
      window.clearTimeout(wheelCommit)
      scroller.removeEventListener('click', onClickCapture, true)
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchmove', onTouchMove)
      scroller.removeEventListener('touchend', onTouchEnd)
      scroller.removeEventListener('touchcancel', onTouchEnd)
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('gesturestart', onStart)
      scroller.removeEventListener('gesturechange', onChange)
      scroller.removeEventListener('gestureend', onEnd)
    }
    // Bound once per mounted scroller: every helper above is stable, and the handlers read refs, not render state.
  }, [interactive, anchorAt, animateTo, applyScale, commit, flushPending, scheduleScale, startGlide])

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      cancelAnimationFrame(animation.current)
      cancelAnimationFrame(glide.current)
    },
    [],
  )

  // Scrolling (a pan, a glide, a focused plate brought into view) only reads: it moves the overview rectangle and notes the middle.
  // A resize (rotation, split view) puts the noted middle back in the middle, since the canvas width is a
  // percentage of the scroller. The scroll the browser fires while clamping during that resize is ignored:
  // it comes from the new width, before the observer has run.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    // Reads before the overview write, so a scroll never forces a second layout in its frame.
    const onScroll = () => {
      const own = ownScroll.current
      ownScroll.current = null
      const echo = own !== null && own.left === scroller.scrollLeft && own.top === scroller.scrollTop
      const noted = viewMiddle.current
      if (!echo && (!noted || Math.abs(noted.width - contentSize().width) < 0.5)) rememberMiddle()
      drawOverview()
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const noted = viewMiddle.current
            const content = contentSize()
            if (noted && Math.abs(noted.width - content.width) >= 0.5 && liveScale.current > MIN_SCALE) {
              applyPad(liveScale.current)
              const pin = scrollToPin(noted.point, content, scroller.clientWidth / 2, scroller.clientHeight / 2)
              scroller.scrollLeft = pin.left + pad.current.x
              scroller.scrollTop = pin.top + pad.current.y
              ownScroll.current = { left: scroller.scrollLeft, top: scroller.scrollTop }
              // Keeps the intended middle, not the clamped one, so growing back restores it.
              viewMiddle.current = { point: noted.point, width: content.width }
            } else {
              rememberMiddle()
            }
            drawOverview()
          })
    observer?.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [interactive, applyPad, contentSize, drawOverview, rememberMiddle])

  // Overview tap: centre the map on that point of the plan, at the current zoom.
  const onOverviewClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const s = scrollerRef.current
    if (!s) return
    const r = e.currentTarget.getBoundingClientRect()
    const point = { planX: (e.clientX - r.left) / r.width, planY: (e.clientY - r.top) / r.height }
    const view = { width: s.clientWidth, height: s.clientHeight }
    const pinned = scrollToPin(point, contentSize(), view.width / 2, view.height / 2)
    const target = {
      left: Math.min(s.scrollWidth - view.width, Math.max(0, pinned.left + pad.current.x)),
      top: Math.min(s.scrollHeight - view.height, Math.max(0, pinned.top + pad.current.y)),
    }
    s.scrollTo({ ...target, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  // Every pointer type: tap, double-tap, and double-tap-and-drag. Pinch and pan are the touch handlers above.
  const isSecondTap = (x: number, y: number) => {
    const prev = lastTap.current
    return Boolean(prev && performance.now() - prev.t < DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) < DOUBLE_TAP_SLOP_PX)
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    press.current = { x: e.clientX, y: e.clientY, moved: false }
    // A dragged press fires no click, so a pending swallow must not outlive it and eat the next real tap.
    swallowClick.current = false
    pointers.current.add(e.pointerId)
    // A press while another is down is part of a pinch: neither finger's lift is then a tap.
    if (pointers.current.size > 1) multiPress.current = true
    if (pointers.current.size === 1 && !tapDrag.current && isSecondTap(e.clientX, e.clientY)) {
      // Second tap of a double-tap, on a plate or not: this press zooms, and its click is swallowed.
      window.clearTimeout(pendingClear.current)
      lastTap.current = null
      swallowClick.current = true
      cancelAnimationFrame(animation.current)
      tapDrag.current = { pointerId: e.pointerId, startY: e.clientY, scale: liveScale.current, anchor: anchorAt(e.clientX, e.clientY), moved: false }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // A pointer the browser no longer tracks cannot be captured; the drag still works over the map.
      }
      return
    }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_MOVE_PX) p.moved = true
    const drag = tapDrag.current
    if (drag && drag.pointerId === e.pointerId) {
      const dy = e.clientY - drag.startY
      if (Math.abs(dy) > TAP_MOVE_PX) drag.moved = true
      if (!drag.moved) return
      // Down zooms in, up zooms out, like Apple Maps.
      const scale = clampScale(drag.scale * 2 ** (dy / TAP_DRAG_PX_PER_DOUBLING), liveScale.current)
      scheduleScale(scale, drag.anchor, drag.anchor.viewX, drag.anchor.viewY)
    }
  }
  // If the scroller loses its captured tap-drag pointer without a release, end the zoom there,
  // so panning is not blocked afterwards. Implicit captures on other elements are ignored.
  const onLostCapture = (e: PointerEvent<HTMLDivElement>) => {
    const drag = tapDrag.current
    if (!drag || drag.pointerId !== e.pointerId || e.target !== e.currentTarget) return
    tapDrag.current = null
    press.current = null
    commit(flushPending())
  }

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    const multi = multiPress.current
    if (pointers.current.size === 0) multiPress.current = false
    const drag = tapDrag.current
    if (drag && drag.pointerId === e.pointerId) {
      tapDrag.current = null
      press.current = null
      if (drag.moved || e.type !== 'pointerup') commit(flushPending())
      // A plain double-tap: in to 2x, or back out to fit.
      else animateTo(liveScale.current > MIN_SCALE + SCALE_EPSILON ? MIN_SCALE : DOUBLE_TAP_SCALE, anchorAt(e.clientX, e.clientY))
      return
    }
    const p = press.current
    press.current = null
    // A tap (on a plate it is also that booth's click) may be the first half of a double-tap.
    const tapped = e.type === 'pointerup' && p && !p.moved && !multi
    lastTap.current = tapped ? { t: performance.now(), x: e.clientX, y: e.clientY } : null
    // A tap on empty map (not a plate, not a control) deselects, once no second tap has followed.
    if (tapped && highlightedBoothId && onClearSelection && !(e.target as Element).closest('.floor-map__booth, button')) {
      window.clearTimeout(pendingClear.current)
      pendingClear.current = window.setTimeout(onClearSelection, DOUBLE_TAP_MS)
    }
  }

  const canvas = (
    <div
      className="floor-map__canvas"
      ref={canvasRef}
      style={{ ...(floorLayout && plateRadius(floorLayout)), aspectRatio }}
    >
      {floorLayout ? (
        <DrawnPlan layout={floorLayout} label={interactive ? description : null} />
      ) : (
        !imageFailed &&
        floorPlanUrl && (
          <img
            className="floor-map__plan floor-map__plan--image"
            src={floorPlanUrl}
            alt={interactive ? description : ''}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget
              if (img.naturalWidth && img.naturalHeight) setImageAspectRatio(`${img.naturalWidth} / ${img.naturalHeight}`)
            }}
            onError={() => setImageFailed(true)}
          />
        )
      )}
      <BoothPlates booths={booths} floorLayout={floorLayout} highlightedBoothId={highlightedBoothId} onSelectBooth={onSelectBooth} />
    </div>
  )

  if (!interactive) return <div className="floor-map floor-map--preview">{canvas}</div>

  const canZoomIn = zoom < MAX_SCALE - SCALE_EPSILON
  const canZoomOut = zoom > MIN_SCALE + SCALE_EPSILON

  // The keyboard twin of the buttons: + or = in, - out, 0 back to fit. Browser zoom shortcuts (Ctrl, Cmd) pass through.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape' && highlightedBoothId && onClearSelection) {
      e.preventDefault()
      onClearSelection()
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      if (canZoomIn) zoomByButton(BUTTON_STEP)
    } else if (e.key === '-' || e.key === '\u2212') {
      e.preventDefault()
      if (canZoomOut) zoomByButton(1 / BUTTON_STEP)
    } else if (e.key === '0') {
      e.preventDefault()
      if (canZoomOut) animateTo(MIN_SCALE, buttonAnchor(), viewMiddlePoint())
    } else if (canZoomOut && e.key in ARROW_PAN && e.target === e.currentTarget) {
      // The map does not scroll natively (map.css), so the arrows pan it, as they scrolled it before.
      e.preventDefault()
      const [dx, dy] = ARROW_PAN[e.key as keyof typeof ARROW_PAN]
      const s = e.currentTarget
      s.scrollBy({ left: dx * KEY_PAN_PX, top: dy * KEY_PAN_PX, behavior: reducedMotion() ? 'auto' : 'smooth' })
    }
  }

  return (
    <div className={`floor-map${pageHidden ? ' is-page-hidden' : ''}`}>
      {/* Above the plan, in the page's flow, so it can never sit under a booth plate. */}
      {!floorLayout && (imageFailed || !floorPlanUrl) && <p className="floor-map__missing">Floor plan unavailable. Booth spots are still shown.</p>}
      <div className="floor-map__frame">
        {/* Focusable so a keyboard can scroll it when zoomed; the booths inside are the buttons. */}
        <div
          className={`floor-map__scroller${canZoomOut ? ' is-zoomed' : ''}`}
          ref={scrollerRef}
          style={{ aspectRatio }}
          // The shell's pull-to-refresh and edge swipe-back stay out of the map, which owns its own pans.
          data-no-pull=""
          data-no-swipe-back=""
          tabIndex={0}
          role="region"
          aria-label={`Floor plan, zoomed to ${scaleName(zoom)}`}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onLostCapture}
        >
          <div className="floor-map__pan" ref={panRef} style={{ width: `${zoom * 100}%` }}>
            {canvas}
          </div>
        </div>
      </div>
      <div className="floor-map__toolbar">
        {hintVisible && (
          <p className="floor-map__hint">
            Pinch, double-tap, or use the + and − buttons to zoom.
            <button
              type="button"
              className="floor-map__hint-dismiss"
              onClick={() => {
                hideHint()
                // The button goes away with the tip, so focus moves to the map it described.
                scrollerRef.current?.focus()
              }}
            >
              Got it
            </button>
          </p>
        )}
        {/* Where you are in the hall, while zoomed. Hidden from assistive tech, which hears the zoom level from the
            region's name; the keyboard pans the region itself. Tapping it recentres there. It sits in the toolbar
            under the plan, so it never covers a table. */}
        {canZoomOut && (
          <div className="floor-map__overview" aria-hidden="true" style={{ aspectRatio }} onClick={onOverviewClick}>
            {floorLayout && (
              <svg className="floor-map__overview-plan" viewBox={`${-ROW_LABEL_GUTTER} 0 ${drawnWidth(floorLayout)} ${floorLayout.height}`}>
                <path d={wallOutline(floorLayout)} />
              </svg>
            )}
            <div
              className="floor-map__overview-view"
              ref={(node) => {
                overviewViewRef.current = node
                drawOverview()
              }}
            />
          </div>
        )}
        {/* The accessible alternative to pinch and double-tap, under the plan so it never covers a table. */}
        <div className="floor-map__zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            className="floor-map__zoom-btn"
            aria-label="Zoom in"
            aria-disabled={!canZoomIn}
            onClick={() => {
              if (!canZoomIn) return
              zoomByButton(BUTTON_STEP)
            }}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="floor-map__zoom-btn"
            aria-label="Zoom out"
            aria-disabled={!canZoomOut}
            onClick={() => {
              if (!canZoomOut) return
              zoomByButton(1 / BUTTON_STEP)
            }}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      <ul className="floor-map__legend" role="list">
        {highlightedBoothId && (
          <li>
            <span className="legend-swatch legend-swatch--highlight" aria-hidden="true" />
            Selected<span className="visually-hidden"> booth</span>
          </li>
        )}
        {/* Short words so the key stays on one line on a phone; the full meaning is read out. */}
        <li>
          <span className="legend-swatch" aria-hidden="true" />
          Online<span className="visually-hidden"> ordering</span>
        </li>
        <li>
          <span className="legend-swatch legend-swatch--dashed" aria-hidden="true" />
          In person<span className="visually-hidden"> only, or online orders paused</span>
        </li>
        <li>
          <span className="legend-swatch legend-swatch--empty" aria-hidden="true" />
          Empty<span className="visually-hidden"> table</span>
        </li>
      </ul>
    </div>
  )
}
