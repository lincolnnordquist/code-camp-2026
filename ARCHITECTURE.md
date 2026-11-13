# Architecture

**Status: planned.** No application code exists yet. This document describes the design the build starts from. Update it when a module's job, a shared function, or a rule changes.

## Overview

The app is a single-page web app that talks to Supabase. The database holds the rules that must never break: stock, order status, and who can see what. Small server-side functions handle the two jobs that need secrets, which are Square checkout and confirmation email. There is no separate application server.

## System diagram

```text
Attendee phone ─┐
                ├─ Web app (React, served by Cloudflare Pages)
Vendor phone  ──┘        │
                         │  src/shared/api
                         ▼
                 Supabase
                 ├─ Auth            anonymous attendees, vendor email + password
                 ├─ Postgres        tables, access rules, order functions
                 ├─ Realtime        pushes order changes to screens
                 └─ Edge Functions ──► Square sandbox (hosted checkout, payment lookup)
                                   └─► Resend (confirmation email)

Square sandbox ──► Edge Function `square-webhook` (a trigger to re-check a payment or refund)
```

## Stack

| Part | Choice | Why |
| --- | --- | --- |
| Web app | React, TypeScript (strict), Vite | A plain web app that opens from a QR code with no install. |
| Database | Supabase Postgres | Stock safety is a database transaction, and access rules live next to the data. |
| Sign-in | Supabase Auth | Anonymous sign-in gives each attendee a real user id without a form. |
| Live updates | Supabase Realtime | The vendor queue and the attendee's order page update without a refresh. |
| Server code | Supabase Edge Functions | Square and Resend secrets stay off the browser. |
| Payments | Square sandbox, hosted checkout | The seller's own Square account takes the payment. |
| Email | Resend | One API call sends the confirmation. It needs a verified sending domain. |
| Hosting | Cloudflare Pages | Serves the built app and redeploys on every push to `main`. |
| Tests | Vitest against a local Supabase | Order functions and access rules are tested where they run. |

## Codemap

| Module | Responsibility |
| --- | --- |
| `src/features/discover/` | Event home, map, directory, search, and storefronts. |
| `src/features/order/` | Cart, reserve and checkout forms, the attendee's order list and order page. |
| `src/features/vendor/` | Vendor sign-in, order queue, pickup-code entry, stock and pause controls. |
| `src/features/organizer/` | The read-only organizer overview (Extra). |
| `src/shared/ui/` | Shared components and the label module that holds all status and payment wording. |
| `src/shared/api/` | The only code that talks to Supabase. Screens call these functions and nothing else. |
| `src/shared/types/` | The types those functions take and return, such as `Order` and `OrderStatus`. |
| `src/shared/live/` | Realtime subscriptions and the online/offline status used by screens. |
| `supabase/migrations/` | Tables, access rules, and the database functions that create and change orders. |
| `supabase/seed.sql` | The demo event, laid out on the competition venue's floor plan, with its booths, products, and vendor accounts. |
| `supabase/functions/` | Edge Functions: `create-checkout`, `confirm-checkout`, `square-webhook`, `expire-checkouts`, `send-order-email`. |
| `supabase/functions/_shared/providers/` | All Square-specific code, behind a small provider interface. |
| `tests/` | Tests for order functions and access rules. Payment tests are in `tests/payments/`. |

Feature folders do not import from each other. Code used by more than one feature goes in `src/shared/`.

## Shared API

These functions are the meeting point of the three roles. Screens build against them from the first hour, first with seeded sample data and then with the real implementation. Names, parameters, and types change only with the Data & vendor role's agreement.

| Area | Functions |
| --- | --- |
| Catalog | `getEventCatalog(eventSlug)` returns the event, its booths, and their products. |
| Attendee orders | `createReservation`, `startCheckout`, `confirmCheckout`, `cancelReservation`, `listMyOrders`, `getOrder`, `getOrderByToken` |
| Vendor | `signInVendor`, `signOut`, `getMyBooth`, `listBoothOrders`, `markOrderReady`, `collectOrder`, `cancelOrder`, `setProductStock`, `setOrderingPaused` |
| Live | `subscribeToMyOrders`, `subscribeToBoothOrders`, `useOnlineStatus` (in `src/shared/live/`) |
| Organizer (Extra) | `getEventOverview` |

