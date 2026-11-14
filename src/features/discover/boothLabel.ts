import type { Booth } from '../../shared/types'
import { boothModeBadges, pausedBoothBadge } from '../../shared/ui/labels'

/** A paused booth must never read "Reserve online" or "Pay online" (FR-05). */
export function isPaused(booth: Booth) {
  return booth.orderingPaused && booth.mode !== 'discovery'
}

export function boothBadgeLabel(booth: Booth) {
  return isPaused(booth) ? pausedBoothBadge.label : boothModeBadges[booth.mode].label
}

export function boothBadgeClass(booth: Booth) {
  return isPaused(booth) ? 'mode mode--paused' : `mode mode--${booth.mode}`
}
