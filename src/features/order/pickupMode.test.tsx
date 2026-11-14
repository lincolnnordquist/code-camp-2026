// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booth, Order } from '../../shared/types'

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

const threeOpen = () => [
  order({ id: 'o1', pickupCode: 'AAA111', boothId: 'b1', boothCode: 'A1', boothName: 'First' }),
  order({ id: 'o2', status: 'ready', pickupCode: 'BBB222', boothId: 'b2', boothCode: 'B2', boothName: 'Second' }),
  order({ id: 'o3', type: 'prepaid', pickupCode: 'CCC333', boothId: 'b3', boothCode: 'C3', boothName: 'Third' }),
]

const never = <T,>() => new Promise<T>(() => undefined)

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

async function renderOrderPage() {
  const { OrderPage } = await import('./OrderPage')
  return render(
    <MemoryRouter useTransitions={false} initialEntries={['/orders/o1']}>
      <Routes>
        <Route path="/orders/:orderId" element={<OrderPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function renderWallet() {
  const { MyOrders } = await import('./MyOrders')
  return render(
    <MemoryRouter useTransitions={false}>
      <MyOrders />
    </MemoryRouter>,
  )
}

const dialog = () => screen.getByRole('dialog')
// jsdom keeps inert content in the accessibility tree, so queries inside the view are scoped to it.
const inView = () => within(dialog())
const codeHeading = () => inView().getByRole('heading', { name: /^Pickup code:/ })

/** A pointer drag on the pickup view, from (x, y) by (dx, dy). */
function drag(dx: number, dy: number, x = 200, y = 300) {
  const el = dialog()
  fireEvent.pointerDown(el, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y })
  fireEvent.pointerMove(el, { pointerId: 1, isPrimary: true, clientX: x + dx / 2, clientY: y + dy / 2 })
  fireEvent.pointerUp(el, { pointerId: 1, isPrimary: true, button: 0, clientX: x + dx, clientY: y + dy })
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
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('pickup mode keeps its bar in reach', () => {
  it('the sticky bar shows its divider only while content is scrolled under it', async () => {
    api.getOrder.mockResolvedValue({ ok: true, value: order({ status: 'ready' }) })
    await renderOrderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Show code at booth, full screen' }))
    const view = dialog()
    const bar = view.querySelector('.pickup-mode__bar')!
    expect(bar.hasAttribute('data-scrolled-under')).toBe(false)
    view.scrollTop = 40
    fireEvent.scroll(view)
    expect(bar.hasAttribute('data-scrolled-under')).toBe(true)
    // Close stays inside the bar, so it is in reach at any scroll position.
    expect(bar.contains(screen.getByRole('button', { name: 'Close' }))).toBe(true)
    view.scrollTop = 0
    fireEvent.scroll(view)
    expect(bar.hasAttribute('data-scrolled-under')).toBe(false)
  })
})

describe('pickup mode opens only for an order with a code to hand over', () => {
  it.each(['confirmed', 'ready'] as const)('the order page offers it for %s', async (status) => {
    api.getOrder.mockResolvedValue({ ok: true, value: order({ status }) })
    await renderOrderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Show code at booth, full screen' }))
    expect(dialog()).toBeTruthy()
  })

  it.each(['pending_payment', 'collected', 'cancelled', 'expired'] as const)('the order page does not offer it for %s', async (status) => {
    api.getOrder.mockResolvedValue({ ok: true, value: order({ status, type: status === 'pending_payment' ? 'prepaid' : 'reservation' }) })
    await renderOrderPage()
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(api.getOrder).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /show code at booth/i })).toBeNull()
  })

  it('the wallet offers it on confirmed and ready passes only, ready first, each pass one button named for its booth', async () => {
    api.listMyOrders.mockResolvedValue([...threeOpen().slice(0, 2), order({ id: 'p', type: 'prepaid', status: 'pending_payment', boothId: 'b4', boothCode: 'D4', boothName: 'Fourth' })])
    await renderWallet()
    await screen.findByText('AAA111')
    const buttons = screen.getAllByRole('button', { name: /^Show at booth/ })
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Show at booth: Second, Booth B2, Ready, 1 item, $8.00, pickup code B B B 2 2 2',
      'Show at booth: First, Booth A1, Confirmed, 1 item, $8.00, pickup code A A A 1 1 1',
    ])
    // The whole pass is the button: its code and QR thumbnail are inside it.
    expect(buttons[0].textContent).toContain('BBB222')
    expect(buttons[0].querySelector('.wallet-stub__qr')).not.toBeNull()
    // The pending payment links to its order page, with no code and no QR.
    const pending = screen.getByRole('link', {
      name: 'Fourth, Booth D4, Pending payment, 1 item, $8.00. Your pickup code appears once payment is confirmed.',
    })
    expect(pending.getAttribute('href')).toBe('/orders/p')
    expect(pending.textContent).not.toContain(order().pickupCode)
    expect(pending.querySelector('img')).toBeNull()
    // No separate full-width button under each pass any more.
    expect(screen.queryAllByRole('button', { name: /^Show at booth$/ })).toHaveLength(0)
  })

  it('a saved copy past its hold offers no pickup mode while the refresh is pending', async () => {
    localStorage.setItem('orders.cache', JSON.stringify([order({ holdEndsAt: '2020-01-01T00:00:00Z' })]))
    api.getOrder.mockReturnValue(never())
    await renderOrderPage()
    expect(screen.queryByRole('button', { name: /show code at booth/i })).toBeNull()
  })
})