Every function that changes data returns either the result or a typed reason for refusal, such as `insufficient_stock` or `ordering_paused`. Screens show the reason; they never guess.

## Data flow

### Reservation

1. The screen calls `createReservation` with the booth, items, email address, and a request id generated in the browser.
2. The API signs the browser in anonymously if it has no session, then calls the database function `create_reservation`.
3. In one transaction the function locks the product rows, checks mode, pause, per-order maximum, and stock, deducts the stock, and inserts the order and its items with a pickup code and a hold end time.
4. The order page subscribes to the order. The vendor queue receives the new order through Realtime.
5. The API then calls `send-order-email`, which sends the confirmation with the pickup code and the private link, once per order. For a prepaid order, the function that confirms the payment sends it.

### Prepaid checkout

1. The screen calls `startCheckout`, which calls the Edge Function `create-checkout`.
2. The function checks the caller's session, creates a `pending_payment` order that holds stock, and asks Square for a hosted checkout with the server-calculated total. It returns the checkout URL.
3. The attendee pays on Square's page and returns to the order page, which calls `confirmCheckout`. Square also calls `square-webhook`, which covers an attendee who closes the tab before returning.
4. Either path runs the same check: fetch the payment from Square, then match seller, provider order, amount, currency, and completed status.
5. On a match the order becomes `confirmed` and the payment is recorded once. On no match the order stays `pending_payment` until its hold ends.

### Hold expiry

Two steps run every minute, scheduled in the database with `pg_cron`.

- **Reservations:** a database job marks overdue reservations as `expired` and returns their stock in the same transaction.
- **Unfinished checkouts:** the Edge Function `expire-checkouts` handles overdue `pending_payment` orders, because closing a checkout needs a call to Square. It looks the payment up, and confirms the order if the payment completed. Otherwise it deletes the Square checkout link. If Square's reply names the stored provider order as cancelled, the function marks the order `expired` and returns the stock. If the reply names no cancelled order, the order was paid in the meantime, and the function verifies the payment instead.

Stock is released after the link is closed, so a released item cannot be paid for afterwards. The scheduled call to `expire-checkouts` is made with `pg_net`, using a key kept in Supabase Vault.

## External integrations

| Service | Use | How |
| --- | --- | --- |
| Square sandbox | Hosted checkout and payment lookup, per seller | Called from Edge Functions through `_shared/providers/`. Each seller's access token is an Edge Function secret. |
| Resend | Confirmation email | Called from `send-order-email` with a server-side key. |
| Cloudflare Pages | Hosting | Builds `main` and serves the static app. Only `VITE_` variables are set there. |

### Square behavior the design relies on

Each point was checked against the Square sandbox.

- The order behind a checkout link is in state `DRAFT` until it is paid. It cannot be paid through the Payments API, only through the hosted page.
- Deleting the link of an unpaid order returns `cancelled_order_id` and sets that order to `CANCELED`.
- Deleting the link of a paid order succeeds but returns no `cancelled_order_id`. The order and its payment are unchanged.
- A paid checkout order is in state `OPEN`, not `COMPLETED`. Its tender carries the `payment_id`, and that payment has status `COMPLETED`. Verification reads the payment status, not the order state.
- In the sandbox the hosted page's card form is disabled. A payment is simulated in the Checkout API Sandbox Testing Panel and has source type `EXTERNAL`.

## Auth and security model

- **Attendees** are signed in anonymously at their first order. The session is stored in the browser, so orders stay with that browser. The emailed private link opens one order on any device.
- **Vendor staff** sign in with email and password. A staff row links a user to one vendor.
- **Organizer** is a seeded account used only by the Extra overview. The event row names its organizer.
- **Access rules** are row-level security policies on every table. The catalog is readable by anyone. Orders are readable by their attendee and by staff of their booth.
- **Writes** to orders, order items, and stock happen only inside database functions. The browser has no insert, update, or delete permission on those tables.
- **User-called functions** check `auth.uid()` inside the function. **Service functions** (`svc_*`) are called only by Edge Functions, are granted to `service_role` only, and check that role inside the function.
- **Edge Functions** authenticate their caller first: a session token for `create-checkout`, `confirm-checkout`, and `send-order-email`, Square's signature for `square-webhook`, and the service key for the scheduled `expire-checkouts`.
- **Secrets** are Edge Function secrets, plus the one key in Supabase Vault that the scheduled call uses. The browser receives only the Supabase URL and the public key.

