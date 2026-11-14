/**
 * FR-26: shown while a screen reads the saved catalog because the refresh failed or is slow.
 * One wording on every discover screen; stock is what goes stale first. "Try again" is the
 * pointer and keyboard twin of pull to refresh: it runs the same catalog reload.
 */
const SAVED_COPY_NOTE = 'Showing saved info. Stock may have changed.'

export function SavedCopyNote({ show, onRetry }: { show: boolean; onRetry: () => void }) {
  if (!show) return null
  return (
    <p className="note saved-note">
      {SAVED_COPY_NOTE}
      <button type="button" className="saved-note__retry" onClick={onRetry}>
        Try again
      </button>
    </p>
  )
}
