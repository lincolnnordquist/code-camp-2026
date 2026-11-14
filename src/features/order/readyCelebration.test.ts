// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const load = () => import('./readyCelebration')

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})
afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'vibrate')
})

describe('claimReadyCelebration', () => {
  it('answers true once per order, then false on later renders and after a reload', async () => {
    const first = await load()
    expect(first.claimReadyCelebration('o1')).toBe(true)
    expect(first.claimReadyCelebration('o1')).toBe(false)
    expect(first.claimReadyCelebration('o2')).toBe(true)
    // A reload: a fresh module reads what this device saved.
    vi.resetModules()
    const reloaded = await load()
    expect(reloaded.claimReadyCelebration('o1')).toBe(false)
    expect(reloaded.claimReadyCelebration('o2')).toBe(false)
    expect(reloaded.claimReadyCelebration('o3')).toBe(true)
  })

  it('keeps only the newest orders it has celebrated', async () => {
    const { claimReadyCelebration } = await load()
    for (let i = 0; i < 105; i++) claimReadyCelebration(`o${i}`)
    const saved = JSON.parse(localStorage.getItem('order.readyCelebrated.v1') ?? '[]') as string[]
    expect(saved).toHaveLength(100)
    expect(saved[0]).toBe('o5')
    expect(saved.at(-1)).toBe('o104')
  })

  it('with storage blocked it still celebrates once in this page life, and never throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const { claimReadyCelebration } = await load()
    expect(claimReadyCelebration('o1')).toBe(true)
    expect(claimReadyCelebration('o1')).toBe(false)
  })

  it('treats an unreadable saved list as empty', async () => {
    localStorage.setItem('order.readyCelebrated.v1', '{not json')
    const { claimReadyCelebration } = await load()
    expect(claimReadyCelebration('o1')).toBe(true)
  })
})

describe('vibrateReady', () => {
  it('buzzes where supported', async () => {
    const vibrate = vi.fn().mockReturnValue(true)
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
    const { vibrateReady, READY_VIBRATION } = await load()
    vibrateReady()
    expect(vibrate).toHaveBeenCalledWith(READY_VIBRATION)
  })

  it('does nothing without the API, and swallows a policy refusal', async () => {
    const { vibrateReady } = await load()
    expect(() => vibrateReady()).not.toThrow()
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: () => {
        throw new Error('NotAllowedError')
      },
    })
    expect(() => vibrateReady()).not.toThrow()
  })
})
