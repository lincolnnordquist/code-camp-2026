# Event Commerce Platform — Product spec

`CONCEPT.md` sets the product direction and wins where this spec differs from it. `ARCHITECTURE.md` describes how the system is built. `TEAM-PLAN.md` says who builds what.

## Purpose

Attendees at conventions cannot easily find which booth sells an item, whether it is in stock, or how long buying it takes. This app lets an attendee open an event from a link, find a product, secure it, and collect it at the booth with a pickup code. Vendors keep their own payment setup. The build succeeds when the full journey works on phones at the demo: find, secure, vendor marks ready, attendee collects.

## Goals

- [ ] An attendee finds a product by search or on the map and reaches its storefront without an account.
- [ ] An attendee reserves limited stock and collects it with a pickup code (the reservation path).
- [ ] An attendee prepays through Square sandbox checkout, and the order is confirmed only after the server verifies the payment (the prepaid path).
- [ ] Vendor staff run their orders from a phone: mark ready, collect, cancel, adjust stock, pause ordering.
- [ ] Two attendees cannot both get the last item.
- [ ] The app is deployed and works on the phones used for the demo.

## Priorities

Each feature area carries one of three labels.

| Label | Meaning |
| --- | --- |
| **Core** | The reservation baseline. It must work at the demo. |
| **Square** | Prepaid checkout. It is built in parallel with Core from the first hour and may be reduced if it threatens the demo. |
| **Extra** | Taken on as progress permits. |
| **Setup** | Accounts, invitations, and vendor setup. Required, but built after the Core and Square journeys work. Until then the same data is seeded. |

## Non-goals

- A cart or payment that spans several vendors. Each order belongs to one booth.
- More than one login per vendor, expiring or revoking invitations, and organizers editing a vendor's content.
- Issuing refunds from the app, dispute handling, tax handling, or payment reconciliation. The vendor makes a refund in Square, and the app shows its status.
- Text message notifications.
- Ticketing, schedules, indoor navigation, recommendations, social features, and food preparation workflows.

## Users

### Attendee

- A visitor on a phone at the venue, often on a congested network, with little time.
- Opens the event from a QR code or link and never creates an account.
- Needs to find an item, secure it, and know where and when to collect it.

### Vendor staff

- One or two people at a busy booth, using a phone or tablet between walk-up customers.
- Have one vendor account with one login, and no employee accounts. Until the Setup phase the account is seeded; after it the vendor signs up or accepts an invitation.
- Set up their own branding, products, booth mode, and Square connection (FR-34 to FR-43).
- Need to see new orders, set items aside, hand them over, and stop new orders when overloaded.

### Organizer

- Has an organizer account, which is never also a vendor account.
- Creates events and invites vendors to them (FR-35 to FR-37). Until the Setup phase the event is seeded.
- A read-only overview of an event's orders is an Extra (FR-29).

## Terms

| Term | Meaning |
| --- | --- |
| Booth | One vendor's place at the event, with a location on the floor plan and a catalog. |
| Mode | How a booth takes part: `prepay`, `reservation`, or `discovery` (listing only). |
| Reservation | An unpaid order. Stock is held and the attendee pays the vendor at pickup. |
| Prepaid order | An order paid online through the vendor's Square account before pickup. |
| Hold | The period during which stock is kept for an unpaid reservation or an unfinished checkout. |
| Pickup code | A short code the attendee shows at the booth. Staff enter it to hand over the order. |

## Order statuses

An order has a type (`reservation` or `prepaid`) and one status. The type decides the payment wording; the status never implies payment.

| Status | Meaning | Can move to |
| --- | --- | --- |
| `pending_payment` | Prepaid only. Stock is held while the attendee is in Square checkout. | `confirmed`, `expired` |
| `confirmed` | The order is accepted. A reservation is unpaid; a prepaid order is verified as paid. | `ready`, `collected`, `cancelled`, `expired` (reservation only) |
| `ready` | Staff have set the items aside. | `collected`, `cancelled`, `expired` (reservation only) |
| `collected` | Handed over. Final. | none |
| `cancelled` | Cancelled by the attendee or the vendor. Final. | none |
| `expired` | The hold ran out. Final. | none |

## Functional requirements

### Discovery (Core)

FR-01: The event opens at `/e/:eventSlug` without sign-in and shows the event name, search, the floor-plan map, and the vendor directory.

FR-02: The map shows every booth at its seeded position. It is drawn on the event's floor plan image when the event has one; the image is optional. Tapping a booth opens its storefront.

FR-03: The directory lists every booth with vendor name, logo, booth code, and mode. A `discovery` booth is never shown as accepting orders.

FR-04: Search matches a keyword against product name, product category, and vendor name, with an optional category filter. Each result shows the booth code and a link to the booth's position on the map.

FR-05: A storefront shows the vendor's logo, slogan, and banner, and each product with its image, name, short description, price, and a stock state: nothing when more than 5 are available, "Only N left" at 5 or fewer, and sold out at zero. Ordering controls appear only when the booth's mode allows orders and ordering is not paused.

### Cart (Core)

