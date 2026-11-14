import type { CSSProperties, ReactNode } from 'react'

type Size = number | string
const length = (v: Size | undefined) => (typeof v === 'number' ? `${v}px` : v)

interface SkeletonProps {
  /** Defaults to the full width of the container. */
  width?: Size
  /** Defaults to one line of body text. */
  height?: Size
  /** The radius token of the thing it stands in for. */
  shape?: 'control' | 'card' | 'plate' | 'pill' | 'circle'
  className?: string
}

/**
 * One placeholder block in the shape of the content that is on its way. It is
 * decorative: the screen's loading text (inside SkeletonGroup) is what a
 * screen reader hears.
 */
export function Skeleton({ width, height, shape = 'control', className }: SkeletonProps) {
  const style: CSSProperties = { inlineSize: length(width), blockSize: length(height) }
  return <span className={`skeleton skeleton--${shape}${className ? ` ${className}` : ''}`} style={style} aria-hidden="true" />
}

/** Lines of text; the last one is shorter, as a paragraph ends. */
export function SkeletonText({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <span className={`skeleton-text${className ? ` ${className}` : ''}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 && lines > 1 ? '60%' : undefined} />
      ))}
    </span>
  )
}

/**
 * A screen's loading state: the placeholders, plus the loading sentence for
 * screen readers. Like `.screen-state--loading`, it appears only when the load
 * takes longer than 150 ms, so a quick load shows nothing at all.
 */
export function SkeletonGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`skeleton-group screen-state--loading${className ? ` ${className}` : ''}`}>
      {/* A polite status, so "Loading..." is read when the placeholders appear, not only if found. */}
      <p className="visually-hidden" role="status">
        {label}
      </p>
      {children}
    </div>
  )
}
