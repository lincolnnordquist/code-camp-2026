/**
 * The one catalog field the discover screens use that the shared contract does
 * not carry yet: the event's drawn floor layout. Remove the fallback when
 * `Event.floorLayout` exists. The accessor reads `event.floorLayout` first, so it picks the
 * field up as soon as Data & vendor adds it. Until then it reads a layout the
 * host app may provide by event id, and without either the map uses the floor
 * plan image.
 */
import type { Event } from '../../shared/types'

/** A rectangle in floor-plan units (the layout's own coordinate space). */
export interface PlanRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The room drawn by the app instead of a floor-plan image. Tables form a grid
 * of columns lettered left to right and rows numbered from the back (the
 * kitchen, at the bottom of the drawing) to the front (the stage, at the top),
 * so a booth's code, column letter then row number ("D5"), locates its table.
 */
export interface FloorLayout {
  width: number
  height: number
  /** The wall outline as points, clockwise; a recess (the kitchen) is part of the outline. */
  walls: Array<[number, number]>
  /** Column letters, left to right. */
  columns: string[]
  /** How many rows, numbered 1 at the back to `rows` at the front. */
  rows: number
  /** Top-left of the first column's table in the top (front) row, row `rows`. */
  firstTable: { x: number; y: number }
  tableSize: { width: number; height: number }
  /** Distance from one table to the next, across a row (x) and from row to row (y). */
  pitch: { x: number; y: number }
  areas: Array<PlanRect & { label: string; kind: 'stage' | 'kitchen' | 'other' }>
}

/** Plan y of the top edge of a row's tables: row 1 is the bottom (back) row. */
export function rowTop(layout: FloorLayout, row: number) {
  return layout.firstTable.y + (layout.rows - row) * layout.pitch.y
}

/** Extras keyed by event id. */
export interface CatalogExtras {
  events?: Record<string, { floorLayout?: unknown }>
}

let extras: CatalogExtras = {}

/** Called once at startup by a host app that keeps the layout elsewhere. */
export function provideCatalogExtras(source: CatalogExtras) {
  extras = source
}

type WithEventExtras = Event & { floorLayout?: unknown }

/**
 * Remove the extras lookup when Event.floorLayout exists; keep the check, since
 * `floor_layout` is free-form JSON in the database. The map only draws a
 * layout whose every field it needs is present and finite, and otherwise
 * falls back to the floor plan image instead of failing.
 */
export function eventFloorLayout(event: Event): FloorLayout | undefined {
  const layout = (event as WithEventExtras).floorLayout ?? extras.events?.[event.id]?.floorLayout
  return isFloorLayout(layout) ? layout : undefined
}

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const isPoint = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(isNumber)
const isRect = (r: unknown) => {
  const v = r as Record<string, unknown> | null
  return typeof v === 'object' && v !== null && [v.x, v.y, v.width, v.height].every(isNumber)
}

function isFloorLayout(value: unknown): value is FloorLayout {
  const v = value as Partial<FloorLayout> | null
  if (typeof v !== 'object' || v === null) return false
  return (
    isNumber(v.width) &&
    v.width > 0 &&
    isNumber(v.height) &&
    v.height > 0 &&
    Array.isArray(v.walls) &&
    v.walls.length >= 3 &&
    v.walls.every(isPoint) &&
    Array.isArray(v.columns) &&
    v.columns.length > 0 &&
    v.columns.every((c) => typeof c === 'string' && c.length > 0) &&
    isNumber(v.rows) &&
    Number.isInteger(v.rows) &&
    v.rows > 0 &&
    isNumber(v.firstTable?.x) &&
    isNumber(v.firstTable?.y) &&
    isNumber(v.tableSize?.width) &&
    isNumber(v.tableSize?.height) &&
    isNumber(v.pitch?.x) &&
    isNumber(v.pitch?.y) &&
    Array.isArray(v.areas) &&
    v.areas.every((a) => isRect(a) && typeof a.label === 'string')
  )
}
