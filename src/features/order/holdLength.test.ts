import { describe, expect, it } from 'vitest'
import { holdLength } from './holdLength'

describe('holdLength', () => {
  it('words whole hours, minutes under an hour, and the two together, singular and plural', () => {
    expect(holdLength(120)).toBe('2 hours')
    expect(holdLength(60)).toBe('1 hour')
    expect(holdLength(45)).toBe('45 minutes')
    expect(holdLength(1)).toBe('1 minute')
    expect(holdLength(90)).toBe('1 hour 30 minutes')
    expect(holdLength(121)).toBe('2 hours 1 minute')
  })
})
