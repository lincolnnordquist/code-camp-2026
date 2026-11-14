const STEP_ICON_PATHS = {
  minus: 'M5 12h14',
  plus: 'M5 12h14M12 5v14',
  remove: 'M4 7h16M10 4h4M6 7l1 13h10l1-13',
} as const

/** A quantity stepper's icon (the cart's lines, the product sheet): minus, plus, or the bin that removes at one. */
export function StepIcon({ kind }: { kind: keyof typeof STEP_ICON_PATHS }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path
        d={STEP_ICON_PATHS[kind]}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
