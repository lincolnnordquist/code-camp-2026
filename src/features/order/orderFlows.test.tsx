// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booth, Order, Result } from '../../shared/types'

const api = vi.hoisted(() => ({
  getEventCatalog: vi.fn(),
  createReservation: vi.fn(),
  startCheckout: vi.fn(),
  confirmCheckout: vi.fn(),
  cancelMyOrder: vi.fn(),
  getOrder: vi.fn(),
  getOrderByToken: vi.fn(),
  listMyOrders: vi.fn(),
}))
const live = vi.hoisted(() => ({ listeners: [] as Array<() => void>, online: true }))

vi.mock('../../shared/api', () => api)
vi.mock('../../shared/live', () => ({
  subscribeToMyOrders: (cb: () => void) => {
    live.listeners.push(cb)
    return () => {
      live.listeners = live.listeners.filter((l) => l !== cb)
    }
  },
  useOnlineStatus: () => live.online,
}))

// `eventSlug` is not in the contract yet; orderEventSlug reads it from the order first (orderExtras.ts).
const order = (overrides: Partial<Order> = {}): Order & { eventSlug: string } => ({
  id: 'o1',
  boothId: 'b',
  eventId: 'e',
  boothCode: 'A1',
  boothName: 'Vendor',
  type: 'reservation',
  status: 'confirmed',
  totalCents: 800,
  currency: 'USD',
  pickupCode: 'ABC234',
  holdEndsAt: null,
  createdAt: '2026-11-13T10:00:00Z',
  collectedAt: null,
  cancelReason: null,
  refundStatus: 'none',
  eventSlug: 'ev',
  items: [{ productId: 'p', name: 'Patch', quantity: 1, unitPriceCents: 800 }],
  ...overrides,
})

/** The order names its booth; the order page reads only the pickup instructions and logo from the event catalog. */
const catalogBooth = (id: string, code: string, vendorName: string, pickupInstructions = ''): Booth => ({
  id,
  vendorName,
  slogan: '',
  logoUrl: '',
  bannerUrl: '',
  code,
  mode: 'reservation',
  orderingPaused: false,
  mapX: 0.5,
  mapY: 0.5,
  pickupInstructions,
})
const BOOTHS = [catalogBooth('b', 'A1', 'Vendor', 'Front table')]
const EVENT = { id: 'e', slug: 'ev', name: 'Ev', venueName: 'Hall', currency: 'USD', floorPlanUrl: '', reservationHoldMinutes: 120 }

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  live.listeners = []
  live.online = true
  Object.values(api).forEach((fn) => fn.mockReset())
  vi.resetModules()
  api.getEventCatalog.mockResolvedValue({ ok: true, value: { event: EVENT, booths: BOOTHS, products: [] } })
})
afterEach(cleanup)

describe('reserve retry (FR-08)', () => {
  it('sends the same request id when a failed submit is retried', async () => {
    const { addToCart } = await import('./cartStore')
    const { CheckoutPage } = await import('./CheckoutPage')
    addToCart({
      eventSlug: 'ev',
      currency: 'USD',
      booth: catalogBooth('b', 'A1', 'Vendor'),
      product: { id: 'p', boothId: 'b', name: 'Patch', category: 'C', description: '', imageUrl: '', priceCents: 800, availableQty: 5, maxPerOrder: 2 },
    })
    api.createReservation.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, value: order() })

    render(
      <MemoryRouter useTransitions={false} initialEntries={['/e/ev/cart/checkout']}>
        <Routes>
          <Route path="/e/:eventSlug/cart/checkout" element={<CheckoutPage />} />
          <Route path="/orders/:orderId" element={<p>order page</p>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.co' } })
    fireEvent.click(screen.getByRole('button', { name: /^Reserve$/ }))
    await screen.findByText(/Could not reach the server/)
    fireEvent.click(screen.getByRole('button', { name: /^Reserve$/ }))
    await screen.findByText('order page')

    const [first, second] = api.createReservation.mock.calls.map((c) => c[0].requestId)
    expect(first).toBeTruthy()
    expect(second).toBe(first)
  })

  it('the docked Reserve sits outside the form, so it sticks to the screen, and still submits it (QA D7)', async () => {
    const { addToCart } = await import('./cartStore')
    const { CheckoutPage } = await import('./CheckoutPage')
    addToCart({
      eventSlug: 'ev',
      currency: 'USD',
      booth: catalogBooth('b', 'A1', 'Vendor'),
      product: { id: 'p', boothId: 'b', name: 'Patch', category: 'C', description: '', imageUrl: '', priceCents: 800, availableQty: 5, maxPerOrder: 2 },
    })
    api.createReservation.mockResolvedValue({ ok: true, value: order() })
    render(
      <MemoryRouter useTransitions={false} initialEntries={['/e/ev/cart/checkout']}>
        <Routes>
          <Route path="/e/:eventSlug/cart/checkout" element={<CheckoutPage />} />
          <Route path="/orders/:orderId" element={<p>order page</p>} />
        </Routes>
      </MemoryRouter>,
    )
    const reserve = screen.getByRole('button', { name: /^Reserve$/ }) as HTMLButtonElement
    // Inside the form, the sticky dock could rise no higher than the form's top (over the field, past the screen).
    expect(reserve.closest('form')).toBeNull()
    expect(reserve.closest('.cart__dock')?.closest('form')).toBeNull()
    expect(reserve.form?.id).toBe('reserve-form')
    const email = screen.getByLabelText(/email/i)
    fireEvent.change(email, { target: { value: 'a@b.co' } })
    fireEvent.submit(reserve.form!)
    await screen.findByText('order page')
    expect(api.createReservation).toHaveBeenCalledTimes(1)
  })
})

describe('useLiveOrder (FR-17)', () => {
  it('does not lose a vendor update that arrives while the first load is in flight', async () => {
    const { useLiveOrder } = await import('./useLiveOrder')
    const slowFirst = deferred<Result<Order, string>>()
    api.getOrder.mockReturnValueOnce(slowFirst.promise).mockResolvedValueOnce({ ok: true, value: order({ status: 'ready' }) })

    function Probe() {
      const [state] = useLiveOrder(api.getOrder, 'o1', 'mine')
      return <p>{state.status === 'ready' ? state.order.status : state.status}</p>
    }
    render(<Probe />)
    // The vendor marks it ready before the first read returns.
    act(() => live.listeners.forEach((l) => l()))
    await screen.findByText('ready')
    // The stale first response arrives last and must not win.
    await act(async () => slowFirst.resolve({ ok: true, value: order({ status: 'confirmed' }) }))
    expect(screen.getByText('ready')).toBeTruthy()
  })

  it('never caches or subscribes for the emailed private link', async () => {
    const { useLiveOrder } = await import('./useLiveOrder')
    api.getOrderByToken.mockResolvedValue({ ok: true, value: order() })
    function Probe() {
      const [state] = useLiveOrder(api.getOrderByToken, 'secret-token', 'link')
      return <p>{state.status}</p>
    }
    render(<Probe />)
    await screen.findByText('ready')
    expect(live.listeners).toHaveLength(0)
    expect(localStorage.getItem('orders.cache')).toBeNull()
  })
})

