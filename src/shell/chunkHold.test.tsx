// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useViewTransitions } from './navTransitions'
import { registerRouteChunk } from './routeChunks'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

let loaded = false
let download = deferred()
registerRouteChunk(['/e/:eventSlug/booths'], {
  loaded: () => loaded,
  preload: () => download.promise.then(() => void (loaded = true)),
})

function Where() {
  const { pathname, state } = useLocation()
  return <p data-testid="where">{`${pathname} ${JSON.stringify(state)}`}</p>
}

function Shell() {
  useViewTransitions()
  return (
    <>
      <Link to="/e/con/booths" state={{ from: 'home' }}>
        Booths
      </Link>
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </>
  )
}

beforeEach(() => {
  window.history.replaceState(null, '', '/e/con')
  loaded = false
  download = deferred()
})
afterEach(cleanup)

describe('a tap on a screen whose code is still downloading', () => {
  it('keeps the current screen until the code arrives, then follows the link with its state', async () => {
    render(
      <BrowserRouter useTransitions={false}>
        <Shell />
      </BrowserRouter>,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Booths' }))
    expect(screen.getByTestId('where').textContent).toBe('/e/con null')

    await act(async () => download.resolve())
    expect(screen.getByTestId('where').textContent).toBe('/e/con/booths {"from":"home"}')
  })

  it('once the code is here, a tap follows the link at once', () => {
    loaded = true
    render(
      <BrowserRouter useTransitions={false}>
        <Shell />
      </BrowserRouter>,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Booths' }))
    expect(screen.getByTestId('where').textContent).toBe('/e/con/booths {"from":"home"}')
  })
})