describe('pickup mode content', () => {
  it('is a labelled modal dialog with the code as text, the QR, status, payment and the ready line', async () => {
    api.getOrder.mockResolvedValue({ ok: true, value: order({ status: 'ready' }) })
    const { container } = await renderOrderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Show code at booth, full screen' }))
    const d = dialog()
    expect(d.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('dialog', { name: 'Vendor, Booth A1' })).toBe(d)
    expect(codeHeading().textContent).toContain('Pickup code: A B C 2 3 4')
    expect(inView().getByRole('heading', { name: 'Ready' })).toBeTruthy()
    expect(inView().getByText('Your items are waiting at the table.')).toBeTruthy()
    expect(d.textContent).toContain('Pay at pickup')
    expect(await inView().findByRole('img', { name: 'QR code of your pickup code' })).toBeTruthy()
    // The page behind is out of reach while the view is open.
    expect(container.hasAttribute('inert')).toBe(true)
  })

  it('a prepaid order says it was paid, and a confirmed one has no ready line', async () => {
    api.getOrder.mockResolvedValue({ ok: true, value: order({ type: 'prepaid' }) })
    await renderOrderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Show code at booth, full screen' }))
    expect(dialog().textContent).toContain('Paid')
    expect(screen.queryByText('Your items are waiting at the table.')).toBeNull()
  })

  it('shows the brightness hint once per session, and it can be dismissed', async () => {
    api.getOrder.mockResolvedValue({ ok: true, value: order() })
    await renderOrderPage()
    const opener = await screen.findByRole('button', { name: 'Show code at booth, full screen' })
    fireEvent.click(opener)
    expect(screen.getByText('Brighten your screen to scan')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Brighten your screen to scan')).toBeNull()
    expect(document.activeElement).toBe(codeHeading())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(opener)
    expect(screen.queryByText('Brighten your screen to scan')).toBeNull()
  })
})

describe('pickup mode focus and closing', () => {
  it('focuses the code heading, keeps Tab inside, and returns focus to the opener on Close', async () => {
    api.getOrder.mockResolvedValue({ ok: true, value: order() })
    const { container } = await renderOrderPage()
    const opener = await screen.findByRole('button', { name: 'Show code at booth, full screen' })
    opener.focus()
    fireEvent.click(opener)
    expect(document.activeElement).toBe(codeHeading())

    const close = screen.getByRole('button', { name: 'Close' })
    const dismiss = screen.getByRole('button', { name: 'Dismiss' })
    // Tab is moved by hand (Safari's default Tab skips buttons): from the code to the next control.
    fireEvent.keyDown(codeHeading(), { key: 'Tab' })
    expect(document.activeElement).toBe(dismiss)
    codeHeading().focus()
    fireEvent.keyDown(codeHeading(), { key: 'Tab', shiftKey: true })
    // Back from the code is the vendor's storefront link in the pass header, then Close.
    expect(document.activeElement).toBe(inView().getByRole('link', { name: 'Vendor storefront, Booth A1' }))
    dialog().focus()
    fireEvent.keyDown(dialog(), { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    dismiss.focus()
    fireEvent.keyDown(dismiss, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(dismiss)

    fireEvent.click(close)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(container.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('Escape closes and returns focus', async () => {
    api.getOrder.mockResolvedValue({ ok: true, value: order() })
    await renderOrderPage()
    const opener = await screen.findByRole('button', { name: 'Show code at booth, full screen' })
    fireEvent.click(opener)
    fireEvent.keyDown(codeHeading(), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('a downward drag past 100 px closes; a shorter one does not', async () => {
    api.getOrder.mockResolvedValue({ ok: true, value: order() })
    await renderOrderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Show code at booth, full screen' }))
    drag(0, 90)
    expect(screen.getByRole('dialog')).toBeTruthy()
    drag(0, 140)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('pickup mode keeps the screen awake', () => {
  it('requests a screen wake lock while open, re-acquires it when visible again, and releases it on close', async () => {
    const sentinels: Array<{ released: boolean; release: ReturnType<typeof vi.fn> }> = []
    const request = vi.fn(async () => {
      const s = { released: false, release: vi.fn(async () => void (s.released = true)) }
      sentinels.push(s)
      return s
    })
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { wakeLock: { request } }))
    api.getOrder.mockResolvedValue({ ok: true, value: order() })
    await renderOrderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Show code at booth, full screen' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'))

    // The browser drops the lock when the page is hidden; it is asked for again on return.
    sentinels[0].released = true
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(request).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(sentinels[1].release).toHaveBeenCalledTimes(1)
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('opens normally where the API is missing', async () => {
    vi.stubGlobal('navigator', Object.create(navigator))
    expect('wakeLock' in navigator).toBe(false)
    api.getOrder.mockResolvedValue({ ok: true, value: order() })
    await renderOrderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Show code at booth, full screen' }))
    expect(codeHeading()).toBeTruthy()
  })
})

describe('pickup mode follows live changes', () => {
  it('a pushed final state hides the code and QR and moves focus to the status', async () => {
    api.getOrder.mockResolvedValueOnce({ ok: true, value: order({ status: 'ready' }) })
    await renderOrderPage()
    const opener = await screen.findByRole('button', { name: 'Show code at booth, full screen' })
    fireEvent.click(opener)
    await inView().findByRole('img', { name: 'QR code of your pickup code' })

    api.getOrder.mockResolvedValueOnce({ ok: true, value: order({ status: 'collected' }) })
    await act(async () => live.listeners.forEach((l) => l()))
    const status = await inView().findByRole('heading', { name: 'Collected' })
    expect(inView().queryByRole('heading', { name: /^Pickup code:/ })).toBeNull()
    expect(screen.queryAllByRole('img', { name: 'QR code of your pickup code' })).toHaveLength(0)
    expect(dialog().textContent).not.toContain('ABC234')
    expect(screen.getByText('There is no pickup code to show for this order.')).toBeTruthy()
    expect(document.activeElement).toBe(status)

    // The opener went with the code, so closing focuses the page's status heading.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Collected' }))
  })

  it('a pushed change to ready is announced inside the view', async () => {
    api.getOrder.mockResolvedValueOnce({ ok: true, value: order() })
    await renderOrderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Show code at booth, full screen' }))
    api.getOrder.mockResolvedValueOnce({ ok: true, value: order({ status: 'ready' }) })
    await act(async () => live.listeners.forEach((l) => l()))
    const region = dialog().querySelector('[aria-live="polite"]')
    await waitFor(() => expect(region?.textContent).toBe('Ready. Your items are waiting at the table.'))
    expect(document.activeElement).toBe(codeHeading())
  })
})

describe('pickup mode pages through the wallet', () => {
  it('swipes and arrow buttons move between open orders, and closing returns to the pass', async () => {
    api.listMyOrders.mockResolvedValue(threeOpen())
    await renderWallet()
    await screen.findByText('AAA111')
    // Ready sorts first, so the wallet (and the pager) runs Second, First, Third.
    const opener = screen.getByRole('button', { name: /^Show at booth: First, Booth A1,/ })
    fireEvent.click(opener)
    expect(screen.getByRole('img', { name: 'Order 2 of 3' })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'First, Booth A1' })).toBeTruthy()

    drag(-120, 10)
    expect(screen.getByRole('img', { name: 'Order 3 of 3' })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Third, Booth C3' })).toBeTruthy()
    expect(dialog().textContent).toContain('Paid')
    drag(-120, 0)
    expect(screen.getByRole('img', { name: 'Order 3 of 3' })).toBeTruthy()

    drag(150, 20)
    drag(150, 20)
    expect(screen.getByRole('img', { name: 'Order 1 of 3' })).toBeTruthy()
    expect(codeHeading().textContent).toContain('B B B 2 2 2')
    // A short or mostly vertical drag does not page.
    drag(-40, 0)
    drag(-70, 90)
    expect(screen.getByRole('img', { name: 'Order 1 of 3' })).toBeTruthy()

    const next = screen.getByRole('button', { name: 'Next order' })
    expect(screen.getByRole('button', { name: 'Previous order' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(next)
    expect(screen.getByRole('img', { name: 'Order 2 of 3' })).toBeTruthy()
    expect(document.activeElement).not.toBe(document.body)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(document.activeElement).toBe(opener)
  })

  it('from the wallet, each order links to its page, since the pass itself opens this view', async () => {
    api.listMyOrders.mockResolvedValue(threeOpen())
    await renderWallet()
    fireEvent.click(await screen.findByRole('button', { name: /^Show at booth: First,/ }))
    expect(inView().getByRole('link', { name: 'Order details: First' }).getAttribute('href')).toBe('/orders/o1')
  })

  it('a single open order shows no pager', async () => {
    api.listMyOrders.mockResolvedValue([order()])
    await renderWallet()
    fireEvent.click(await screen.findByRole('button', { name: /^Show at booth/ }))
    expect(screen.queryByRole('button', { name: 'Next order' })).toBeNull()
    expect(screen.queryByText(/of 1/)).toBeNull()
  })
})

describe('refresh on the Orders tab', () => {
  // The shell sends the pull as a cancelable event; a screen that refreshes claims it with preventDefault.
  const pull = () => new Event('app:pull-refresh', { cancelable: true })

  it('the shell pull is claimed, triggers exactly one refresh and is answered once it settles', async () => {
    api.listMyOrders.mockResolvedValueOnce([order()])
    await renderWallet()
    await screen.findByText('ABC234')
    expect(api.listMyOrders).toHaveBeenCalledTimes(1)

    const answer = deferred<Order[]>()
    api.listMyOrders.mockReturnValueOnce(answer.promise)
    const done = vi.fn()
    window.addEventListener('app:pull-refresh-done', done)
    // A second pull while the first is running joins it. Each is claimed, so the shell holds its spinner.
    const claimed: boolean[] = []
    act(() => {
      claimed.push(!window.dispatchEvent(pull()))
      claimed.push(!window.dispatchEvent(pull()))
    })
    expect(claimed).toEqual([true, true])
    expect(api.listMyOrders).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Refresh orders' }).getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: 'Refresh orders' }).getAttribute('aria-disabled')).toBe('true')
    expect(done).not.toHaveBeenCalled()

    await act(async () => answer.resolve([order({ status: 'ready' })]))
    await waitFor(() => expect(done).toHaveBeenCalledTimes(2))
    expect(api.listMyOrders).toHaveBeenCalledTimes(2)
    // No visible "Updated" line: the status region says it.
    expect(screen.queryByText(/^Updated/)).toBeNull()
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Orders updated'))
    window.removeEventListener('app:pull-refresh-done', done)
  })

  it('the Refresh button runs one refresh for repeated clicks', async () => {
    api.listMyOrders.mockResolvedValueOnce([order()])
    await renderWallet()
    await screen.findByText('ABC234')
    const answer = deferred<Order[]>()
    api.listMyOrders.mockReturnValueOnce(answer.promise)
    const button = screen.getByRole('button', { name: 'Refresh orders' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(api.listMyOrders).toHaveBeenCalledTimes(2)
    await act(async () => answer.resolve([order()]))
    expect(screen.getByRole('button', { name: 'Refresh orders' })).toBe(button)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Orders updated'))
  })

  it('a failed refresh says so, still answers the shell, and shows the saved note', async () => {
    api.listMyOrders.mockResolvedValueOnce([order()])
    await renderWallet()
    await screen.findByText('ABC234')
    api.listMyOrders.mockRejectedValueOnce(new Error('offline'))
    const done = vi.fn()
    window.addEventListener('app:pull-refresh-done', done)
    act(() => {
      window.dispatchEvent(pull())
    })
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Could not update your orders. Showing saved orders.'))
    expect(screen.getByText('Showing saved orders. Status may have changed since.')).toBeTruthy()
    expect(screen.queryByText(/^Updated/)).toBeNull()
    window.removeEventListener('app:pull-refresh-done', done)
  })

  it('the order page re-reads once on a shell pull and answers it', async () => {
    api.getOrder.mockResolvedValueOnce({ ok: true, value: order() })
    await renderOrderPage()
    await screen.findByText('ABC234')
    expect(api.getOrder).toHaveBeenCalledTimes(1)
    api.getOrder.mockResolvedValueOnce({ ok: true, value: order({ status: 'ready' }) })
    const done = vi.fn()
    window.addEventListener('app:pull-refresh-done', done)
    let claimed = false
    act(() => {
      claimed = !window.dispatchEvent(pull())
    })
    expect(claimed).toBe(true)
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1))
    expect(api.getOrder).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('heading', { level: 2, name: 'Ready for pickup' })).toBeTruthy()
    window.removeEventListener('app:pull-refresh-done', done)
  })

  it('nothing listens once the screen has gone', async () => {
    api.listMyOrders.mockResolvedValue([order()])
    const view = await renderWallet()
    await screen.findByText('ABC234')
    view.unmount()
    const calls = api.listMyOrders.mock.calls.length
    const done = vi.fn()
    window.addEventListener('app:pull-refresh-done', done)
    // Unclaimed, so the shell retracts its spinner at once.
    expect(window.dispatchEvent(pull())).toBe(true)
    await Promise.resolve()
    expect(api.listMyOrders).toHaveBeenCalledTimes(calls)
    expect(done).not.toHaveBeenCalled()
    window.removeEventListener('app:pull-refresh-done', done)
  })
})

describe('QR quality', () => {
  it('draws the image at the device pixel ratio and reuses it for the same code and size', async () => {
    vi.stubGlobal('devicePixelRatio', 3)
    const spy = vi.fn()
    vi.doMock('qrcode', async (importOriginal) => {
      const original = await importOriginal<typeof import('qrcode')>()
      return {
        ...original,
        toDataURL: (...args: Parameters<typeof original.toDataURL>) => {
          spy(...args)
          return original.toDataURL(...args)
        },
      }
    })
    const { qrPixelSize } = await import('./qrImage')
    expect(qrPixelSize(306, 3)).toBe(918)
    expect(qrPixelSize(220.5, 2)).toBe(441)
    const { PickupQr } = await import('./PickupQr')
    const first = render(<PickupQr code="ABC234" />)
    const img = await screen.findByRole('img', { name: 'QR code of your pickup code' })
    expect(spy).toHaveBeenCalledWith('ABC234', expect.objectContaining({ width: 660, margin: 4, errorCorrectionLevel: 'M' }))
    const src = img.getAttribute('src')
    first.unmount()

    // Reopening is instant: the cached image is there in the first render.
    render(<PickupQr code="ABC234" />)
    expect(screen.getByRole('img', { name: 'QR code of your pickup code' }).getAttribute('src')).toBe(src)
    expect(spy).toHaveBeenCalledTimes(1)
    vi.doUnmock('qrcode')
  })
})