FR-06: The cart holds items from one booth. Adding an item from another booth asks the attendee to replace the cart. A quantity cannot exceed the product's per-order maximum or its available quantity.

### Reservation (Core)

FR-07: Submitting a reservation with an email address and cart items creates the order on the server in one step that also deducts stock. The total is calculated from catalog prices. Outcomes:

- Accepted: the order is `confirmed` with a pickup code and a hold end time.
- Rejected with a reason: not enough stock (naming the items), over the per-order maximum, ordering paused, or the booth does not take reservations. No stock changes.

FR-08: Submitting the same request twice, for example after a retry on a poor connection, returns the first order and creates no second one.

FR-09: A reservation that is not collected by its hold end becomes `expired` and its stock returns to the product. The hold length is an event setting with a default of 120 minutes.

FR-10: An attendee can cancel their own order, reservation or prepaid, while it is `confirmed` or `ready`. The stock returns to the product. A cancelled prepaid order is marked refund due, and the vendor refunds it in Square (FR-33).

### Prepaid checkout (Square)

FR-11: Starting checkout creates a `pending_payment` order that holds stock for 15 minutes, then creates a Square hosted checkout for that booth's seller with the server-calculated total. The attendee is sent to the Square page.

FR-12: A prepaid order becomes `confirmed` only after the server fetches the payment from Square and matches seller, provider order, amount, currency, and completed status. A browser redirect or a webhook message only triggers that check.

FR-13: Confirmations that arrive twice, late, or out of order confirm the order once and record each Square payment once.

FR-14: When a `pending_payment` order reaches its hold end, the server looks the payment up in Square once more. Outcomes:

- Payment completed: the order becomes `confirmed`, as in FR-12.
- No completed payment: the server deletes the Square checkout link. When Square confirms that it cancelled the order, the order becomes `expired` and its stock returns. When Square does not confirm it, the order was paid in the meantime, and the server verifies the payment as in FR-12.

A paid order never expires.

FR-15: A payment verified after its order is `expired` or `cancelled` does not reactivate the order. The payment is recorded as refund due, and both the attendee and the vendor see that a refund is owed.

FR-33: The server receives Square's webhook messages about payments and refunds and rejects any message with an invalid signature. Each accepted message triggers a lookup of that payment or refund in Square. When Square reports a completed refund, the payment changes from refund due to refunded, and the attendee and the vendor see it.

### Attendee orders (Core)

FR-16: Placing a first order signs the browser in anonymously. The attendee sees a list of their orders across booths in that browser, and no one else's.

FR-17: The order page shows status, order type with its payment wording, items, total, pickup code, booth name and number, booth location, pickup instructions, and the hold end time where one applies. It updates without a refresh when the order changes.

FR-18: When an order is confirmed, the attendee receives an email with the pickup code and a private link. The link opens that one order on any device. A failed email does not change the order.

### Vendor (Core)

FR-19: Vendor staff sign in with email and password at `/vendor` and see only their own booth's orders and products.

FR-20: The queue lists active orders with type, items, pickup status, and payment wording. A new order appears without a refresh.

FR-21: Staff mark a `confirmed` order as `ready`.

FR-22: Staff enter a pickup code to hand over an order. A `confirmed` or `ready` order of that booth becomes `collected`; for a reservation the action states that payment was taken at the booth. Other outcomes change nothing:

- Unknown code, or a code from another booth: "not found".
- Already collected: the collection time is shown.
- Cancelled or expired: that status is shown.

FR-23: Staff cancel a `confirmed` or `ready` order with a reason, which the attendee sees. Stock is not returned automatically. A cancelled prepaid order is marked refund due.

FR-24: Staff set the available quantity of a product. Stock already held by existing orders is unaffected.

FR-25: Staff pause and resume ordering for their booth. Existing orders continue while paused.

### Connectivity and states (Core)

FR-26: When the device is offline, a banner says so, the last loaded catalog and orders stay viewable, and ordering actions are disabled. No action is shown as accepted before the server responds.

FR-27: Every screen has loading, empty, error, and offline states.

FR-28: Status and payment wording comes from one shared label module. A reservation is never labelled paid, and a pending payment is never labelled complete.

### Accounts and setup (Setup)

Built after the Core and Square journeys work. Until then the same rows are seeded, so the later screens create what the seed creates.

FR-34: A person signs up as a vendor or as an organizer. An account is one or the other. A vendor account has one login and no employees.

FR-35: An organizer creates events with a name, venue name, link, and currency, and optionally a floor plan image.

FR-36: An organizer invites a vendor to an event by email, and sees who is invited and who has accepted. An invitation does not expire and cannot be revoked. An organizer sees who is in the event, not the vendor's branding or products.

FR-37: A vendor with an account sees pending event invitations in their account settings and accepts or declines each. A vendor without an account signs up with the invited email address to answer it. Only the account with the invited, verified email can answer.

FR-38: Accepting an invitation adds the vendor to the event with a booth. Declining records the answer and changes nothing else. An invitation is answered once.

FR-39: A vendor sets their branding once: name, logo, slogan, and banner. It is the same at every event. Images are uploaded in the app.

