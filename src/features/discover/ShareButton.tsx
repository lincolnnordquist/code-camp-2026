import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Snackbar } from '../../shared/ui/Snackbar'
import { shareOrCopy, type ShareData } from './share'
import './share.css'

/** How long "Link copied" stays up. */
const TOAST_MS = 2500

const MESSAGES = { copied: 'Link copied', failed: "Couldn't copy the link" } as const

export function ShareIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
    </svg>
  )
}

/**
 * A Share control: the system share sheet, or the link copied with a short "Link copied" toast.
 * The toast is said once through a status line that is always mounted, and shown on its own layer
 * over the page and any sheet.
 */
export function ShareButton({ data, className, label, children }: { data: () => ShareData; className: string; label?: string; children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  const share = async () => {
    const outcome = await shareOrCopy(data())
    if (outcome === 'copied' || outcome === 'failed') setToast({ text: MESSAGES[outcome], at: Date.now() })
  }

  return (
    <>
      <button type="button" className={className} aria-label={label} onClick={() => void share()}>
        {children}
      </button>
      {createPortal(
        <div className="share-toast">
          <p className="visually-hidden" role="status">
            {toast?.text ?? ''}
          </p>
          {toast && (
            <div key={toast.at} className="share-toast__snackbar" aria-hidden="true">
              <Snackbar>{toast.text}</Snackbar>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
