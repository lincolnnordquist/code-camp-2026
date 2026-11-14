// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { BrowserRouter, useNavigate, type NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { previousEntryPath, useGoBack, useViewTransitions } from './navTransitions'
import { backLabelOf } from './routes'

const probe: { navigate: NavigateFunction | null; goBack: ((via?: 'button' | 'swipe') => boolean) | null } = {
  navigate: null,
  goBack: null,
}

/** The shell's two hooks, as App mounts them, plus handles to drive them. */
function Shell() {
  useViewTransitions()
  const goBack = useGoBack()
  const navigate = useNavigate()
  useEffect(() => {
    probe.navigate = navigate
    probe.goBack = goBack
  })
  return null
}

/** Up navigation pushes at once; a history Back settles on popstate, so wait briefly for one. */
async function goBack(via: 'button' | 'swipe' = 'button') {
  const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }))
  await act(async () => {
    probe.goBack!(via)
    await Promise.race([popped, new Promise((r) => setTimeout(r, 50))])
  })
}

beforeEach(() => {
  window.history.replaceState(null, '', '/e/x')
})
afterEach(cleanup)

describe('header Back and edge swipe after an order is placed', () => {
  it.each(['button', 'swipe'] as const)('%s: from a new order, Back goes up to the wallet, not to the emptied cart', async (via) => {
    render(
      <BrowserRouter>
        <Shell />
      </BrowserRouter>,
    )
    act(() => probe.navigate!('/e/x/booth/b1'))
    act(() => probe.navigate!('/e/x/cart'))
    act(() => probe.navigate!('/e/x/cart/checkout'))
    // Reserve replaces the checkout entry with the order.
    act(() => probe.navigate!('/orders/o1', { replace: true }))
    expect(previousEntryPath()).toBe('/e/x/cart')
    expect(backLabelOf('/orders/o1', undefined, previousEntryPath())).toBe('Back to your orders')
    await goBack(via)
    expect(window.location.pathname).toBe('/orders')
  })

  it('from an order opened elsewhere in the app, Back still returns to the previous screen', async () => {
    render(
      <BrowserRouter>
        <Shell />
      </BrowserRouter>,
    )
    act(() => probe.navigate!('/orders'))
    act(() => probe.navigate!('/orders/o1'))
    expect(backLabelOf('/orders/o1', undefined, previousEntryPath())).toBe('Back')
    await goBack()
    expect(window.location.pathname).toBe('/orders')
    act(() => probe.navigate!('/e/x/booth/b1'))
    act(() => probe.navigate!('/e/x/cart'))
    await goBack()
    // Leaving the cart itself is an ordinary Back.
    expect(window.location.pathname).toBe('/e/x/booth/b1')
  })
})
