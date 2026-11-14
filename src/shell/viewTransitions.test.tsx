// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter, Link, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewTransitions } from './navTransitions'

function Where() {
  const location = useLocation()
  return <p data-testid="where">{`${location.pathname} ${JSON.stringify(location.state)}`}</p>
}

function Page() {
  useViewTransitions()
  return (
    <>
      <Link to="/orders" state={{ from: 'strip' }} replace>
        Orders
      </Link>
      <Link to="/vendor">Vendor</Link>
      <Where />
    </>
  )
}

// Like a browser, the update runs after the click has finished, once the old view is captured.
const startViewTransition = vi.fn((update: () => void) => {
  const done = Promise.resolve().then(update)
  return { ready: done, finished: done, updateCallbackDone: done, skipTransition: () => undefined }
})

beforeEach(() => {
  window.history.replaceState(null, '', '/e/demo')
  window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia
  Object.assign(document, { startViewTransition })
  startViewTransition.mockClear()
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document, 'startViewTransition')
})

describe('link clicks in a view transition', () => {
  it("animates a link into the attendee router and keeps the Link's state and replace", async () => {
    render(
      <BrowserRouter useTransitions={false}>
        <Page />
      </BrowserRouter>,
    )
    const entries = window.history.length
    await act(async () => {
      fireEvent.click(screen.getByRole('link', { name: 'Orders' }))
    })
    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('where').textContent).toBe('/orders {"from":"strip"}')
    expect(window.history.length).toBe(entries)
  })

  it('leaves a link to a path the attendee router does not own to the router alone', () => {
    render(
      <BrowserRouter useTransitions={false}>
        <Page />
      </BrowserRouter>,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Vendor' }))
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(screen.getByTestId('where').textContent).toBe('/vendor null')
  })
})
