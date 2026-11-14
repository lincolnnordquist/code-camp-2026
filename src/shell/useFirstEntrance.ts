import { useEffect, useState } from 'react'

const SEEN_KEY = 'shell.entered.'

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * A list's entrance, played once per session for each list: the first time its data renders, the
 * items rise in (index.css, [data-entrance]). Never again on a tab return, Back or a reload (the
 * mark is in sessionStorage), and never under reduced motion. It only animates opacity and
 * transform, so focus and taps work from the first frame.
 *
 * Spread the result on the list element: `<ul {...useFirstEntrance('wallet:open', ready)}>`.
 * `key` names the list (route plus list); `ready` is true once real items (not skeletons) render.
 */
export function useFirstEntrance(key: string, ready: boolean): { 'data-entrance'?: '' } {
  // Null until the data first renders, then decided once. Set during render, so the attribute is on
  // the items' first paint: no flash of them at rest.
  const [play, setPlay] = useState<boolean | null>(null)
  if (ready && play === null) setPlay(!prefersReducedMotion() && !seenThisSession(key))

  useEffect(() => {
    if (!play) return
    try {
      sessionStorage.setItem(SEEN_KEY + key, '1')
    } catch {
      // seenThisSession already skipped the entrance when storage cannot be read.
    }
  }, [play, key])

  return play ? { 'data-entrance': '' } : {}
}

/** Without storage the entrance would replay on every visit, so it counts as seen. */
function seenThisSession(key: string): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY + key) !== null
  } catch {
    return true
  }
}
