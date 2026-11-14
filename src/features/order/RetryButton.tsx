import { useState } from 'react'

/**
 * "Try again" for a failed or stale read: the same refresh the pull-to-refresh runs, for anyone who
 * cannot or does not know to pull (WCAG 2.5.1, 2.1.1). aria-disabled while it runs, so focus stays.
 */
export function RetryButton({
  refresh,
  onDone = () => undefined,
  className,
  label = 'Try again',
  busyLabel = 'Trying again...',
  iconLabel,
}: {
  refresh: () => Promise<boolean>
  onDone?: (ok: boolean) => void
  className: string
  label?: string
  busyLabel?: string
  /**
   * Makes it a quiet icon button with this name, for where pulling already does the same at rest;
   * the icon turns while it works. Error screens keep the visible words, their clear next step.
   */
  iconLabel?: string
}) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className={className}
      aria-disabled={busy}
      aria-label={iconLabel}
      aria-busy={iconLabel ? busy : undefined}
      onClick={() => {
        if (busy) return
        setBusy(true)
        void refresh().then((ok) => {
          setBusy(false)
          onDone(ok)
        })
      }}
    >
      {iconLabel ? (
        <svg className={busy ? 'retry-icon is-spinning' : 'retry-icon'} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : busy ? (
        busyLabel
      ) : (
        label
      )}
    </button>
  )
}
