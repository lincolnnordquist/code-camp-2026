// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScreenErrorBoundary } from './ScreenErrorBoundary'

afterEach(cleanup)

function Broken(): never {
  throw new Error('screen bug')
}

function Shell() {
  const { pathname } = useLocation()
  return (
    <>
      <Link to="/orders">Orders tab</Link>
      <ScreenErrorBoundary pathname={pathname}>
        <Routes>
          <Route path="/broken" element={<Broken />} />
          <Route path="/orders" element={<h1>Your orders</h1>} />
        </Routes>
      </ScreenErrorBoundary>
    </>
  )
}

describe('ScreenErrorBoundary', () => {
  it('replaces a screen that throws with a way home, keeps the rest, and clears on a new path', () => {
    // React reports the caught error to the console; the test only checks what the attendee sees.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <MemoryRouter initialEntries={['/broken']}>
        <Shell />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong on this screen.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to event home' }).getAttribute('href')).toBe('/')
    fireEvent.click(screen.getByRole('link', { name: 'Orders tab' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Your orders' })).toBeTruthy()
    vi.restoreAllMocks()
  })
})
