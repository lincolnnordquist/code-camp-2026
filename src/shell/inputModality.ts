/**
 * The last kind of input, on <html> as data-input="pointer" | "keyboard", so a screen that returns
 * focus (a sheet closing onto its card) can do it without the keyboard focus ring after a tap. iOS
 * WebKit draws :focus-visible for script focus even after touch. Focus itself always moves: keyboard
 * and screen reader users need it; only the ring is held back until the next key press.
 */
let installed = false

export function installInputModality() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const root = document.documentElement
  const mark = (input: 'pointer' | 'keyboard') => {
    if (root.dataset.input !== input) root.dataset.input = input
  }
  window.addEventListener('pointerdown', () => mark('pointer'), { capture: true, passive: true })
  window.addEventListener(
    'keydown',
    (e) => {
      // A shortcut chord is not keyboard navigation.
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // Typing in a field is not either: an on-screen keyboard sends key events too, and the field the
      // finger focused would gain the keyboard ring. Tab out of the field still counts.
      const target = e.target as HTMLElement | null
      if (e.key !== 'Tab' && target?.closest?.('input, textarea, select, [contenteditable]')) return
      mark('keyboard')
    },
    { capture: true },
  )
}

/** Moves focus without scrolling, and without the focus ring when the last input was a pointer. */
export function focusQuietly(el: HTMLElement, { preventScroll = true }: { preventScroll?: boolean } = {}) {
  const pointer = document.documentElement.dataset.input === 'pointer'
  // focusVisible is newer than the DOM typings; engines without it ignore it, and the CSS backstop holds.
  el.focus({ preventScroll, ...(pointer && { focusVisible: false }) } as FocusOptions)
}