// Every router here commits location changes synchronously, as the app's does (App.tsx
// useTransitions={false}); the default transition let a cleared ?checkout flag land after the page
// showed the confirmed payment, so a check in between saw the old flag.
describe('return from Square (FR-12)', () => {
  it('asks the server to verify exactly once and clears the return flag', async () => {
    const { OrderPage } = await import('./OrderPage')
    api.getOrder.mockResolvedValue({ ok: true, value: order({ type: 'prepaid', status: 'pending_payment' }) })
    api.confirmCheckout.mockResolvedValue({ ok: true, value: order({ type: 'prepaid', status: 'confirmed' }) })
    let search = ''
    function Spy() {
      search = useLocation().search
      return null
    }
    render(
      <MemoryRouter useTransitions={false} initialEntries={['/orders/o1?checkout=return']}>
        <Routes>
          <Route
            path="/orders/:orderId"
            element={
              <>
                <OrderPage />
                <Spy />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Paid $8.00 with Square')
    await waitFor(() => expect(api.confirmCheckout).toHaveBeenCalledTimes(1))
    expect(api.confirmCheckout).toHaveBeenCalledWith('o1')
    expect(search).toBe('')
  })

  it('without the return flag, a pending order is not checked even with a remembered checkout link', async () => {
    // The shared stub's confirmCheckout confirms any pending order, so a check here would show an
    // unpaid order as paid; only Square's explicit return (?checkout=return) asks for one.
    const { OrderPage } = await import('./OrderPage')
    const { rememberCheckoutUrl } = await import('./checkoutLinks')
    rememberCheckoutUrl('o1', 'https://example.com/square-checkout/o1')
    api.getOrder.mockResolvedValue({ ok: true, value: order({ type: 'prepaid', status: 'pending_payment' }) })
    render(
      <MemoryRouter useTransitions={false} initialEntries={['/orders/o1']}>
        <Routes>
          <Route path="/orders/:orderId" element={<OrderPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { level: 2, name: 'Waiting for payment' })
    expect(api.confirmCheckout).not.toHaveBeenCalled()
  })

  it('the return flag is gone by the time the confirmed payment shows', async () => {
    // Read at the moment the payment line appears: the app's router commits location changes
    // synchronously (useTransitions={false}), so the flag cleared before the check is already gone.
    const { OrderPage } = await import('./OrderPage')
    api.getOrder.mockResolvedValue({ ok: true, value: order({ type: 'prepaid', status: 'pending_payment' }) })
    api.confirmCheckout.mockResolvedValue({ ok: true, value: order({ type: 'prepaid', status: 'confirmed' }) })
    let search = ''
    function Spy() {
      search = useLocation().search
      return null
    }
    const { container } = render(
      <MemoryRouter initialEntries={['/orders/o1?checkout=return']} useTransitions={false}>
        <Routes>
          <Route
            path="/orders/:orderId"
            element={
              <>
                <OrderPage />
                <Spy />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )
    const searchWhenPaid = await new Promise<string>((resolve) => {
      const observer = new MutationObserver(() => {
        if (!container.textContent?.includes('Paid $8.00 with Square')) return
        observer.disconnect()
        resolve(search)
      })
      observer.observe(container, { subtree: true, childList: true, characterData: true })
    })
    expect(searchWhenPaid).toBe('')
  })

  it('never confirms on a plain visit without the return flag', async () => {
    const { OrderPage } = await import('./OrderPage')
    api.getOrder.mockResolvedValue({ ok: true, value: order({ type: 'prepaid', status: 'pending_payment' }) })
    render(
      <MemoryRouter useTransitions={false} initialEntries={['/orders/o1']}>
        <Routes>
          <Route path="/orders/:orderId" element={<OrderPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Your items are held while you pay with Square.')
    expect(api.confirmCheckout).not.toHaveBeenCalled()
  })
})

const boothB = catalogBooth('b', 'A1', 'Vendor')
const boothC = { ...boothB, id: 'c', code: 'A2', vendorName: 'Other Vendor' }
const product = (id: string, boothId = 'b') => ({ id, boothId, name: `Item ${id}`, category: 'C', description: '', imageUrl: '', priceCents: 500, availableQty: 5, maxPerOrder: 2 })
const event = EVENT

describe('focus when the focused control is replaced', () => {
  it('replace-cart dialog: focuses the question, Escape keeps the cart, Replace focuses View cart', async () => {
    const { addToCart } = await import('./cartStore')
    const { AddToCart } = await import('./AddToCart')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
    render(
      <MemoryRouter useTransitions={false}>
        <AddToCart product={product('q', 'c')} booth={boothC} event={event} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    const dialog = screen.getByRole('dialog', { name: 'Start a new cart?' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Start a new cart?' }))
    expect(dialog.textContent).toContain('Your cart has items from Vendor.')
    // The page behind is inert while the question is open.
    expect(Array.from(document.body.children).filter((el) => el !== dialog.parentElement).every((el) => el.hasAttribute('inert'))).toBe(true)

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add to cart' }))

    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep cart' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add to cart' }))

    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'View cart (1)' }))
    expect(screen.getByRole('status').textContent).toBe('Added Item q. 1 in cart.')
  })

  it('storefront card: Add, then a tonal Added that adds another, then Limit reached, focus kept throughout', async () => {
    const { AddToCart } = await import('./AddToCart')
    render(
      <MemoryRouter useTransitions={false}>
        <AddToCart product={product('p')} booth={boothB} event={event} variant="card" />
      </MemoryRouter>,
    )
    const button = screen.getByRole('button', { name: 'Add Item p to cart' })
    button.focus()
    expect(button.classList.contains('add-card--added')).toBe(false)
    fireEvent.click(button)
    expect(button.getAttribute('aria-label')).toBe('Added, add another Item p, 1 in cart')
    expect(button.classList.contains('add-card--added')).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Added Item p. 1 in cart.')
    // The card has no cart link; the cart bar does that job.
    expect(screen.queryByRole('link')).toBeNull()
    fireEvent.click(button)
    expect(button.getAttribute('aria-label')).toBe('Limit reached for Item p, 2 in cart')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    expect(screen.getByRole('status').textContent).toBe('Added Item p. 2 in cart.')
  })

  it("storefront card: replacing another booth's cart keeps focus on the card's button", async () => {
    const { addToCart } = await import('./cartStore')
    const { AddToCart } = await import('./AddToCart')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
    render(
      <MemoryRouter useTransitions={false}>
        <AddToCart product={product('q', 'c')} booth={boothC} event={event} variant="card" />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add Item q to cart' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Added, add another Item q, 1 in cart' }))
  })

  it('product sheet: Add to cart gives way to a stepper for the line, focus on its plus', async () => {
    const { AddToCart } = await import('./AddToCart')
    render(
      <MemoryRouter useTransitions={false}>
        <AddToCart product={product('p')} booth={boothB} event={event} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(screen.queryByRole('button', { name: 'Add to cart' })).toBeNull()
    const stepper = screen.getByRole('group', { name: 'Quantity of Item p' })
    expect(stepper.textContent).toBe('1')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'One more Item p' }))
    expect(screen.getByRole('status').textContent).toBe('Added Item p. 1 in cart.')
    // No underlined text link in the dock: the way on is a filled button.
    expect(document.querySelector('.link')).toBeNull()
  })

  it('product sheet: the plus stops at the limit with its reason, focus kept, and the minus steps back', async () => {
    const { AddToCart } = await import('./AddToCart')
    render(
      <MemoryRouter useTransitions={false}>
        <AddToCart product={product('p')} booth={boothB} event={event} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    const plus = screen.getByRole('button', { name: 'One more Item p' })
    fireEvent.click(plus)
    expect(screen.getByRole('group', { name: 'Quantity of Item p' }).textContent).toBe('2')
    expect(screen.getByRole('status').textContent).toBe('Item p: 2 in cart')
    expect(plus.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(plus)
    const reason = document.getElementById(plus.getAttribute('aria-describedby') ?? '')
    expect(reason?.textContent).toBe('Up to 2 per order')
    fireEvent.click(plus)
    expect(screen.getByRole('group', { name: 'Quantity of Item p' }).textContent).toBe('2')

    fireEvent.click(screen.getByRole('button', { name: 'One fewer Item p' }))
    expect(screen.getByRole('group', { name: 'Quantity of Item p' }).textContent).toBe('1')
    expect(screen.getByRole('status').textContent).toBe('Item p: 1 in cart')
    expect(plus.getAttribute('aria-disabled')).toBe('false')
    expect(screen.queryByText('Up to 2 per order')).toBeNull()
  })

  it('product sheet: at one the minus removes the line, and Add to cart takes focus again', async () => {
    const { AddToCart } = await import('./AddToCart')
    const { useCart } = await import('./cartStore')
    let lines = -1
    function Probe() {
      lines = useCart()?.items.length ?? 0
      return null
    }
    render(
      <MemoryRouter useTransitions={false}>
        <AddToCart product={product('p')} booth={boothB} event={event} />
        <Probe />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Item p' }))
    expect(lines).toBe(0)
    expect(screen.queryByRole('group')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add to cart' }))
    expect(screen.getByRole('status').textContent).toBe('Removed Item p')
  })

  it("product sheet: View cart counts the whole cart and opens the cart's route", async () => {
    const { addToCart } = await import('./cartStore')
    const { AddToCart } = await import('./AddToCart')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('q') })
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
    render(
      <MemoryRouter useTransitions={false} initialEntries={['/e/ev/booth/b']}>
        <Routes>
          <Route path="/e/:eventSlug/booth/:boothId" element={<AddToCart product={product('p')} booth={boothB} event={event} />} />
          <Route path="/e/:eventSlug/cart" element={<h1>Cart page</h1>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('group', { name: 'Quantity of Item p' }).textContent).toBe('1')
    const viewCart = screen.getByRole('link', { name: 'View cart (2)' })
    expect(viewCart.getAttribute('href')).toBe('/e/ev/cart')
    fireEvent.click(viewCart)
    expect(screen.getByRole('heading', { name: 'Cart page' })).toBeTruthy()
  })

  it('product sheet offline: Add to cart and the plus are inert and say why; the minus still works', async () => {
    const { addToCart } = await import('./cartStore')
    const { AddToCart } = await import('./AddToCart')
    live.online = false
    const view = render(
      <MemoryRouter useTransitions={false}>
        <AddToCart product={product('p')} booth={boothB} event={event} />
      </MemoryRouter>,
    )
    const add = screen.getByRole('button', { name: 'Add to cart' })
    expect(add.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(add.getAttribute('aria-describedby') ?? '')?.textContent).toBe("You're offline. Add when you're back online.")
    fireEvent.click(add)
    expect(screen.queryByRole('group')).toBeNull()

    act(() => addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') }))
    view.rerender(
      <MemoryRouter useTransitions={false}>
        <AddToCart product={product('p')} booth={boothB} event={event} />
      </MemoryRouter>,
    )
    const plus = screen.getByRole('button', { name: 'One more Item p' })
    expect(plus.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(plus)
    expect(screen.getByRole('group', { name: 'Quantity of Item p' }).textContent).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Item p' }))
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeTruthy()
  })

  it('cart remove: focuses the next line, then the cart heading, then the empty-cart heading', async () => {
    const { addToCart } = await import('./cartStore')
    const { CartPage } = await import('./CartPage')
    for (const id of ['p', 'q', 'r']) addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product(id) })
    render(
      <MemoryRouter useTransitions={false} initialEntries={['/e/ev/cart']}>
        <Routes>
          <Route path="/e/:eventSlug/cart" element={<CartPage />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove Item p' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Item q' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Item r' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Your cart from Vendor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Item q' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Your cart is empty' }))
  })

  it('email: an empty submit shows the error and focuses the field', async () => {
    const { addToCart } = await import('./cartStore')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
    await renderCart()
    fireEvent.click(screen.getByRole('button', { name: /^Reserve$/ }))
    const field = screen.getByLabelText(/email/i)
    expect(document.activeElement).toBe(field)
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby')).toContain('email-error')
    expect(document.getElementById('email-error')?.textContent).toBe('Enter your email address')
    expect(api.createReservation).not.toHaveBeenCalled()
  })

  it('the live step tracker marks the current step, pops a step reached while open, and rests once collected', async () => {
    const { OrderView } = await import('./OrderView')
    const view = (status: Order['status']) => (
      <MemoryRouter useTransitions={false}>
        <OrderView order={order({ status })} onChange={() => undefined} />
      </MemoryRouter>
    )
    const { container, rerender } = render(view('confirmed'))
    const steps = () => container.querySelector('.order-steps')!
    const current = () => steps().querySelector('li.is-current')?.textContent
    expect(current()).toBe('Confirmed')
    expect(steps().classList.contains('order-steps--live')).toBe(true)
    // The page opened on this step, so nothing pops.
    expect(steps().classList.contains('order-steps--arrived')).toBe(false)
    rerender(view('ready'))
    expect(current()).toBe('Ready')
    expect(steps().querySelector('li.is-done')?.textContent).toBe('Confirmed')
    expect(steps().classList.contains('order-steps--arrived')).toBe(true)
    rerender(view('collected'))
    // Done: no breathing loop, every step solid, the last one checked.
    expect(steps().classList.contains('order-steps--live')).toBe(false)
    expect(steps().querySelectorAll('li.is-done')).toHaveLength(3)
    expect(steps().querySelectorAll('.order-steps__check')).toHaveLength(3)
  })

  it('with reduced motion the tracker has no animation classes, and still marks the current step', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    try {
      const { OrderView } = await import('./OrderView')
      const view = (status: Order['status']) => (
        <MemoryRouter useTransitions={false}>
          <OrderView order={order({ status })} onChange={() => undefined} />
        </MemoryRouter>
      )
      const { container, rerender } = render(view('confirmed'))
      rerender(view('ready'))
      const steps = container.querySelector('.order-steps')!
      expect(steps.querySelector('li.is-current')?.textContent).toBe('Ready')
      expect(steps.classList.contains('order-steps--live')).toBe(false)
      expect(steps.classList.contains('order-steps--arrived')).toBe(false)
    } finally {
      Reflect.deleteProperty(window, 'matchMedia')
    }
  })

  it('the tracker pauses its loops while the page is hidden', async () => {
    const { OrderView } = await import('./OrderView')
    const { container } = render(
      <MemoryRouter useTransitions={false}>
        <OrderView order={order()} onChange={() => undefined} />
      </MemoryRouter>,
    )
    const steps = container.querySelector('.order-steps')!
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(steps.classList.contains('order-steps--paused')).toBe(true)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(steps.classList.contains('order-steps--paused')).toBe(false)
  })

  it('cancel confirm sends one request for two clicks in one task (D2)', async () => {
    const { OrderView } = await import('./OrderView')
    const answer = deferred<Result<Order, string>>()
    api.cancelMyOrder.mockReturnValue(answer.promise)
    render(
      <MemoryRouter useTransitions={false}>
        <OrderView order={order()} onChange={() => undefined} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }))
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel reservation' })
    // Both clicks land before React re-renders, so both see `cancelling` still false.
    act(() => {
      confirm.click()
      confirm.click()
    })
    expect(api.cancelMyOrder).toHaveBeenCalledTimes(1)
    await act(async () => answer.resolve({ ok: true, value: order({ status: 'cancelled' }) }))
  })

  it('offline, the cancel sheet says why its confirm button does nothing (D5)', async () => {
    const { OrderView } = await import('./OrderView')
    const view = render(
      <MemoryRouter useTransitions={false}>
        <OrderView order={order()} onChange={() => undefined} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }))
    expect(screen.queryByText("You're offline. Connect to cancel.")).toBeNull()
    live.online = false
    view.rerender(
      <MemoryRouter useTransitions={false}>
        <OrderView order={order()} onChange={() => undefined} />
      </MemoryRouter>,
    )
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel reservation' })
    const reason = within(screen.getByRole('dialog')).getByText("You're offline. Connect to cancel.")
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    expect(confirm.getAttribute('aria-describedby')).toBe(reason.id)
    fireEvent.click(confirm)
    expect(api.cancelMyOrder).not.toHaveBeenCalled()
  })

  it('a cancel moves focus to the status heading in the same commit that shows it', async () => {
    // Read the moment the heading appears, before any later task: focus moved in a passive effect
    // lands a task later, and a check that ran first (as RTL's polling can under load) failed.
    const { OrderView } = await import('./OrderView')
    api.cancelMyOrder.mockResolvedValue({ ok: true, value: order({ status: 'cancelled' }) })
    function Harness() {
      const [o, setO] = useState<Order>(order())
      return <OrderView order={o} onChange={setO} />
    }
    const { container } = render(
      <MemoryRouter useTransitions={false}>
        <Harness />
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { level: 1, name: 'Order from Vendor' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }))
    const focusWhenShown = new Promise<Element | null>((resolve) => {
      const observer = new MutationObserver(() => {
        const heading = container.querySelector('.order-status__headline')
        if (heading?.textContent !== 'Reservation cancelled') return
        observer.disconnect()
        resolve(document.activeElement === heading ? heading : document.activeElement)
      })
      observer.observe(container, { subtree: true, childList: true, characterData: true })
    })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel reservation' }))
    const focused = await focusWhenShown
    expect(focused?.textContent).toBe('Reservation cancelled')
  })

  it('cancel prompt: Keep returns to the opener, a cancel focuses the status heading', async () => {
    const { OrderView } = await import('./OrderView')
    api.cancelMyOrder.mockResolvedValue({ ok: true, value: order({ status: 'cancelled' }) })
    function Harness() {
      const [o, setO] = useState<Order>(order())
      return <OrderView order={o} onChange={setO} />
    }
    render(
      <MemoryRouter useTransitions={false}>
        <Harness />
      </MemoryRouter>,
    )
    // The booth comes from the event catalog, so the vendor name lands once that is read.
    expect(await screen.findByRole('heading', { level: 1, name: 'Order from Vendor' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }))
    expect(document.activeElement?.id).toBe('cancel-q')
    fireEvent.click(screen.getByRole('button', { name: 'Keep reservation' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel reservation' }))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel reservation' }))
    await screen.findByRole('heading', { level: 2, name: 'Reservation cancelled' })
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Reservation cancelled' }))
  })
})

