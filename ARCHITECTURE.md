# Architecture

**Status: partly built.** Built: the app scaffold, the attendee screens, the shared types, the shared API and live module calling Supabase (reads, reservations, cancelling, the private order link, vendor functions, and Realtime), the database tables with the order, vendor, checkout, payment, refund, and email functions and the demo event seed, the payment provider module with payment verification, and the Edge Functions `create-checkout`, `confirm-checkout`, `expire-checkouts`, and `send-order-email`. Planned: the vendor screens, the `square-webhook` Edge Function, the scheduled call to `expire-checkouts`, and the Setup phase below. Update this document when a module's job, a shared function, or a rule changes.

## Overview

The app is a single-page web app that talks to Supabase. The database holds the rules that must never break: stock, order status, and who can see what. Small server-side functions handle the two jobs that need secrets, which are Square checkout and confirmation email. There is no separate application server.

## System diagram

```text
Attendee phone ─┐
                ├─ Web app (React, served by a Cloudflare Worker)
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
| Hosting | Cloudflare Workers static assets | Serves the built app and redeploys on every push to `main`. |
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

These functions are the meeting point of the three roles. Screens build against them from the first hour, first with sample data and now with the real implementation. Names, parameters, and types change only with the Data & vendor role's agreement.

| Area | Functions |
| --- | --- |
| Catalog | `getEventCatalog(eventSlug)` returns the event, its booths, and their products. |
| Attendee orders | `createReservation`, `startCheckout`, `confirmCheckout`, `cancelMyOrder`, `listMyOrders`, `getOrder`, `getOrderByToken` |
| Vendor | `signInVendor`, `signOut`, `getMyBooth`, `listBoothOrders`, `markOrderReady`, `collectOrder`, `cancelOrder`, `setProductStock`, `setOrderingPaused` |
| Live | `subscribeToMyOrders`, `subscribeToBoothOrders`, `useOnlineStatus` (in `src/shared/live/`) |
| Organizer (Extra) | `getEventOverview` |

Every function that changes data returns either the result or a typed reason for refusal, such as `insufficient_stock` or `ordering_paused`. Screens show the reason; they never guess.

`getMyBooth()` returns the signed-in vendor's own booth as `{ event, booth, products }`, or a refusal: `not_signed_in` (no session, or only an attendee's anonymous session) or `no_booth` (a staff login with no booth). The vendor screens call it on load: it restores a vendor after a page refresh, and gives the stock and pause screens the booth, its event, and its products as they are now. A vendor with booths at several events gets the most recent one.

A failure to reach the server is different: the function throws, and the screen shows its error state. Only an answer from our own functions is returned as a result. `listMyOrders` returns an empty list when the browser has no session, and never signs anyone in; the first `createReservation` or `startCheckout` signs the browser in anonymously.

### Database functions the browser calls

These are the functions behind `src/shared/api/`. Each is granted to signed-in users only (attendees are anonymous sessions) and authorizes with `auth.uid()` inside the function. Like the service functions, they return JSON with `"ok": true` plus fields, or `"ok": false` with a `"reason"`. A function never says whether an order that is not yours exists: that case returns `order_not_found`.

| Function | For | What it does | Refusal reasons |
| --- | --- | --- | --- |
| `create_reservation(p_booth_id, p_items, p_email, p_request_id)` | Attendee | Deducts stock and creates a `confirmed` reservation with a pickup code and a hold end. A repeated `p_request_id` returns the first order. | The checkout reasons from `svc_create_pending_order`, except `checkout_unavailable`; also `not_signed_in` |
| `cancel_my_order(p_order_id)` | Attendee | Cancels their own `confirmed` or `ready` order, reservation or prepaid, and returns the stock. A prepaid order's payment becomes refund due. | `order_not_found`, `not_allowed_in_status` |
| `get_order_by_token(p_token)` | Anyone, no session | Opens one order from the private link in its confirmation email. Returns the attendee's view of the order, with no email address, token or provider ids. An unknown token gets the same `order_not_found`. | `order_not_found` |
| `mark_order_ready(p_order_id)` | Staff | `confirmed` to `ready`. | `order_not_found`, `not_allowed_in_status` |
| `collect_order(p_booth_id, p_pickup_code)` | Staff | Hands over a `confirmed` or `ready` order of that booth. | `not_found`, `already_collected` (with `at`), `cancelled`, `expired` |
| `cancel_order(p_order_id, p_reason)` | Staff | Cancels a `confirmed` or `ready` order with a reason. Stock is not returned. A prepaid order's payment becomes refund due. | `order_not_found`, `reason_required`, `not_allowed_in_status` |
| `set_product_stock(p_product_id, p_available_qty)` | Staff | Sets the quantity open to new orders. | `product_not_found`, `invalid_quantity` |
| `set_ordering_paused(p_booth_id, p_paused)` | Staff | Pauses or resumes new orders for a booth. | `booth_not_found` |

Reads need no function. `order_details` is a view that gives each order with its event, booth number, vendor name, and a refund state read from its payments (owed, refunded, or none), without the email address or the private token; it applies the access rules of the caller. The catalog is read straight from the tables, which anyone may read. Order results use the same fields as `svc_create_pending_order` (`orderId`, `status`, `pickupCode`, `holdEndsAt`, `totalCents`, `items`, and so on); `src/shared/api/` maps them to the `Order` type.

Reservation expiry is a database job, `private.expire_reservations()`, scheduled by `pg_cron` every minute. It expires reservations whose hold has ended and returns their stock in one transaction. It never touches a prepaid order.

### Service functions for Edge Functions

Edge Functions change orders only through these database functions. Each is granted to `service_role` only and checks that role inside the function. Call them with the service-role client (`supabase.rpc(name, args)`).

**Contract.** Every function returns JSON with `"ok": true` plus the fields below, or `"ok": false` with a `"reason"` (the function raises an error only when the caller is not `service_role`). Result fields are camelCase, matching the provider types. Arguments are named `p_...`. Money is integer cents.

These five are built.

| Function | Arguments | Success returns | Refusal reasons |
| --- | --- | --- | --- |
| `svc_create_pending_order` | `p_user_id`, `p_booth_id`, `p_items` (`[{ "productId", "quantity" }]`), `p_email`, `p_request_id` | `orderId`, `boothId`, `type`, `status`, `pickupCode`, `holdEndsAt`, `totalCents`, `currency`, `buyerEmail`, `items` (`productId`, `name`, `quantity`, `unitPriceCents`), `checkoutLinkId`, `providerOrderId`, `connection` (`tokenSecretName`, `locationId`) | `checkout_unavailable`, `booth_not_accepting_orders`, `ordering_paused`, `invalid_email`, `invalid_items`, `empty_cart`, `product_not_found`, `over_max_per_order`, `insufficient_stock` (the last three also return `productIds`) |
| `svc_attach_checkout` | `p_order_id`, `p_checkout_link_id`, `p_provider_order_id` | nothing more | `order_not_found`, `not_pending` (with `status`), `already_attached` |
| `svc_expire_checkout` | `p_order_id`, `p_provider_order_id` | `changed` | `order_not_found`, `not_pending` (with `status`), `hold_not_ended`, `provider_order_mismatch` |
| `svc_release_checkout` | `p_order_id`, `p_provider_order_id` | `changed` | `order_not_found`, `not_pending` (with `status`), `provider_order_mismatch` |
| `svc_list_overdue_checkouts` | `p_limit` (default 50) | `orders`: `orderId`, `checkoutLinkId`, `providerOrderId`, `totalCents`, `currency`, `connection` | none |

Rules the functions keep:

- `svc_create_pending_order` runs the same checks as `create_reservation` and holds the stock for `events.checkout_hold_minutes` (15 by default). The Edge Function authenticates the attendee first and passes their user id. A repeated `p_request_id` for the same user returns the first order and holds no more stock, so a retry is safe. Use the returned `orderId` as Square's idempotency key.
- `svc_attach_checkout` repeats safely with the same ids. A different pair on an attached order is refused.
- `svc_expire_checkout` is called only after the Square link was deleted and Square named the cancelled order. Pass that provider order id, which must equal the one stored. Pass `null` for an order whose checkout was never created (nothing attached). It refuses before the hold ends, never expires a `confirmed` order, and returns `changed: false` for an order that is already `expired`. Stock returns in the same transaction.
- `svc_release_checkout` frees the stock of an unpaid checkout now, without waiting for its hold. It follows the same proof rule as `svc_expire_checkout`: pass the provider order id that Square reported as cancelled after the link was deleted, or `null` when no checkout was ever attached. Call it when Square refuses to create the checkout, and when a checkout is closed after a failed payment. Stock never returns while the Square link can still be paid. If `svc_attach_checkout` answers `not_pending`, the order was released while the link was being created: delete that link. The order ends `expired`, the same as a hold that ran out.
- `svc_list_overdue_checkouts` returns the oldest `pending_payment` orders past their hold, with what is needed to look each up in Square. An order without `checkoutLinkId` never reached Square.

#### Confirming a payment, refunds, and the confirmation email

These are built too. The Edge Function has already fetched the payment from Square and verified it with `verifyPayment`; these functions trust that and add a second check against our own order.

| Function | Arguments | Success returns | Refusal reasons |
| --- | --- | --- | --- |
| `svc_get_checkout` | `p_order_id`, `p_user_id` | `orderId`, `status`, `checkoutLinkId`, `providerOrderId`, `totalCents`, `currency`, `connection` | `order_not_found` (also when the order is not that user's, or is not prepaid) |
| `svc_get_checkout_by_provider_order` | `p_provider_order_id` | the same fields | `order_not_found` |
| `svc_get_checkout_by_provider_payment` | `p_provider_payment_id` | the same fields | `order_not_found` (also for a payment we have not recorded) |
| `svc_confirm_paid_order` | `p_provider_order_id`, `p_provider_payment_id`, `p_amount_cents`, `p_currency`, `p_location_id` | the order (as for `svc_create_pending_order`, with `buyerEmail`), `outcome`, `changed` | `order_not_found`, `location_mismatch`, `currency_mismatch`, `amount_mismatch`, `payment_belongs_to_other_order` |
| `svc_mark_refunded` | `p_provider_payment_id`, `p_provider_refund_id` | `changed` | `payment_not_found`, `invalid_refund_id` |
| `svc_mark_email_sent` | `p_order_id`, `p_user_id` (optional) | `outcome`: `first_time` (with the order, `buyerEmail`, `pickupCode`, `boothCode`, `boothName`, and `privateToken`) or `repeat` | `order_not_found`, `not_confirmed` (with `status`) |
| `svc_clear_email_sent` | `p_order_id`, `p_user_id` (optional) | nothing more | `order_not_found` |

Rules the functions keep:

- `svc_get_checkout_by_provider_payment` is for the refund path. A refund message names its own Square order, not the one that was paid, so only the payment id leads back to the order and the seller's connection. It finds only payments we have recorded, and returns the order whatever its status (a refund-due payment belongs to an expired or cancelled order, and a normal paid order can be refunded). For an unrecorded payment the answer is `order_not_found`, and the webhook answers 500 so Square delivers the message again, since a refund can arrive before its payment.
- `svc_confirm_paid_order` finds the order by `p_provider_order_id` and locks it, so the return page and the webhook arriving together confirm it once (FR-13). It refuses, and changes nothing, when the amount, the currency, or the seller location does not match our order and the booth's `provider_connections`.
- `outcome` is `confirmed` (the order was `pending_payment` and is now `confirmed`, even when its hold has ended but the expiry job has not run yet), `already_confirmed` (the same payment id again: no second payment row), or `refund_due`. `refund_due` means the money is owed back: the order was `expired` or `cancelled`, or it was already paid by a different payment. The payment is recorded as refund due and the order is left unchanged, with stock untouched (FR-15). The same payment id repeated never records a second row.
- `svc_mark_refunded` finds the payment by its Square payment id and marks it `refunded` for any completed refund, partial or not, and whether or not the payment was refund due. The refund id is recorded, so a repeated refund message returns `changed: false`.
- `svc_mark_email_sent` is a claim made **before** sending: it sets `email_sent_at` only when empty, and the Edge Function sends only on `first_time`. If the send fails, it calls `svc_clear_email_sent` so the next trigger retries; a failed email never changes the order (FR-18). `p_user_id` is passed when the caller is an attendee session and must own the order: `send-order-email` for a reservation and `confirm-checkout` for a prepaid order. The webhook and `expire-checkouts` have no user and pass nothing.

### Images

Product photos and vendor logos and banners are files in the public Supabase Storage bucket `assets`. The database stores only the path inside the bucket (`image_path`, `logo_path`, `banner_path`), which is the same on every project; `src/shared/api/` builds the public address, so screens receive `imageUrl`, `logoUrl`, and `bannerUrl`. Paths follow one folder per vendor, named by a lowercase slug: `vendors/<vendor-slug>/logo.<ext>` and `banner.<ext>`, and `products/<vendor-slug>/<product-slug>.<ext>`. To replace an image, upload it under a new file name and update the path, because the same path can stay cached. The demo images are in `supabase/seed-assets/`, uploaded with `supabase seed buckets`; the product photos are official merchandise images for the demo only (`supabase/SEED-IMAGE-CREDITS.md`), and the generic `placeholders/` files are a fallback. Only the service role and the dashboard can upload.

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
- **Unfinished checkouts:** the Edge Function `expire-checkouts` handles overdue `pending_payment` orders, because closing a checkout needs a call to Square. An order with a completed payment is never expired; a verified payment confirms it through `svc_confirm_paid_order`, and the confirmation email is sent. An order whose payment is still in progress is left for the next run. For any other order, the function deletes the Square checkout link. The order becomes `expired` and its stock returns once Square shows its order cancelled. The delete reply names that order, or, when an earlier run already deleted the link, the Square order reads `CANCELED`.

Stock is released after the link is closed, so a released item cannot be paid for afterwards. The scheduled call to `expire-checkouts` is made with `pg_net`, using a key kept in Supabase Vault.

## External integrations

| Service | Use | How |
| --- | --- | --- |
| Square sandbox | Hosted checkout and payment lookup, per seller | Called from Edge Functions through `_shared/providers/`. Each seller's access token is an Edge Function secret. |
| Resend | Confirmation email | Called from `send-order-email` with a server-side key. |
| Cloudflare Workers | Hosting | Builds `main` and serves the static app. Only `VITE_` variables are set there. |

### Square behavior the design relies on

Each point was checked against the Square sandbox.

- The order behind a checkout link is in state `DRAFT` until it is paid. It cannot be paid through the Payments API, only through the hosted page.
- Deleting the link of an unpaid order returns `cancelled_order_id` and sets that order to `CANCELED`.
- Deleting the link of a paid order succeeds but returns no `cancelled_order_id`. The order and its payment are unchanged.
- Deleting a link that was already deleted also succeeds and returns no `cancelled_order_id`. The order state tells the two cases apart: `CANCELED` for the deleted link, `OPEN` for the paid one.
- A repeated create request with the same idempotency key returns the same link. The same key with a different request body is refused with `IDEMPOTENCY_KEY_REUSED`.
- Square validates the pre-filled buyer email. It refuses `buyer@example.com` with `INVALID_EMAIL_ADDRESS` and creates no link.
- A paid checkout order is in state `OPEN`, not `COMPLETED`. Its tender carries the `payment_id`, and that payment has status `COMPLETED`. Verification reads the payment status, not the order state.
- A card payment sends the webhook `payment.created` with payment status `APPROVED`, then `payment.updated` with `COMPLETED`.
- A refund's `order_id` names a different order from the one that was paid. Its `payment_id` names the refunded payment, and that payment keeps status `COMPLETED`.
- In the sandbox the hosted page's card form is disabled. A payment is simulated in the Checkout API Sandbox Testing Panel and has source type `EXTERNAL`. The panel opens without a Square sign-in, so a test payment can be completed on any phone.

## Auth and security model

- **Attendees** are signed in anonymously at their first order. The session is stored in the browser, so orders stay with that browser. The emailed private link opens one order on any device.
- **Vendor staff** sign in with email and password. A staff row links a user to one vendor. The account is seeded until the Setup phase, which adds sign-up and invitations.
- **Organizer** is a seeded account used only by the Extra overview. The event row names its organizer. The Setup phase makes organizers real accounts that create events.
- **Access rules** are row-level security policies on every table. The catalog is readable by anyone. Orders are readable by their attendee and by staff of their booth.
- **Writes** to orders, order items, and stock happen only inside database functions. The browser has no insert, update, or delete permission on those tables.
- **User-called functions** check `auth.uid()` inside the function. **Service functions** (`svc_*`) are called only by Edge Functions, are granted to `service_role` only, and check that role inside the function.
- **Edge Functions** authenticate their caller first: a session token for `create-checkout`, `confirm-checkout`, and `send-order-email`, Square's signature for `square-webhook`, and the service key for the scheduled `expire-checkouts`.
- **Table privileges** are stated in a migration (`table_grants`), not left to Supabase's defaults, which differ between project versions. Anonymous users may read the catalog, signed-in users may read what the access rules allow, nothing is writable from the browser, and only the service role reaches `provider_connections` and `payment_refunds`.
- **Secrets** are Edge Function secrets, plus the one key in Supabase Vault that the scheduled call uses. The browser receives only the Supabase URL and the public key.

## Database design

| Table | Holds |
| --- | --- |
| `events` | The event, its link slug, venue name, currency, reservation hold length, optional floor plan image, and organizer. |
| `vendors` | The merchant's identity, independent of any one event, with its logo, slogan, and banner. |
| `booths` | A vendor's place at an event: booth code, map position, mode, pause flag, pickup instructions. |
| `vendor_staff` | Which signed-in users may act for which vendor. |
| `products` | A booth's catalog: name, short description, image path, price in cents, category, available quantity, per-order maximum. |
| `orders` | One attendee's order at one booth: the attendee's user id, the request id, type, status, total, pickup code, email, private link token, hold end time, cancellation reason, and the times it was collected and its email was sent. A prepaid order also stores its Square checkout link id and Square order id. |
| `order_items` | The products and quantities in an order, with the price at the time of ordering. |
| `payments` | One row per verified Square payment: provider ids, amount, currency, verified time, and refund status (none, due, or refunded). |
| `provider_connections` | Which payment provider and seller location id a vendor uses, and the name of the secret holding its token. |

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

## Accounts, invitations, and setup (planned)

Not built. This is the plan for the Setup phase (SPEC.md, FR-34 to FR-43), built after the Core and Square journeys work. Everything below adds to the tables that exist; nothing built so far changes except where noted. Until then the same rows are seeded, so the seed and the later screens create the same data.

### Accounts

- An account is a vendor or an organizer, never both. The type is stored on a profile row per user (`profiles`: user id, type) and checked inside each function with `auth.uid()`.
- A vendor account is one user linked to one vendor through `vendor_staff`, with one user per vendor.
- An organizer owns the events they create (`events.organizer_id`). The event row names its organizer, as the Extra overview already assumes.
- Sign-up and invitation emails need real email sending. Supabase's built-in mailer is limited, so authentication emails go through Resend as the project's SMTP, on the verified sending domain.

### Invitations

An `invitations` table holds the event, the invited email address, a status (`pending`, `accepted`, `declined`), who invited, and when it was answered. One invitation per email per event. There is no expiry and no revoking.

- An organizer invites an email address. The Edge Function that sends the email belongs with the Payments role's other email code.
- A vendor sees invitations whose email matches their verified account email. The email address is the credential, so a link alone is not enough to accept.
- Accepting creates the booth for that vendor at that event in one transaction and marks the invitation accepted. Declining only marks it declined. An answered invitation cannot be answered again.
- A vendor without an account opens the emailed link, signs up with that same email address, and then sees the invitation.

### Vendor setup

- **Branding** (`vendors`: name, logo, slogan, banner) is entered once and is the same at every event.
- **Products** stay on the booth, so a vendor enters them per event. A removed product is hidden (`archived`), not deleted, because past orders point to it.
- **Mode** stays one value per booth: `reservation`, `prepay`, or `discovery`. The database refuses `prepay` for a vendor with no Square connection, and refuses a Square disconnect while a booth is on `prepay`.
- Required branding fields mean a new vendor has none yet. The plan is a `published` state on the booth that becomes true only when the required fields are filled in, so attendees never see a half-finished booth. A booth stays hidden from attendees until it is published.
- A booth's code is assigned automatically when the booth is created, that is, when an invitation is accepted.
- Organizers read who is in their event (booths and vendor names), not the vendor's branding or products.

### Image uploads

Uploads come from the vendor's browser straight to the `assets` bucket with the user's own session. A storage rule allows writing only into the caller's own folder, `vendors/<vendor id>/...` and `products/<vendor id>/...`, with PNG, JPEG, or WebP files up to the bucket's size limit. SVG is removed from the allowed types before this opens, because an SVG can carry scripts. A database function checks that a path it is given starts with the caller's own vendor id before it saves the path. The seeded demo keeps its slug folders. The app shrinks large photos in the browser before uploading.

### Square connection per vendor

Today the token of a seeded seller is an Edge Function secret named in `provider_connections`. A vendor who connects their own account cannot be given a hand-set secret, so the token is stored per vendor. The plan is Supabase Vault, which the project already uses, with `provider_connections` pointing to the Vault entry instead of an Edge Function secret name. Square's authorization flow runs in an Edge Function in the Payments role's folder. The shape of this change is for the Payments role to confirm.

### Order of work

1. Core and Square journeys on seeded data (in progress).
2. Accounts, profiles, and events created by organizers.
3. Vendor setup: branding, products, mode, uploads.
4. Square connection per vendor.
5. Invitations.

Each step works without the next. The first step's seeded vendor, booth, and organizer rows are the same rows the later steps create.

## Intentional simplifications

Each row is a choice for the 24-hour build, with the path a commercial version would take. Add a row when a shortcut changes behavior.

| Area | This build | Later |
| --- | --- | --- |
| Merchant connection | Seeded vendors and seeded Square sandbox sellers, until the Setup phase | Self-service Square authorization and connection management (planned: see "Accounts, invitations, and setup") |
| Refunds | The vendor refunds in Square; the app shows refund due, then refunded. Any completed refund marks the payment refunded, including a partial one | Refunds issued through the provider, with reconciliation that tracks partial refunds |
| Payment verification | Refunds are not read. A payment refunded in Square before its order is confirmed still confirms the order | Verification that reads the refunded amount, including partial refunds |
| Unmatched payments | A completed payment that does not match its order's amount, currency, seller, or Square order leaves the order `pending_payment` with its stock held. The vendor resolves it in Square | Reading every tender of a split payment, and a review list for payments that do not match |
| Attendee access | Orders stay with one browser, plus an emailed link per order | Optional accounts and order recovery across devices |
| Hold expiry | One hold length per event | Per-vendor windows, reminders, and no-show rules |
| Event time zone | Events store no time zone. The confirmation email shows the hold end in America/Denver time | A time zone stored per event |
| Pickup | A typed code | Scanning, pickup capacity, and express stations |
| Event setup | Seeded event, floor plan, and booths, until the Setup phase | Organizers create events and invite vendors (planned); floor-plan and booth import |
| Vendor catalog | Seeded products until the Setup phase, which lets a vendor add and edit them per event | An optional onboarding step that imports items from the vendor's connected system, so they are not entered one by one |
| Stock | A manually set quantity per product | Sync with the vendor's point-of-sale stock |
| Staff access | One staff role per vendor | Multiple staff roles and permissions |
| Search | The whole catalog is loaded and filtered in the browser | Search in the database, returning one page of results at a time |
| Offline | A banner, cached reading, ordering disabled | Queued actions with clear pending states |