FR-40: A vendor sets up the products of each event separately: name, category, description, photo, price, per-order maximum, and stock. A removed product is hidden, so past orders keep their items and prices.

FR-41: A vendor chooses one mode for their booth at each event: `reservation`, `prepay`, or `discovery`. `prepay` can be chosen only while the vendor has a connected Square account.

FR-42: A vendor connects their own Square account in the app, and their prepaid payments go to it.

FR-43: A vendor can upload images only into their own folder, and only PNG, JPEG, or WebP files within the size limit.

### Extra

FR-29: An organizer signs in and sees a read-only overview of booths, their modes, active orders, and collected orders.

FR-30: Staff scan a QR code shown on the attendee's order page as an alternative to typing the pickup code.

FR-31: A second booth is connected to a separate Square sandbox seller, and each booth's payments go to its own seller. FR-42 makes this the normal case.

FR-32: The app installs to the home screen and its screens load offline from a cached copy.

## Non-functional requirements

NFR-01: Stock changes and the order change that caused them happen in one database transaction, so concurrent orders cannot oversell a product.

NFR-02: Access is enforced in the database. An attendee reads only their own orders, and vendor staff read and change only their own booth's data.

NFR-03: Square tokens, the webhook signature key, the Resend key, and the Supabase service-role key exist only on the server. None appears in browser code, `VITE_` variables, or git.

NFR-04: Money is stored and calculated as integer cents with a currency code.

NFR-05: `collected`, `cancelled`, and `expired` orders never change status again.

NFR-06: Screens are designed at phone width first (360 px), with touch targets of at least 44 px and text contrast meeting WCAG AA.

NFR-07: The only attendee data stored is the email address given at ordering.

## User flows

### Reservation

1. The attendee opens the event link and searches for a product.
2. The result shows the booth; the attendee opens the storefront and adds the product to the cart.
3. The attendee enters an email address and reserves. The order page shows `confirmed`, the pickup code, and the hold end time.
4. Staff see the order in the queue, set the item aside, and mark it `ready`. The attendee's page updates.
5. At the booth the attendee shows the code and pays the vendor. Staff enter the code and the order becomes `collected`.

### Prepaid

1. Steps 1 and 2 are the same, at a booth in `prepay` mode.
2. The attendee enters an email address and starts checkout. The app sends them to Square's page.
3. After paying, the attendee returns to the order page, which shows `pending_payment` until the server has verified the payment, then `confirmed` and paid.
4. Pickup continues as in the reservation flow, without payment at the booth.

## Data model and shared functions

The tables are described in `ARCHITECTURE.md`, "Database design". The functions screens call are listed in `ARCHITECTURE.md`, "Shared API".

## Verification

- Discovery (FR-01 to FR-05): on a phone, open the event link in a private window, search for a seeded product, and reach its storefront and map position.
- Reservation (FR-07 to FR-10): a test in `tests/` reserves stock, repeats the request, lets a hold expire, and cancels, checking order status and product stock after each step.
- Last item (NFR-01): a test sends two reservations for a product with one unit at the same time. One is confirmed, one is rejected, and stock is zero.
- Prepaid (FR-11 to FR-15): complete a test payment in Square's sandbox testing panel and see the order confirmed. A test with a mismatched amount leaves the order unconfirmed, and a repeated confirmation changes nothing. After a checkout hold ends unpaid, the Square page for that order can no longer be paid.
- Webhook (FR-33): close the browser tab after paying in the sandbox, and the order is still confirmed. Refund the payment in the Square sandbox dashboard, and the order shows refunded. A test sends a message with a wrong signature, and nothing changes.
- Access (NFR-02): a test signs in as a second attendee and as staff of another booth, and neither can read or change the first attendee's order.
- Vendor (FR-19 to FR-25): on two phones, place an order on one and see it appear, become ready, and be collected on the other.
- Pickup (FR-22): a test collects an order, tries the same code again, and tries a code from another booth.
- Email (FR-18): place an order with a real address, then open the emailed link on a different device.
- Offline (FR-26): switch the phone to airplane mode. The banner shows, orders stay readable, and the reserve button is disabled.

## Open questions

- [ ] The hold lengths used in the demo. A shorter reservation hold on one seeded booth would let expiry be shown live.
- [ ] Whether one Square webhook subscription covers every seeded sandbox seller, or each seller needs its own.
- [ ] Booth code and map position. The code is assigned automatically when the booth is created (when an invitation is accepted, since a vendor has a different booth at each event). How a booth gets its map position is not decided; the map is not designed yet.
- [ ] How a vendor's Square connection is made: the authorization flow, and where each vendor's token is kept (see ARCHITECTURE.md, "Accounts, invitations, and setup"). Owned by the Payments role.
- [ ] Limits on organizer sign-up and invitation emails. For now anyone may sign up as an organizer; a limit is added later so invitations cannot be used for spam.
- [ ] The sending domain for confirmation email (see `.env.example`). Resend needs a registered domain with its DNS records verified. The domain needs no website and does not have to match the product's final name, so any domain registered tonight works.