describe('no loading flash for a returning visitor', () => {
  it('flags the saved copy only when the refresh fails', async () => {
    localStorage.setItem('orders.cache', JSON.stringify([order({ pickupCode: 'SAVED1' })]))
    api.listMyOrders.mockRejectedValue(new Error('offline'))
    const { MyOrders } = await import('./MyOrders')
    render(
      <MemoryRouter useTransitions={false}>
        <MyOrders />
      </MemoryRouter>,
    )
    await screen.findByText(/showing saved/i)
    expect(screen.getByText('SAVED1')).toBeTruthy()
  })
})


const PAST = '2020-01-01T00:00:00Z'
const FUTURE = '2999-01-01T00:00:00Z'
const saveCache = (orders: Order[]) => localStorage.setItem('orders.cache', JSON.stringify(orders))
const savedIds = () => (JSON.parse(localStorage.getItem('orders.cache') ?? '{}') as { orders?: Order[] }).orders?.map((o) => o.id)
const never = <T,>() => new Promise<T>(() => undefined)
const announcer = () => document.querySelector('[aria-live="polite"][aria-atomic="true"]')

async function renderOrderPage(path = '/orders/o1') {
  const { OrderPage, OrderByTokenPage } = await import('./OrderPage')
  return render(
    <MemoryRouter useTransitions={false} initialEntries={[path]}>
      <Routes>
        <Route path="/orders/:orderId" element={<OrderPage />} />
        <Route path="/o/:token" element={<OrderByTokenPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function renderWallet() {
  const { MyOrders } = await import('./MyOrders')
  const { OpenOrderCount } = await import('./OpenOrderCount')
  return render(
    <MemoryRouter useTransitions={false}>
      <OpenOrderCount />
      <MyOrders />
    </MemoryRouter>,
  )
}

describe('saved copy is provisional until the server confirms it (FR-26)', () => {
  afterEach(() => vi.useRealTimers())

  it('a fast refresh shows the saved order at once and never shows the note', async () => {
    saveCache([order({ pickupCode: 'SAVED1' })])
    const pending = deferred<Result<Order, string>>()
    api.getOrder.mockReturnValue(pending.promise)
    await renderOrderPage()
    expect(screen.getByText('SAVED1')).toBeTruthy()
    expect(screen.queryByText(/loading/i)).toBeNull()
    expect(screen.queryByText(/showing your saved order/i)).toBeNull()
    await act(async () => pending.resolve({ ok: true, value: order({ pickupCode: 'FRESH1' }) }))
    expect(screen.getByText('FRESH1')).toBeTruthy()
    expect(screen.queryByText(/showing your saved order/i)).toBeNull()
  })

  it('a hung refresh shows the note once the bound passes, on the order page and the wallet', async () => {
    vi.useFakeTimers()
    saveCache([order({ pickupCode: 'SAVED1' })])
    api.getOrder.mockReturnValue(never())
    api.listMyOrders.mockReturnValue(never())
    const { SAVED_NOTE_DELAY_MS } = await import('./useLiveOrder')
    const page = await renderOrderPage()
    act(() => vi.advanceTimersByTime(SAVED_NOTE_DELAY_MS - 1))
    expect(screen.queryByText(/showing your saved order/i)).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText('Showing your saved order. Its status may have changed since.')).toBeTruthy()
    page.unmount()

    await renderWallet()
    expect(screen.queryByText(/showing saved orders/i)).toBeNull()
    act(() => vi.advanceTimersByTime(SAVED_NOTE_DELAY_MS))
    expect(screen.getByText('Showing saved orders. Status may have changed since.')).toBeTruthy()
  })

  it('offline, the note shows at once', async () => {
    live.online = false
    saveCache([order()])
    api.getOrder.mockReturnValue(never())
    await renderOrderPage()
    expect(screen.getByText(/showing your saved order/i)).toBeTruthy()
  })

  it('a saved order past its hold shows no code, QR or cancel while the refresh is pending', async () => {
    saveCache([order({ holdEndsAt: PAST })])
    api.getOrder.mockReturnValue(never())
    await renderOrderPage()
    expect(screen.getByRole('heading', { level: 2, name: 'Reservation confirmed' })).toBeTruthy()
    expect(screen.getByText('The hold time has passed. Checking the latest status.')).toBeTruthy()
    expect(screen.queryByText('ABC234')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show code at booth, full screen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel reservation' })).toBeNull()
  })

  it('a saved order in a final state shows no code or cancel', async () => {
    saveCache([order({ status: 'collected' })])
    api.getOrder.mockReturnValue(never())
    await renderOrderPage()
    expect(screen.getByRole('heading', { level: 2, name: 'Collected' })).toBeTruthy()
    expect(screen.queryByText('ABC234')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel reservation' })).toBeNull()
  })

  it('offers cancel only after the refresh confirms the status', async () => {
    saveCache([order({ holdEndsAt: FUTURE })])
    const pending = deferred<Result<Order, string>>()
    api.getOrder.mockReturnValue(pending.promise)
    await renderOrderPage()
    expect(screen.getByText('ABC234')).toBeTruthy()
    // Shown, but off, with the reason, until the server confirms the saved copy.
    const cancel = screen.getByRole('button', { name: 'Cancel reservation' })
    expect(cancel.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(cancel.getAttribute('aria-describedby')!)?.textContent).toBe('Checking the latest status first.')
    fireEvent.click(cancel)
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => pending.resolve({ ok: true, value: order({ holdEndsAt: FUTURE }) }))
    expect(screen.getByRole('button', { name: 'Cancel reservation' }).getAttribute('aria-disabled')).toBe('false')
    expect(screen.queryByText('Checking the latest status first.')).toBeNull()
  })

  it('the wallet withholds the code of a saved stub past its hold', async () => {
    saveCache([order({ holdEndsAt: PAST })])
    api.listMyOrders.mockReturnValue(never())
    await renderWallet()
    expect(screen.getByText('Confirmed')).toBeTruthy()
    expect(screen.queryByText('ABC234')).toBeNull()
    // The pass links to the order page instead of opening pickup mode, and says why there is no code.
    expect(screen.queryByRole('button', { name: /^Show at booth/ })).toBeNull()
    const pass = await screen.findByRole('link', { name: /^Vendor, Booth A1, Confirmed, .*Checking the latest status\.$/ })
    expect(pass.querySelector('img')).toBeNull()
  })
})

describe('saved copy is pruned and scoped', () => {
  it('the wallet replaces the saved copy with the server list', async () => {
    saveCache([order({ id: 'gone', pickupCode: 'GONE11' }), order({ id: 'o1' })])
    const pending = deferred<Order[]>()
    api.listMyOrders.mockReturnValue(pending.promise)
    await renderWallet()
    expect(screen.getByText('GONE11')).toBeTruthy()
    await act(async () => pending.resolve([order({ id: 'o1' })]))
    expect(screen.queryByText('GONE11')).toBeNull()
    expect(savedIds()).toEqual(['o1'])
  })

  it('an order the server no longer finds is dropped from the saved copy', async () => {
    saveCache([order({ id: 'o1' }), order({ id: 'o2' })])
    api.getOrder.mockResolvedValue({ ok: false, reason: 'order_not_found' })
    await renderOrderPage()
    // The design's invalid layout, worded for an in-app address, with full-size ways on (D1).
    expect(await screen.findByRole('heading', { level: 1, name: "We can't find this order" })).toBeTruthy()
    expect(screen.getByText('It may have been removed, or the link is wrong.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to my orders' }).getAttribute('href')).toBe('/orders')
    expect(screen.getByRole('link', { name: 'Go to event home' }).className).toContain('order-button--outlined')
    expect(savedIds()).toEqual(['o2'])
  })

  it('a new order goes first and an updated one keeps its place; older saved shapes still read', async () => {
    const cache = await import('./orderCache')
    cache.replaceCachedOrders([order({ id: 'a' })])
    cache.cacheOrders([order({ id: 'b' })])
    cache.cacheOrders([order({ id: 'a', status: 'ready' })])
    expect(cache.readCachedOrders().map((o) => [o.id, o.status])).toEqual([
      ['b', 'confirmed'],
      ['a', 'ready'],
    ])
    localStorage.setItem('orders.cache', JSON.stringify({ owner: null, orders: [order({ id: 'old' })] }))
    expect(cache.readCachedOrders().map((o) => o.id)).toEqual(['old'])
    localStorage.setItem('orders.cache', '{oops')
    expect(cache.readCachedOrders()).toEqual([])
  })
})

describe('one wallet reader for the list and the badge', () => {
  it('offline, the badge counts the same saved list the wallet shows', async () => {
    live.online = false
    saveCache([order({ id: 'o1' }), order({ id: 'o2', status: 'ready', pickupCode: 'RDY234' }), order({ id: 'o3', status: 'collected' })])
    api.listMyOrders.mockRejectedValue(new Error('offline'))
    await renderWallet()
    expect(screen.getByText(', 2 open')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Open orders' }).children).toHaveLength(2)
    expect(screen.getByText(/showing saved orders/i)).toBeTruthy()
  })

  it('reads once on mount and once per push with both mounted', async () => {
    api.listMyOrders.mockResolvedValue([order()])
    await renderWallet()
    await screen.findByText(', 1 open')
    expect(api.listMyOrders).toHaveBeenCalledTimes(1)
    expect(live.listeners).toHaveLength(1)
    await act(async () => live.listeners.forEach((l) => l()))
    expect(api.listMyOrders).toHaveBeenCalledTimes(2)
  })
})

describe('return from Square with its own parameters', () => {
  // Square adds checkoutId, orderId and others to the return address in production, not in the
  // sandbox, and does not document how it joins them to an address that already has a query.
  it.each([
    '/orders/o1?checkout=return&checkoutId=C1&orderId=SQ1',
    '/orders/o1?checkout=return?checkoutId=C1&orderId=SQ1',
  ])('%s still asks the server to verify', async (path) => {
    api.getOrder.mockResolvedValue({ ok: true, value: order({ type: 'prepaid', status: 'pending_payment' }) })
    api.confirmCheckout.mockResolvedValue({ ok: true, value: order({ type: 'prepaid', status: 'confirmed' }) })
    await renderOrderPage(path)
    await waitFor(() => expect(api.confirmCheckout).toHaveBeenCalledWith('o1'))
  })
})

describe('writes outrank reads in flight', () => {
  it('a slow first read that lands after the payment check does not revert the page', async () => {
    saveCache([order({ type: 'prepaid', status: 'pending_payment' })])
    const slow = deferred<Result<Order, string>>()
    api.getOrder.mockReturnValueOnce(slow.promise)
    api.confirmCheckout.mockResolvedValue({ ok: true, value: order({ type: 'prepaid', status: 'confirmed' }) })
    await renderOrderPage('/orders/o1?checkout=return')
    await screen.findByRole('heading', { level: 2, name: 'Order confirmed' })
    await act(async () => slow.resolve({ ok: true, value: order({ type: 'prepaid', status: 'pending_payment' }) }))
    expect(screen.getByRole('heading', { level: 2, name: 'Order confirmed' })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 2, name: 'Waiting for payment' })).toBeNull()
  })
})

describe('status announcements and focus (FR-17)', () => {
  async function renderView(initial = order()) {
    const { OrderView } = await import('./OrderView')
    const push: { set: (o: Order) => void } = { set: () => undefined }
    function Harness() {
      const [o, setO] = useState<Order>(initial)
      push.set = setO
      return <OrderView order={o} onChange={setO} />
    }
    render(
      <MemoryRouter useTransitions={false}>
        <Harness />
      </MemoryRouter>,
    )
    return push
  }

  it('the status heading is not inside a live region', async () => {
    await renderView()
    const heading = screen.getByRole('heading', { level: 2, name: 'Reservation confirmed' })
    expect(heading.closest('[aria-live]')).toBeNull()
  })

  it('a cancel is read once, from the focused heading, and the live region stays silent', async () => {
    api.cancelMyOrder.mockResolvedValue({ ok: true, value: order({ status: 'cancelled' }) })
    await renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel reservation' }))
    const heading = await screen.findByRole('heading', { level: 2, name: 'Reservation cancelled' })
    // Focus moves in a passive effect, which can run just after the heading appears.
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(announcer()?.textContent).toBe('')
  })

  it('a pushed change is announced through the live region', async () => {
    const push = await renderView()
    act(() => push.set(order({ status: 'ready' })))
    expect(announcer()?.textContent).toBe('Ready for pickup. Show this code at Booth A1.')
  })

  it('a refused cancel focuses the error, then announces the refreshed status', async () => {
    api.cancelMyOrder.mockResolvedValue({ ok: false, reason: 'not_allowed_in_status' })
    const refreshed = deferred<Result<Order, string>>()
    api.getOrder.mockReturnValue(refreshed.promise)
    await renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel reservation' }))
    const error = await screen.findByText('This order can no longer be cancelled')
    await waitFor(() => expect(document.activeElement).toBe(error))
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => refreshed.resolve({ ok: true, value: order({ status: 'collected' }) }))
    expect(announcer()?.textContent).toBe('Collected. Handed over at Booth A1.')
    expect(document.activeElement).toBe(error)
  })

  it('a push that ends the order while the cancel prompt is open moves focus to the status heading', async () => {
    const push = await renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }))
    expect(document.activeElement?.id).toBe('cancel-q')
    act(() => push.set(order({ status: 'collected' })))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Collected' }))
    expect(announcer()?.textContent).toBe('')
  })
})

