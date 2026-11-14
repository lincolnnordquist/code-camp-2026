// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { installInputModality } from './inputModality'

const mode = () => document.documentElement.dataset.input
const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
const tap = (target: EventTarget) => target.dispatchEvent(new Event('pointerdown', { bubbles: true }))

describe('input modality', () => {
  beforeAll(() => installInputModality())

  it('typing in a field after a tap keeps the pointer mode, so the tapped field shows no keyboard ring', () => {
    const field = document.body.appendChild(document.createElement('input'))
    tap(field)
    press(field, 't')
    press(field, 'Backspace')
    press(field, 'Enter')
    expect(mode()).toBe('pointer')
  })

  it('Tab, even from a field, and keys outside fields switch to keyboard', () => {
    const field = document.body.appendChild(document.createElement('input'))
    tap(field)
    press(field, 'Tab')
    expect(mode()).toBe('keyboard')
    tap(document.body)
    press(document.body, 'ArrowDown')
    expect(mode()).toBe('keyboard')
  })

  it('a shortcut chord does not count as keyboard navigation', () => {
    tap(document.body)
    press(document.body, 'c', { metaKey: true })
    expect(mode()).toBe('pointer')
  })
})