## Database design

| Table | Holds |
| --- | --- |
| `events` | The event, its link slug, currency, reservation hold length, floor plan image, and organizer. |
| `vendors` | The merchant's identity, independent of any one event. |
| `booths` | A vendor's place at an event: booth code, map position, mode, pause flag, pickup instructions. |
| `vendor_staff` | Which signed-in users may act for which vendor. |
| `products` | A booth's catalog: name, short description, image, price in cents, category, available quantity, per-order maximum. |
| `orders` | One attendee's order at one booth: the attendee's user id, the request id, type, status, total, pickup code, email, private link token, hold end time, cancellation reason, and the times it was collected and its email was sent. A prepaid order also stores its Square checkout link id and Square order id. |
| `order_items` | The products and quantities in an order, with the price at the time of ordering. |
| `payments` | One row per verified Square payment: provider ids, amount, currency, verified time, and refund status (none, due, or refunded). |
| `provider_connections` | Which payment provider and seller location a vendor uses, and the name of the secret holding its token. |

Notes on meaning:

- `products.available_qty` is the stock still open to new orders. Stock held by an active order is already deducted.
- `orders.status` is the pickup status only. Whether money was taken is read from the order type and the `payments` table.
- A pickup code is unique among a booth's active orders and is only ever checked together with the booth.
- Internal helper functions live in a `private` schema that the API does not expose.

## Invariants

- Browser code never inserts, updates, or deletes orders, order items, or stock directly.
- Screens never import the Supabase client. They call `src/shared/api/`.
- A stock change and the order change that caused it are in one transaction.
- An order is `confirmed` as paid only after the server has fetched the payment from Square and matched it.
- `collected`, `cancelled`, and `expired` are final.
- Totals are calculated on the server from catalog prices.
- Money is integer cents.
- Every `security definer` function sets `search_path = ''` and has execute granted by name.
- Square-specific code stays in `supabase/functions/_shared/providers/`.

## Design decisions

- **Order rules live in database functions.** One transaction covers the stock check and the order, and the rule holds no matter which screen or agent wrote the caller.
- **Anonymous session plus email, no attendee accounts.** Ordering needs no sign-up, the access rules are the same as for a signed-in user, and the email covers a lost browser session.
- **Verification by lookup, not by message.** The return from checkout and the webhook are both treated as hints. Only Square's own record of the payment confirms an order.
- **Participation and booth are one table.** A vendor at an event has exactly one booth in this build. `vendors` stays separate so a vendor can appear at more events later.
- **Search runs in the browser.** The seeded event has a few booths and a few dozen products, so the catalog is loaded once and filtered locally. Search then works offline. A large event needs search on the server (see "Intentional simplifications").

## Intentional simplifications

Each row is a choice for the 24-hour build, with the path a commercial version would take. Add a row when a shortcut changes behavior.

| Area | This build | Later |
| --- | --- | --- |
| Merchant connection | Seeded vendors and seeded Square sandbox sellers | Self-service Square authorization and connection management |
| Refunds | The vendor refunds in Square; the app shows refund due, then refunded | Refunds issued through the provider, with reconciliation |
| Attendee access | Orders stay with one browser, plus an emailed link per order | Optional accounts and order recovery across devices |
| Hold expiry | One hold length per event | Per-vendor windows, reminders, and no-show rules |
| Pickup | A typed code | Scanning, pickup capacity, and express stations |
| Event setup | Seeded event, floor plan, and booths | Floor-plan and booth import, vendor invitations |
| Vendor catalog | Seeded products; a vendor cannot add or edit them | An optional onboarding step that imports items from the vendor's connected system, so they are not entered one by one |
| Stock | A manually set quantity per product | Sync with the vendor's point-of-sale stock |
| Staff access | One staff role per vendor | Multiple staff roles and permissions |
| Search | The whole catalog is loaded and filtered in the browser | Search in the database, returning one page of results at a time |
| Offline | A banner, cached reading, ordering disabled | Queued actions with clear pending states |