describe('the hidden status text never goes stale (QA D6)', () => {
  async function renderView(initial = order()) {
    const { OrderView } = await import('./OrderView')
    const push: { set: (o: Order) => void } = { set: () => undefined }
    function Harness() {
      const [o, setO] = useState<Order>(initial)
      push.set = setO
      return <OrderView order={o} onChange={setO} />
    }
    render(
      <MemoryRouter useTransitions={false}>
        <Harness />
      </MemoryRouter>,
    )
    return push
  }

  it('an announced status is cleared when a later change is read from the focused heading instead', async () => {
    const push = await renderView(order({ status: 'confirmed' }))
    act(() => push.set(order({ status: 'ready' })))
    expect(announcer()?.textContent).toBe('Ready for pickup. Show this code at Booth A1.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }))
    act(() => push.set(order({ status: 'collected' })))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Collected' }))
    expect(announcer()?.textContent).toBe('')
  })

  it('the hold countdown speaks at 10 minutes, then holds no count once it no longer applies or the hold ends', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-13T12:00:00Z') })
    try {
      const { HoldTimer } = await import('./HoldTimer')
      render(<HoldTimer endsAt="2026-11-13T12:10:30Z" />)
      const region = () => document.querySelector('.visually-hidden[role="status"]')
      expect(region()?.textContent).toBe('')
      await act(async () => vi.advanceTimersByTimeAsync(31_000))
      expect(region()?.textContent).toBe('10 minutes left on the hold.')
      await act(async () => vi.advanceTimersByTimeAsync(60_000))
      expect(region()?.textContent).toBe('')
      // One jump straight past the end (a throttled background tab): nothing about a minute left.
      await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000))
      expect(screen.getByText('Hold ended')).toBeTruthy()
      expect(region()?.textContent).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('offline controls keep focus (FR-26)', () => {
  it('the cancel opener is aria-disabled and inert offline', async () => {
    live.online = false
    const { OrderView } = await import('./OrderView')
    render(
      <MemoryRouter useTransitions={false}>
        <OrderView order={order()} onChange={() => undefined} />
      </MemoryRouter>,
    )
    const opener = screen.getByRole('button', { name: 'Cancel reservation' })
    expect(opener.hasAttribute('disabled')).toBe(false)
    expect(opener.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(opener)
    expect(screen.queryByRole('dialog', { name: /Cancel this reservation/ })).toBeNull()
  })

  it('the cart submit is aria-disabled and sends nothing offline', async () => {
    live.online = false
    const { addToCart } = await import('./cartStore')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
    await renderCart()
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.co' } })
    const submit = screen.getByRole('button', { name: /^Reserve$/ })
    expect(submit.hasAttribute('disabled')).toBe(false)
    expect(submit.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(submit)
    expect(api.createReservation).not.toHaveBeenCalled()
  })
})

describe('private link refresh failure (FR-18)', () => {
  it('says the refresh failed, not that a saved order is shown', async () => {
    api.getOrderByToken.mockResolvedValueOnce({ ok: true, value: order() }).mockRejectedValueOnce(new Error('offline'))
    await renderOrderPage('/o/secret-token')
    await screen.findByRole('heading', { level: 2, name: 'Reservation confirmed' })
    await act(async () => window.dispatchEvent(new Event('online')))
    expect(screen.getByText('Could not refresh. Status may have changed.')).toBeTruthy()
    expect(screen.queryByText(/saved order/i)).toBeNull()
  })
})

/** Opens the checkout step, with the cart behind it for "Change cart". */
async function renderCart(extraRoutes: React.ReactNode = null, at = '/e/ev/cart/checkout') {
  const { CartPage } = await import('./CartPage')
  const { CheckoutPage } = await import('./CheckoutPage')
  return render(
    <MemoryRouter useTransitions={false} initialEntries={[at]}>
      <Routes>
        <Route path="/e/:eventSlug/cart" element={<CartPage />} />
        <Route path="/e/:eventSlug/cart/checkout" element={<CheckoutPage />} />
        {extraRoutes}
      </Routes>
    </MemoryRouter>,
  )
}

const submitCart = (name: RegExp = /^Reserve$/) => {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.co' } })
  fireEvent.click(screen.getByRole('button', { name }))
}

describe('cart then checkout (design: Cart, CheckoutReserve, CheckoutPrepay)', () => {
  it('Continue opens the checkout step, named for the booth; Change cart goes back after a refusal', async () => {
    const { addToCart } = await import('./cartStore')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
    api.createReservation.mockResolvedValue({ ok: false, reason: 'ordering_paused' })
    await renderCart(null, '/e/ev/cart')
    // The cart has no email or submit; it continues to checkout.
    expect(screen.queryByLabelText(/email/i)).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'Continue' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Reserve from Vendor' })).toBeTruthy()
    expect(screen.getByText('Pay $5.00 at the booth when you pick up.')).toBeTruthy()
    submitCart()
    // Standing alone, the reason reads as a sentence, with what it means for this cart under it.
    const title = await screen.findByText('This booth has paused online orders.')
    const error = title.closest('.cart__alert-message')!
    expect(error.textContent).toContain("Vendor isn't taking orders right now. Try again later.")
    await waitFor(() => expect(document.activeElement).toBe(error))
    // A paused booth has nothing to adjust, only the way back.
    expect(screen.queryByRole('button', { name: /^(Remove|Change to|Lower)/ })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'Change cart' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Your cart from Vendor' })).toBeTruthy()
  })

  it('a prepay booth checks out with Square and says so', async () => {
    const { addToCart } = await import('./cartStore')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: { ...boothB, mode: 'prepay' }, product: product('p') })
    await renderCart()
    expect(screen.getByRole('heading', { level: 1, name: 'Check out with Vendor' })).toBeTruthy()
    expect(screen.getByText("You pay on Square's page. Your items are held while you pay.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pay with Square' })).toBeTruthy()
  })

  it('checkout with an empty cart shows the empty cart', async () => {
    await renderCart()
    expect(screen.getByRole('heading', { level: 1, name: 'Your cart is empty' })).toBeTruthy()
  })
})

describe('a hung submit has a time limit (D4)', () => {
  afterEach(() => vi.useRealTimers())

  it('a reserve that never answers becomes a network refusal with the retry hint, and the retry reuses the request id', async () => {
    vi.useFakeTimers()
    const { addToCart } = await import('./cartStore')
    const { SUBMIT_TIMEOUT_MS } = await import('./CheckoutPage')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
    api.createReservation.mockReturnValueOnce(never()).mockReturnValueOnce(never())
    await renderCart()
    submitCart()
    expect(screen.getByRole('button', { name: 'Reserving...' })).toBeTruthy()
    await act(async () => vi.advanceTimersByTime(SUBMIT_TIMEOUT_MS - 1))
    expect(screen.queryByText(/Could not reach the server/)).toBeNull()
    await act(async () => vi.advanceTimersByTime(1))
    const error = screen.getByText(/Could not reach the server/).closest('.cart__alert-message')!
    expect(error.textContent).toContain('Not sure it went through? Check your orders before trying again.')
    expect(document.activeElement).toBe(error)
    fireEvent.click(screen.getByRole('button', { name: /^Reserve$/ }))
    const [first, second] = api.createReservation.mock.calls.map((c) => c[0].requestId)
    expect(second).toBe(first)
  })

  it('a checkout that never answers becomes a network refusal', async () => {
    vi.useFakeTimers()
    const { addToCart } = await import('./cartStore')
    const { SUBMIT_TIMEOUT_MS } = await import('./CheckoutPage')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: { ...boothB, mode: 'prepay' }, product: product('p') })
    api.startCheckout.mockReturnValue(never())
    await renderCart()
    submitCart(/^Pay /)
    await act(async () => vi.advanceTimersByTime(SUBMIT_TIMEOUT_MS))
    expect(screen.getByText(/Not sure it went through/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Pay / })).toBeTruthy()
  })

  it('a checkout retried after a timeout sends the same request id', async () => {
    vi.useFakeTimers()
    const { addToCart } = await import('./cartStore')
    const { SUBMIT_TIMEOUT_MS } = await import('./CheckoutPage')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: { ...boothB, mode: 'prepay' }, product: product('p') })
    api.startCheckout.mockReturnValueOnce(never()).mockReturnValueOnce(never())
    await renderCart()
    submitCart(/^Pay /)
    await act(async () => vi.advanceTimersByTime(SUBMIT_TIMEOUT_MS))
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }))
    const [first, second] = api.startCheckout.mock.calls.map((c) => c[0].requestId)
    expect(second).toBe(first)
  })

  it.each(['checkout_unavailable', 'invalid_email'] as const)(
    'a checkout retried after a %s refusal sends a new request id',
    async (reason) => {
      const { addToCart } = await import('./cartStore')
      addToCart({ eventSlug: 'ev', currency: 'USD', booth: { ...boothB, mode: 'prepay' }, product: product('p') })
      api.startCheckout
        .mockResolvedValueOnce({ ok: false, reason })
        .mockReturnValueOnce(never())
      await renderCart()
      submitCart(/^Pay /)
      await screen.findByText(reason === 'invalid_email' ? /Enter a full email address/ : /Online payment is not available/)
      fireEvent.click(screen.getByRole('button', { name: /^Pay / }))
      await waitFor(() => expect(api.startCheckout).toHaveBeenCalledTimes(2))
      const [first, second] = api.startCheckout.mock.calls.map((c) => c[0].requestId)
      expect(first).toBeTruthy()
      expect(second).not.toBe(first)
    },
  )
})

describe('full QA round (order side)', () => {
  it('offline, a saved order shows Cancel off with the offline reason', async () => {
    live.online = false
    saveCache([order({ holdEndsAt: FUTURE })])
    api.getOrder.mockReturnValue(never())
    await renderOrderPage()
    const cancel = screen.getByRole('button', { name: 'Cancel reservation' })
    expect(cancel.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(cancel.getAttribute('aria-describedby')!)?.textContent).toBe("You're offline. Connect to cancel.")
  })

  it('a pending payment opened without its link says where to finish and offers Check payment (D2)', async () => {
    const pendingOrder = order({ type: 'prepaid', status: 'pending_payment', holdEndsAt: FUTURE })
    api.getOrder.mockResolvedValue({ ok: true, value: pendingOrder })
    await renderOrderPage()
    expect(await screen.findByText(/^Finish paying in the Square tab, or this order is released at /)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check payment' }))
    await waitFor(() => expect(api.getOrder).toHaveBeenCalledTimes(2))
  })

  it('a checkout link is kept on the device across sessions and forgotten once paid (D2)', async () => {
    const { rememberCheckoutUrl, readCheckoutUrl } = await import('./checkoutLinks')
    rememberCheckoutUrl('o1', 'https://example.com/square-checkout/o1')
    sessionStorage.clear()
    expect(readCheckoutUrl('o1')).toBe('https://example.com/square-checkout/o1')
    api.getOrder.mockResolvedValue({ ok: true, value: order({ type: 'prepaid', status: 'confirmed' }) })
    await renderOrderPage()
    await screen.findByRole('heading', { level: 2, name: 'Order confirmed' })
    expect(readCheckoutUrl('o1')).toBeNull()
  })
})

describe('accessibility review (order side)', () => {
  it('a failed read offers Try again on the private link too, and a good retry focuses the order heading (2.5.1)', async () => {
    api.getOrderByToken.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, value: order() })
    await renderOrderPage('/o/tok')
    const retry = await screen.findByRole('button', { name: 'Try again' })
    fireEvent.click(retry)
    const heading = await screen.findByRole('heading', { level: 1, name: 'Order from Vendor' })
    expect(document.activeElement).toBe(heading)
  })

  it('Enter with an invalid email announces the error each time, from a mounted polite region (3.3.1)', async () => {
    vi.useFakeTimers()
    try {
      const { addToCart } = await import('./cartStore')
      addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
      await renderCart()
      const field = screen.getByLabelText(/email/i)
      expect(field.getAttribute('aria-required')).toBe('true')
      expect(screen.getByText('Required. Your order link is sent here.')).toBeTruthy()
      const region = document.querySelector('.reserve-form [aria-live="polite"]')!
      fireEvent.submit(field.closest('form')!)
      await act(async () => vi.advanceTimersByTime(100))
      expect(region.textContent).toBe('Enter your email address')
      fireEvent.submit(field.closest('form')!)
      // Cleared first, then written again, so the repeat is read.
      expect(region.textContent).toBe('')
      await act(async () => vi.advanceTimersByTime(100))
      expect(region.textContent).toBe('Enter your email address')
    } finally {
      vi.useRealTimers()
    }
  })

  it('the stepper says the new quantity with the item, and removing a line says so (4.1.3)', async () => {
    vi.useFakeTimers()
    try {
      const { addToCart } = await import('./cartStore')
      addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
      await renderCart(null, '/e/ev/cart')
      fireEvent.click(screen.getByRole('button', { name: 'One more Item p' }))
      await act(async () => vi.advanceTimersByTime(100))
      expect(screen.getByRole('status').textContent).toBe('Item p: 2 in cart')
      fireEvent.click(screen.getByRole('button', { name: 'One fewer Item p' }))
      fireEvent.click(screen.getByRole('button', { name: 'Remove Item p' }))
      await act(async () => vi.advanceTimersByTime(100))
      // The empty cart keeps the same region, so the removal is still read.
      expect(screen.getByRole('status').textContent).toBe('Removed Item p')
    } finally {
      vi.useRealTimers()
    }
  })

  it('the wallet names its open orders with a heading (1.3.1)', async () => {
    api.listMyOrders.mockResolvedValue([order()])
    await renderWallet()
    expect(await screen.findByRole('heading', { level: 2, name: 'Open orders' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Open orders' })).toBeTruthy()
  })
})

describe('order-screens QA round', () => {
  beforeEach(() => sessionStorage.clear())

  it('the cart says how a reservation is paid in the label module wording (D7)', async () => {
    const { addToCart } = await import('./cartStore')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
    await renderCart(null, '/e/ev/cart')
    expect(screen.getByText('Booth A1 · Pay at pickup')).toBeTruthy()
  })

  it('offline, Continue is inert and says why (D4)', async () => {
    live.online = false
    const { addToCart } = await import('./cartStore')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
    await renderCart(null, '/e/ev/cart')
    const next = screen.getByRole('link', { name: 'Continue' })
    const reason = screen.getByText("You're offline. Reserve when you're back online.")
    expect(next.getAttribute('aria-disabled')).toBe('true')
    expect(next.getAttribute('aria-describedby')).toBe(reason.id)
    fireEvent.click(next)
    expect(screen.queryByLabelText(/email/i)).toBeNull()
  })

  it('offline, the storefront card Add says why it does nothing (D4)', async () => {
    live.online = false
    const { AddToCart } = await import('./AddToCart')
    render(
      <MemoryRouter useTransitions={false}>
        <AddToCart product={product('p')} booth={boothB} event={event} variant="card" />
      </MemoryRouter>,
    )
    const add = screen.getByRole('button', { name: 'Add Item p to cart' })
    expect(add.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(add.getAttribute('aria-describedby')!)?.textContent).toBe("You're offline. Add when you're back online.")
  })

  it('after a reservation, the emptied cart points to the new order (D2)', async () => {
    const { addToCart } = await import('./cartStore')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
    api.createReservation.mockResolvedValue({ ok: true, value: order({ id: 'new1' }) })
    await renderCart(<Route path="/orders/:orderId" element={<p>order page</p>} />)
    submitCart()
    await screen.findByText('order page')
    cleanup()
    // Back from the order lands on the cart, now empty.
    await renderCart(null, '/e/ev/cart')
    expect(screen.getByRole('link', { name: 'View your order' }).getAttribute('href')).toBe('/orders/new1')
    expect(screen.getByRole('link', { name: 'Browse the event' }).getAttribute('href')).toBe('/e/ev')
  })

  it('the code card folds away when the order ends, then leaves the page (D5)', async () => {
    vi.useFakeTimers()
    try {
      const { OrderView } = await import('./OrderView')
      const view = (status: Order['status']) => (
        <MemoryRouter useTransitions={false}>
          <OrderView order={order({ status })} onChange={() => undefined} />
        </MemoryRouter>
      )
      const { container, rerender } = render(view('ready'))
      rerender(view('collected'))
      const slot = container.querySelector('.order-code-slot')!
      expect(slot.classList.contains('is-leaving')).toBe(true)
      expect(slot.hasAttribute('inert')).toBe(true)
      expect(screen.queryByRole('button', { name: 'Show code at booth, full screen' })).toBeNull()
      await act(async () => vi.advanceTimersByTime(300))
      expect(container.querySelector('.order-code-slot')).toBeNull()
      expect(container.textContent).not.toContain(order().pickupCode)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('reserve opens the order page from the returned order (D7)', () => {
  it('shows the pickup code at once, with no loading state, then confirms on refresh', async () => {
    const { addToCart } = await import('./cartStore')
    const { OrderPage } = await import('./OrderPage')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
    api.createReservation.mockResolvedValue({ ok: true, value: order({ pickupCode: 'NEW234', holdEndsAt: FUTURE }) })
    const refresh = deferred<Result<Order, string>>()
    api.getOrder.mockReturnValue(refresh.promise)
    await renderCart(<Route path="/orders/:orderId" element={<OrderPage />} />)
    submitCart()
    await screen.findByText('NEW234')
    expect(screen.queryByText(/loading/i)).toBeNull()
    // Provisional until the server answers: cancel is there but off.
    expect(screen.getByRole('button', { name: 'Cancel reservation' }).getAttribute('aria-disabled')).toBe('true')
    await act(async () => refresh.resolve({ ok: true, value: order({ pickupCode: 'NEW234', holdEndsAt: FUTURE }) }))
    expect(screen.getByRole('button', { name: 'Cancel reservation' }).getAttribute('aria-disabled')).toBe('false')
  })
})

describe('a lost stock race can be fixed from the cart (D10)', () => {
  const catalogWith = (stock: Record<string, number>) => ({
    ok: true,
    value: { event, booths: [boothB], products: Object.entries(stock).map(([id, qty]) => ({ ...product(id), availableQty: qty })) },
  })

  async function lose(catalog: unknown) {
    const { addToCart } = await import('./cartStore')
    for (const id of ['p', 'p', 'q', 'r']) addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product(id) })
    api.createReservation.mockResolvedValue({ ok: false, reason: 'insufficient_stock', productIds: ['p', 'q'] })
    if (catalog instanceof Error) api.getEventCatalog.mockRejectedValue(catalog)
    else api.getEventCatalog.mockResolvedValue(catalog)
    await renderCart()
    submitCart()
    const title = await screen.findByText(/^Not enough stock left/)
    return title.closest<HTMLElement>('.cart__alert-message')!
  }

  /** The banner's title, then one line per refused item, as the design draws it. */
  const bannerParts = (message: HTMLElement) => [
    message.querySelector('.cart__alert-title')?.textContent,
    ...Array.from(message.querySelectorAll('li'), (li) => li.textContent),
  ]

  it('names what is left, focuses the error, and caps or removes the lines, then focuses the heading', async () => {
    const error = await lose(catalogWith({ p: 1, q: 0, r: 5 }))
    expect(bannerParts(error)).toEqual(['Not enough stock left', 'Item p: 1 left, 2 in your cart', 'Item q: sold out, 1 in your cart'])
    await waitFor(() => expect(document.activeElement).toBe(error))
    expect(api.getEventCatalog).toHaveBeenCalledWith('ev')

    fireEvent.click(screen.getByRole('button', { name: 'Change to what is left' }))
    expect(screen.queryByText(/^Not enough stock left/)).toBeNull()
    expect(screen.queryByText(/Item q/)).toBeNull()
    expect(screen.getByText('1 × Item p')).toBeTruthy()
    expect(screen.getByText('1 × Item r')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Reserve from Vendor' }))
    // Back in the cart, the capped line says the stock is what binds.
    cleanup()
    await renderCart(null, '/e/ev/cart')
    expect(screen.getByRole('group', { name: 'Quantity of Item p' }).textContent).toContain('1')
    expect(screen.getByText('Only 1 left')).toBeTruthy()
  })

  it('Change cart shows the new caps on the refused lines, quantities kept, so the attendee can fix them (D3)', async () => {
    await lose(catalogWith({ p: 1, q: 0, r: 5 }))
    fireEvent.click(screen.getByRole('link', { name: 'Change cart' }))
    const line = screen.getByRole('group', { name: 'Quantity of Item p' }).closest('li')!
    expect(line.classList.contains('cart__line--over')).toBe(true)
    expect(within(line).getByText('Only 1 left')).toBeTruthy()
    // The attendee's quantity stays until they change it; adding more is off.
    expect(screen.getByRole('group', { name: 'Quantity of Item p' }).textContent).toContain('2')
    expect(screen.getByRole('button', { name: 'One more Item p' }).getAttribute('aria-disabled')).toBe('true')
    expect(within(screen.getByRole('group', { name: 'Quantity of Item q' }).closest('li')!).getByText('Sold out')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Continue' })).toBeTruthy()
  })

  it('without the current stock, offers to remove the named items', async () => {
    const error = await lose(new Error('offline'))
    expect(bannerParts(error)).toEqual(['Not enough stock left', 'Item p: 2 in your cart', 'Item q: 1 in your cart'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove sold-out items' }))
    expect(screen.queryByText(/Item p/)).toBeNull()
    expect(screen.queryByText(/Item q/)).toBeNull()
    expect(screen.getByText('1 × Item r')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Reserve from Vendor' }))
  })

  it('a network refusal offers no cart change', async () => {
    const { addToCart } = await import('./cartStore')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
    api.createReservation.mockRejectedValue(new Error('offline'))
    await renderCart()
    submitCart()
    await screen.findByText(/Could not reach the server/)
    expect(screen.queryByRole('button', { name: /^(Remove sold-out items|Remove these items|Change to what is left|Lower to the limit)$/ })).toBeNull()
    expect(api.getEventCatalog).not.toHaveBeenCalled()
  })
})

describe('order refusals from the database rule (place_order)', () => {
  it('words each new reason in plain language', async () => {
    const { refusalLabels } = await import('../../shared/ui/labels')
    expect(refusalLabels.product_not_found).toBe('Some items are no longer sold')
    expect(refusalLabels.invalid_items).toBe('Something in your cart could not be ordered. Check the quantities and try again.')
    expect(refusalLabels.invalid_email).toBe('Enter a full email address, like name@example.com.')
  })

  it('a product that is no longer sold is named in the cart error, which takes focus', async () => {
    const { addToCart } = await import('./cartStore')
    for (const id of ['p', 'q']) addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product(id) })
    api.createReservation.mockResolvedValue({ ok: false, reason: 'product_not_found', productIds: ['q'] })
    await renderCart()
    submitCart()
    const error = (await screen.findByText(/^Some items are no longer sold/)).closest('.cart__alert-message')!
    expect(error.querySelector('.cart__alert-title')?.textContent).toBe('Some items are no longer sold')
    expect(Array.from(error.querySelectorAll('li'), (li) => li.textContent)).toEqual(['Item q'])
    await waitFor(() => expect(document.activeElement).toBe(error))
  })

  it('removes the items that are no longer sold, without a stock lookup, then focuses the heading', async () => {
    const { addToCart } = await import('./cartStore')
    for (const id of ['p', 'q']) addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product(id) })
    api.createReservation.mockResolvedValue({ ok: false, reason: 'product_not_found', productIds: ['q'] })
    await renderCart()
    submitCart()
    await screen.findByText(/^Some items are no longer sold/)
    // A product that is gone has no stock to read, so the item is never called sold out.
    expect(api.getEventCatalog).not.toHaveBeenCalled()
    expect(screen.queryByText(/sold out/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove these items' }))
    expect(screen.queryByText(/^Some items are no longer sold/)).toBeNull()
    expect(screen.queryByText(/Item q/)).toBeNull()
    expect(screen.getByText('1 × Item p')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Reserve from Vendor' }))
  })

  it.each([
    ['invalid_items', 'Something in your cart could not be ordered. Check the quantities and try again.'],
    ['invalid_email', 'Enter a full email address, like name@example.com.'],
  ] as const)('a %s refusal from checkout shows its wording and keeps the cart', async (reason, wording) => {
    const { addToCart } = await import('./cartStore')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: { ...boothB, mode: 'prepay' }, product: product('p') })
    api.startCheckout.mockResolvedValue({ ok: false, reason })
    await renderCart()
    submitCart(/^Pay /)
    const error = await screen.findByText(wording)
    expect(error.textContent).toBe(wording)
    expect(screen.getByText('1 × Item p')).toBeTruthy()
  })
})

describe('copy for ended and unpaid orders (D9, D12)', () => {
  it('past orders show the refund status: the badge names the refund and the row name keeps Cancelled', async () => {
    api.listMyOrders.mockResolvedValue([
      order({ id: 'a', type: 'prepaid', status: 'cancelled', refundStatus: 'due' }),
      order({ id: 'b', type: 'prepaid', status: 'cancelled', refundStatus: 'refunded', boothId: 'b2', boothCode: 'B2', boothName: 'Second' }),
      order({ id: 'c', status: 'cancelled', boothId: 'b3', boothCode: 'C3', boothName: 'Third' }),
    ])
    await renderWallet()
    const rows = await screen.findAllByRole('link', { name: /Cancelled/ })
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/Cancelled, refund due$/),
      expect.stringMatching(/Cancelled, refunded$/),
      expect.stringMatching(/Cancelled$/),
    ])
    // Short enough to sit beside the vendor name at 390 (QA edge 10); the refund implies the cancel.
    expect(rows.map((r) => r.querySelector('.past-order__badge')?.textContent)).toEqual(['Refund due', 'Refunded', 'Cancelled'])
    // Owed money is the one past-order detail the attendee may need to act on, so its pill is the warning tone.
    expect(rows[0].querySelector('.wallet-badge--refund_due')).not.toBeNull()
    expect(rows[1].querySelector('.wallet-badge--refund_due')).toBeNull()
  })

  it('an expired prepaid order says it was never charged; an expired reservation keeps its own copy', async () => {
    const { OrderView } = await import('./OrderView')
    const view = render(
      <MemoryRouter useTransitions={false}>
        <OrderView order={order({ type: 'prepaid', status: 'expired' })} onChange={() => undefined} />
      </MemoryRouter>,
    )
    expect(
      screen.getByText("The payment wasn't completed before the hold ended, so the items went back on sale. You weren't charged."),
    ).toBeTruthy()
    view.rerender(
      <MemoryRouter useTransitions={false}>
        <OrderView order={order({ status: 'expired' })} onChange={() => undefined} />
      </MemoryRouter>,
    )
    expect(screen.getByText('The hold ended before pickup.')).toBeTruthy()
  })

  it('a return from Square without payment says so and offers the way back', async () => {
    const { rememberCheckoutUrl } = await import('./checkoutLinks')
    rememberCheckoutUrl('o1', 'https://example.com/square-checkout/o1')
    api.getOrder.mockResolvedValue({ ok: true, value: order({ type: 'prepaid', status: 'pending_payment', holdEndsAt: FUTURE }) })
    api.confirmCheckout.mockResolvedValue({ ok: false, reason: 'payment_not_verified' })
    await renderOrderPage('/orders/o1?checkout=return')
    await screen.findByText('Payment not completed yet. You can continue to payment while the hold lasts.')
    expect(screen.getByRole('link', { name: 'Continue to payment' })).toBeTruthy()
  })

  it('offline, the cart says when to reserve', async () => {
    live.online = false
    const { addToCart } = await import('./cartStore')
    addToCart({ eventSlug: 'ev', currency: 'USD', booth: boothB, product: product('p') })
    await renderCart()
    const note = screen.getByText("You're offline. Reserve when you're back online.")
    expect(screen.getByRole('button', { name: /^Reserve$/ }).getAttribute('aria-describedby')).toBe(note.id)
  })
})

describe('Square returns to the private link (D1)', () => {
  afterEach(() => vi.useRealTimers())

  it('shows the check, polls every 3 s without confirming, and stops once the webhook confirms', async () => {
    vi.useFakeTimers()
    const { CHECKOUT_RETURN_POLL_MS } = await import('./OrderPage')
    const pending = order({ type: 'prepaid', status: 'pending_payment', holdEndsAt: FUTURE })
    api.getOrderByToken.mockResolvedValue({ ok: true, value: pending })
    await renderOrderPage('/o/secret-token?checkout=return')
    await act(async () => undefined)
    expect(screen.getByText('Checking your payment...')).toBeTruthy()
    const reads = api.getOrderByToken.mock.calls.length
    await act(async () => vi.advanceTimersByTime(CHECKOUT_RETURN_POLL_MS))
    expect(api.getOrderByToken.mock.calls.length).toBe(reads + 1)

    api.getOrderByToken.mockResolvedValue({ ok: true, value: order({ type: 'prepaid', status: 'confirmed' }) })
    await act(async () => vi.advanceTimersByTime(CHECKOUT_RETURN_POLL_MS))
    expect(screen.getByRole('heading', { level: 2, name: 'Order confirmed' })).toBeTruthy()
    expect(screen.queryByText('Checking your payment...')).toBeNull()
    const settledReads = api.getOrderByToken.mock.calls.length
    // Back on the normal poll.
    await act(async () => vi.advanceTimersByTime(CHECKOUT_RETURN_POLL_MS * 3))
    expect(api.getOrderByToken.mock.calls.length).toBe(settledReads)
    expect(api.confirmCheckout).not.toHaveBeenCalled()
  })

  it('gives up the fast poll after the window and shows the normal pending text', async () => {
    vi.useFakeTimers()
    const { CHECKOUT_RETURN_POLL_MS, CHECKOUT_RETURN_WINDOW_MS } = await import('./OrderPage')
    api.getOrderByToken.mockResolvedValue({ ok: true, value: order({ type: 'prepaid', status: 'pending_payment', holdEndsAt: FUTURE }) })
    await renderOrderPage('/o/secret-token?checkout=return')
    await act(async () => undefined)
    await act(async () => vi.advanceTimersByTime(CHECKOUT_RETURN_WINDOW_MS))
    expect(screen.queryByText('Checking your payment...')).toBeNull()
    expect(screen.getByText('Your items are held while you pay with Square.')).toBeTruthy()
    const reads = api.getOrderByToken.mock.calls.length
    await act(async () => vi.advanceTimersByTime(CHECKOUT_RETURN_POLL_MS * 3))
    expect(api.getOrderByToken.mock.calls.length).toBe(reads)
    expect(api.confirmCheckout).not.toHaveBeenCalled()
  })
})

describe('order page in the design system (design/order-page)', () => {
  async function renderView(o: Order) {
    const { OrderView } = await import('./OrderView')
    return render(
      <MemoryRouter useTransitions={false}>
        <OrderView order={o} onChange={() => undefined} />
      </MemoryRouter>,
    )
  }

  it('the cancel sheet keeps Tab inside, and Escape closes it with focus back on the opener', async () => {
    await renderView(order())
    const opener = screen.getByRole('button', { name: 'Cancel reservation' })
    fireEvent.click(opener)
    const sheet = screen.getByRole('dialog', { name: 'Cancel this reservation?' })
    expect(sheet.getAttribute('aria-modal')).toBe('true')
    const confirm = within(sheet).getByRole('button', { name: 'Cancel reservation' })
    const keep = within(sheet).getByRole('button', { name: 'Keep reservation' })
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(confirm)
    fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(document.activeElement).toBe(keep)
    // Wraps at both ends.
    fireEvent.keyDown(keep, { key: 'Tab' })
    expect(document.activeElement).toBe(confirm)
    fireEvent.keyDown(confirm, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(keep)
    // The pull-to-refresh and edge swipe-back gestures stay out of the sheet.
    expect(sheet.closest('[data-no-pull][data-no-swipe-back]')).not.toBeNull()
    fireEvent.keyDown(keep, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('names the progress step in text, and shows no steps for pending or ended orders', async () => {
    const view = await renderView(order({ status: 'ready' }))
    expect(screen.getByText('Step 2 of 3: Ready')).toBeTruthy()
    view.unmount()
    await renderView(order({ type: 'prepaid', status: 'pending_payment' }))
    expect(screen.queryByText(/^Step \d of 3/)).toBeNull()
  })

  it('a private link that finds no order says so and offers the way on', async () => {
    api.getOrderByToken.mockResolvedValue({ ok: false, reason: 'order_not_found' })
    await renderOrderPage('/o/bad-token')
    expect(await screen.findByRole('heading', { level: 1, name: "This link doesn't open an order" })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to my orders' }).getAttribute('href')).toBe('/orders')
    expect(screen.getByRole('link', { name: 'Go to event home' }).getAttribute('href')).toBe('/')
  })

  it('a refund owed after a vendor cancel shows the banner, the reason and the paid line', async () => {
    await renderView(order({ type: 'prepaid', status: 'cancelled', cancelReason: 'Item damaged', refundStatus: 'due' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Order cancelled' })).toBeTruthy()
    expect(await screen.findByText('Vendor cancelled this order.')).toBeTruthy()
    expect(screen.getByText('Refund due:')).toBeTruthy()
    expect(screen.getByText('Item damaged')).toBeTruthy()
    expect(screen.getByText('Paid $8.00 with Square')).toBeTruthy()
    expect(screen.queryByText('ABC234')).toBeNull()
  })

  it('a prepaid order can be cancelled while confirmed; the sheet says the vendor refunds it, then it reads refund due (FR-10)', async () => {
    const { OrderView } = await import('./OrderView')
    const { ATTENDEE_CANCEL_REASON } = await import('./orderStatus')
    const paid = order({ type: 'prepaid', status: 'confirmed' })
    api.cancelMyOrder.mockResolvedValue({
      ok: true,
      value: order({ type: 'prepaid', status: 'cancelled', cancelReason: ATTENDEE_CANCEL_REASON, refundStatus: 'due' }),
    })
    function Harness() {
      const [o, setO] = useState<Order>(paid)
      return <OrderView order={o} onChange={setO} />
    }
    render(
      <MemoryRouter useTransitions={false}>
        <Harness />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }))
    const sheet = screen.getByRole('dialog', { name: 'Cancel this order?' })
    expect(within(sheet).getByText(/Vendor refunds your payment through Square/)).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Keep order' })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel order' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Order cancelled' })).toBeTruthy()
    expect(api.cancelMyOrder).toHaveBeenCalledWith(paid.id)
    expect(screen.getByText('You cancelled this order.')).toBeTruthy()
    expect(screen.getByText('Refund due:')).toBeTruthy()
    // The attendee's own cancel is said once, by the status line, not again as a reason row.
    expect(screen.queryByText(ATTENDEE_CANCEL_REASON)).toBeNull()
  })

  it('a pending payment offers no cancel; there is nothing to refund yet', async () => {
    await renderView(order({ type: 'prepaid', status: 'pending_payment' }))
    expect(screen.queryByRole('button', { name: /^Cancel/ })).toBeNull()
  })

  it("an attendee's own cancelled reservation says so, and a vendor cancel still names the vendor", async () => {
    const { ATTENDEE_CANCEL_REASON } = await import('./orderStatus')
    const mine = await renderView(order({ status: 'cancelled', cancelReason: ATTENDEE_CANCEL_REASON }))
    expect(screen.getByText('You cancelled this reservation.')).toBeTruthy()
    mine.unmount()
    await renderView(order({ status: 'cancelled', cancelReason: 'Sold out at the booth' }))
    expect(screen.getByText('Vendor cancelled this reservation.')).toBeTruthy()
    expect(screen.getByText('Sold out at the booth')).toBeTruthy()
  })

  it('a collected order is a receipt: a stamp says where and when, no code, and offers ordering again', async () => {
    const collectedAt = '2026-11-13T14:14:00Z'
    await renderView(order({ status: 'collected', collectedAt }))
    const time = new Date(collectedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    expect(await screen.findByText(`Collected at ${time}`)).toBeTruthy()
    expect(screen.getByText('Booth A1', { selector: '.order-pass__stamp-detail' })).toBeTruthy()
    // The stamp says it, so the status line does not repeat it.
    expect(screen.queryByText(/^Handed over at/)).toBeNull()
    expect(screen.queryByText('ABC234')).toBeNull()
    expect(screen.getByRole('link', { name: 'Order again from Vendor' }).getAttribute('href')).toBe('/e/ev/booth/b')
  })

  it('the vendor block opens the storefront from its pass, as one link that keeps the h1', async () => {
    await renderView(order({ status: 'collected' }))
    const link = await screen.findByRole('link', { name: 'Vendor storefront, Booth A1' })
    expect(link.getAttribute('href')).toBe('/e/ev/booth/b')
    // The heading keeps its own name; the link holds no other control.
    expect(screen.getByRole('heading', { level: 1, name: 'Order from Vendor' })).toBeTruthy()
    expect(link.querySelector('a, button')).toBeNull()
  })

  it('with the event unknown on this device (a private link opened cold), the vendor block is plain text', async () => {
    const cold = order({ status: 'collected' })
    Reflect.deleteProperty(cold, 'eventSlug')
    await renderView(cold)
    await screen.findByRole('heading', { level: 1, name: 'Order from Vendor' })
    expect(screen.queryByRole('link', { name: /storefront/ })).toBeNull()
    expect(document.querySelector('.pass-name-chevron')).toBeNull()
  })

  describe('the booth of an order (FR-17)', () => {
    const catalogAnswer = { ok: true, value: { event: EVENT, booths: BOOTHS, products: [] } }

    it('names the booth from the order at once; the pickup instructions follow from the event catalog', async () => {
      const catalog = deferred<typeof catalogAnswer>()
      api.getEventCatalog.mockReturnValue(catalog.promise)
      await renderView(order({ status: 'ready' }))
      expect(screen.getByRole('heading', { level: 1, name: 'Order from Vendor' })).toBeTruthy()
      expect(screen.getByText('Booth A1')).toBeTruthy()
      expect(screen.getByText('Show this code at Booth A1.')).toBeTruthy()
      expect(screen.getByRole('link', { name: 'Find booth: Booth A1' }).getAttribute('href')).toBe('/e/ev/map?booth=b')
      expect(screen.queryByText('Front table')).toBeNull()

      await act(async () => catalog.resolve(catalogAnswer))
      expect(api.getEventCatalog).toHaveBeenCalledWith('ev')
      expect(screen.getByText('Front table')).toBeTruthy()
    })

    it('a booth the event catalog no longer lists has no Find booth and no storefront link', async () => {
      const gone = { ok: true, value: { event: EVENT, booths: [catalogBooth('other', 'Z9', 'Other')], products: [] } }
      const catalog = deferred<typeof gone>()
      api.getEventCatalog.mockReturnValue(catalog.promise)
      await renderView(order({ status: 'ready' }))
      // Until the catalog answers, the booth is assumed to be there.
      expect(screen.getByRole('link', { name: 'Find booth: Booth A1' })).toBeTruthy()

      await act(async () => catalog.resolve(gone))
      expect(screen.queryByRole('link', { name: /Find booth/ })).toBeNull()
      expect(screen.queryByRole('link', { name: /storefront/ })).toBeNull()
      expect(document.querySelector('.pass-name-chevron')).toBeNull()
      // The order still names its booth from its own record.
      expect(screen.getByRole('heading', { level: 1, name: 'Order from Vendor' })).toBeTruthy()
      expect(screen.getByText('Booth A1')).toBeTruthy()
    })

    it('an order that does not name its event slug uses the slug the host names for its event id', async () => {
      const { provideOrderEventSlug } = await import('./orderExtras')
      provideOrderEventSlug('e', 'host-event')
      const bare: Order = { ...order() }
      delete (bare as Partial<ReturnType<typeof order>>).eventSlug
      await renderView(bare)
      expect(screen.getByRole('link', { name: 'Find booth: Booth A1' }).getAttribute('href')).toBe('/e/host-event/map?booth=b')
      expect(await screen.findByText('Front table')).toBeTruthy()
      expect(api.getEventCatalog).toHaveBeenCalledWith('host-event')
    })

    it('remembers the slug the shell named, so a reload or a later visit to the order still has it', async () => {
      const first = await import('./orderExtras')
      first.provideOrderEventSlug('e', 'host-event')
      vi.resetModules()
      const reloaded = await import('./orderExtras')
      const bare: Order = { ...order() }
      delete (bare as Partial<ReturnType<typeof order>>).eventSlug
      expect(reloaded.orderEventSlug(bare)).toBe('host-event')
    })

    it('with no event slug at all, offers no map link and no instructions, and still names the booth', async () => {
      const bare: Order = { ...order() }
      delete (bare as Partial<ReturnType<typeof order>>).eventSlug
      await renderView(bare)
      expect(screen.getByRole('heading', { level: 1, name: 'Order from Vendor' })).toBeTruthy()
      expect(screen.queryByRole('link', { name: /^Map/ })).toBeNull()
      expect(api.getEventCatalog).not.toHaveBeenCalled()
    })

    it('keeps the pickup instructions readable offline from the saved copy', async () => {
      const online = await renderView(order())
      await screen.findByText('Front table')
      online.unmount()
      vi.resetModules()
      api.getEventCatalog.mockRejectedValue(new Error('offline'))
      await renderView(order())
      expect(screen.getByText('Front table')).toBeTruthy()
    })
  })
})

describe('payment wording (FR-28)', () => {
  it('a reservation is never paid before pickup, and a pending payment is never paid', async () => {
    const { attendeeOrderLabels } = await import('./orderStatus')
    const badge = (o: Order) => attendeeOrderLabels(o).paymentBadge?.label ?? null
    const line = (o: Order) => attendeeOrderLabels(o).attendeePayment
    for (const status of ['confirmed', 'ready'] as const) {
      expect(badge(order({ status }))).toBe('Pay at pickup')
      expect(line(order({ status }))).toBe('Pay $8.00 at the booth')
    }
    // A collected reservation's line says the booth took the payment, without a badge.
    expect(badge(order({ status: 'collected' }))).toBeNull()
    expect(line(order({ status: 'collected' }))).toBe('Payment of $8.00 taken at the booth')
    expect(badge(order({ status: 'cancelled' }))).toBeNull()
    // A pending payment is never labelled paid.
    expect(badge(order({ type: 'prepaid', status: 'pending_payment' }))).toBeNull()
    expect(line(order({ type: 'prepaid', status: 'pending_payment' }))).toBe('Pay $8.00 with Square')
    // Expired unpaid shows nothing; expired with a late payment says the refund.
    expect(badge(order({ type: 'prepaid', status: 'expired' }))).toBeNull()
    expect(badge(order({ type: 'prepaid', status: 'expired', refundStatus: 'due' }))).toBe('Refund due')
    expect(badge(order({ type: 'prepaid', status: 'cancelled', refundStatus: 'refunded' }))).toBe('Refunded')
  })

  it('guards the two paths the shared labels do not cover: no crash, and never paid without a payment', async () => {
    const { attendeeOrderLabels } = await import('./orderStatus')
    // A reservation is never pending payment; if the data ever says so, the screen still renders.
    expect(attendeeOrderLabels(order({ status: 'pending_payment' })).headline).toBe('Waiting for payment')
    // A prepaid order cancelled with no refund recorded was never paid (FR-28).
    const unpaid = attendeeOrderLabels(order({ type: 'prepaid', status: 'cancelled', refundStatus: 'none' }))
    expect([unpaid.paymentBadge, unpaid.attendeePayment]).toEqual([null, null])
    expect(unpaid.headline).toBe('Order cancelled')
  })

  it('formats the hold countdown with seconds, and in minutes when motion is reduced', async () => {
    const { formatTimeLeft } = await import('./HoldTimer')
    expect(formatTimeLeft((1 * 3600 + 42 * 60 + 8) * 1000, true)).toBe('1:42:08 left')
    expect(formatTimeLeft((12 * 60 + 48) * 1000, true)).toBe('12:48 left')
    expect(formatTimeLeft(101 * 60_000 + 1, false)).toBe('102 min left')
  })
})
