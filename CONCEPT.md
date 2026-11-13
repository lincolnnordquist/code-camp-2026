# Event Commerce Platform — Product Concept

**Date:** November 12, 2026  
**Document type:** Reconciled product direction

## Purpose and authority

This document records the agreed product direction. It describes **what we intend to build, whom it serves, why it matters, and how the Codecamp demonstration relates to the larger product**.

It is not a substitute for functional specifications, database design, implementation tasks, a team roles plan, or the design-system artifact. Those are in `SPEC.md`, `ARCHITECTURE.md`, `TEAM-PLAN.md`, and the design system.

## In the demo, if time allows, and later

What the Codecamp demo includes, what is added only if time allows, and what belongs to the real product later. `SPEC.md` is the source for exactly what to build: Core and Square items are in the demo, Extra items are added if time allows, and its Non-goals are later. "To decide" marks a question nobody has settled yet. The accounts and setup rows are in the demo's scope but are built after the Core and Square journeys work (`SPEC.md`, "Setup"); until then the same data is seeded.

| Area | In the demo | If time allows | Later |
| --- | --- | --- | --- |
| Discovery | Event map, vendor directory, product search, storefronts | Better product filtering | |
| Payment | Square sandbox prepaid checkout, and reservations paid at the booth. Each vendor connects their own Square account, and can choose prepay only with one | A second Square sandbox seller (FR-31) | Live providers beyond Square, reconciliation, taxes |
| Refunds | The vendor refunds in Square; the app shows refund due, then refunded | | Refunds issued through the provider |
| Event stock | Allocated quantities with server-controlled holds | | POS stock sync and discrepancy handling |
| Unpaid holds | One rule: 120 minutes for a reservation, 15 minutes for a checkout | | Vendor-set hold times, reminders, no-show handling |
| Pickup | Confirmed → Ready → Collected, with a typed pickup code | QR code scanning (FR-30) | Pickup capacity, express stations, richer staff workflows |
| Attendee orders | No account. Order list in the same browser, plus an emailed link for each order | "Find my orders" with a code sent to the order email, once agreed | Optional accounts and order recovery across devices |
| Attendee data | Email address only | | To decide: a phone number |
| Vendors | Seeded vendors first. Then vendor accounts: an organizer invites a vendor by email, the vendor accepts or declines, and sets up their own branding, logo, products with photos, booth mode, and Square connection in the app | | Importing a catalog from the vendor's connected system |
| Vendor staff | One login per vendor account and one booth per event | | Employee accounts, multi-staff permissions and staff management |
| Vendors at several events | A vendor account can be invited to several events. Its branding is shared; its products and booth are separate for each event. Pending invitations show in its account settings | | To decide: a "My events" list for vendors |
| Event setup | Seeded event first. Then organizers create their own events, with the floor plan image optional, and a booth is created for a vendor when they accept an invitation | | Floor-plan and booth import |
| Organizer | Organizer accounts, separate from vendor accounts. An organizer creates events and invites vendors, and sees who is in the event but not their branding or products | Read-only overview of orders (FR-29). To decide: whether it shows sales totals | Editing booths, expiring or revoking invitations, limits on organizer sign-up, reporting on event results |
| Event end | Nothing closes; orders are kept | | To decide: closing ordering when the event ends, and how past events appear |
| Connectivity | Offline banner, last loaded data stays viewable, ordering disabled offline | Installable app that loads offline (FR-32) | Offline recovery and provider-aware sync |

These simplifications are design decisions, not excuses for broken behavior. If a feature is implemented differently than anticipated, update this table before the demo. Judges should hear about a few **intentional and relevant** simplifications, not a long list of missing features.

## 1. The problem and opportunity

Attendees at conventions and music events have limited time. They may want specific merchandise but cannot easily find which booth sells it, whether it is still available, or how long it will take to purchase. Waiting in merchandise lines can mean missing performances, panels, signings, or other event experiences.

For independent exhibitors, advance sales can create new work: a small booth may already be busy serving walk-up customers, use a different POS than neighboring booths, and lack dependable inventory synchronization. Organizers want a better attendee experience but cannot realistically ask every merchant to abandon established payment tools.

Existing event products already offer maps, vendor directories, storefronts, preorder features, and fulfillment tools. **The opportunity is not to claim those features are new.** It is to make them work together across participating independent sellers, with low setup friction, accurate availability, and a manageable pickup process. That opportunity is a hypothesis to validate with organizers, vendors, and attendees—not a proven market gap.

## 2. Product definition and positioning

**Definition:** A mobile-first event merchandise discovery, ordering, and pickup platform that connects attendees, merchants, and event organizers while accommodating merchants' existing commerce and payment systems.

**Attendee promise:** *Find what you want, secure it, and get back to the event.* Prepay-and-pickup is the preferred experience where supported; an unpaid reservation is a clearly differentiated alternative.

**Vendor/organizer promise:** *Give many independent booths one connected event experience without forcing them onto the same POS.* Merchant compatibility and fast onboarding are central objectives, not blanket claims of universal integration.

**Our role:** Coordinate event discovery, commerce-related order information, event inventory allocation, pickup, and operational visibility. We are **not** building a replacement POS, payment processor, ticketing platform, or all-in-one event-management suite. Participating merchants retain their own payment relationships. The product does not need to take custody of merchant funds or split a multi-vendor payment.

The attendee benefit leads the presentation. Interoperability explains **how** the platform makes that experience possible across different sellers.

## 3. Target markets and initial customer

**Initial market:** Conventions, especially independent-artist alleys and merchandise-heavy exhibitor areas at anime, comic, and similar events. These combine product-discovery problems with independent merchants using varied tools.

**Second market in the product vision:** Concerts and music festivals, particularly merchandise locations and participating artists. Their event schedules and high-demand periods make pickup coordination valuable, though larger venues may have centralized merchandise operators and exclusive contracts.

**Likely paying customer:** The event organizer, not the ordinary attendee. The initial business model to test is an organizer-paid license per event. Vendor participation should be inexpensive and low-friction. Neither price nor willingness to pay has yet been validated.

**First commercial pilot hypothesis:** One midsize convention and approximately 5–10 willing exhibitors, before broader rollout. Use real onboarding, participation, wait-time, fulfillment, and satisfaction data to decide whether the product merits expansion.

## 4. Product principles

1. **Integrate; do not replace.** Respect merchants' payment providers, commerce systems, and existing operations.
2. **Make participation easy.** Support multiple participation levels rather than requiring every vendor to connect a POS.
3. **Lead with attendee value.** Finding products and getting reliable pickup matters more to attendees than processor names.
4. **No required download to browse.** Open the event through a QR code or web link; make the experience work well on a phone.
5. **Accuracy before claims.** Never label an unpaid reservation as prepaid, a pending payment as complete, or an unconfirmed action as successful.
6. **Make fulfillment realistic.** Software cannot create an express lane or extra staff; vendors and organizers must set up practical pickup arrangements.
7. **Keep it maintainable.** Simplify what we implement under time pressure without confusing merchants, booths, orders, payments, and fulfillment conceptually.
8. **Complement existing event tools.** Reuse floor plans, booth lists, and vendor information instead of requiring organizers to recreate them where permitted.
9. **Expand through evidence.** Provider support, organizer adoption, and the effect on lines must be measured rather than assumed.

## 5. Three connected experiences

### Attendee

An attendee opens the event through a link or QR code, explores its floor plan and vendor directory, searches for vendors **and products**, selects merchandise at a participating booth, and sees real availability and pickup options. Browsing does not require account registration.

For an online-payment-enabled vendor, the attendee completes a provider-hosted checkout and receives an event order once payment is verified. For a reservation-enabled vendor, the attendee can hold allocated stock for a stated period and pay the merchant at pickup. A discovery-only vendor has a listing but does not falsely appear order-enabled.

The attendee can return to confirmed order details and pickup instructions, see whether an order is ready, and present a pickup code. Where feasible, orders from different vendors are visible in one event order history even though **each vendor has a separate transaction**. Order access must be private and recoverable through an appropriate mechanism; the specific identity design belongs in the specification.

The map and directory are complementary, not competing navigation methods. Search results should reveal relevant booth locations. Product-level search is intentionally important, since attendees often know the item they want before knowing its seller.

### Vendor

A merchant participates through an organizer invitation, with minimal setup, and signs up for a vendor account to accept it. The merchant can appear for discovery only, maintain an event-specific catalog and manual stock allocation, or connect a supported commerce provider when that capability exists.

A simple vendor-facing view shows incoming orders, their payment/reservation type, item details, pickup instructions, and status. Staff can mark an order ready, verify collection, and pause new orders without losing existing ones. The experience should work on a phone or tablet with large controls and few unnecessary steps.

For vendors without POS inventory synchronization, a specific quantity is allocated to advance orders and physically set aside. That allocation must not be silently sold to walk-up customers. Onboarding should preserve existing vendor tools rather than force a new POS workflow.

### Organizer

The organizer defines the event and participating booths, connects vendors to locations, and oversees readiness and fulfillment. Over time, they can import a floor plan and booth list, invite merchants, monitor integration health, and understand order volume and pickup performance.

The Codecamp version first uses **preconfigured event and booth information**. Organizer accounts, event creation, and inviting vendors are then built on top of the working order journeys (`SPEC.md`, "Setup"). The read-only organizer overview of orders stays an extra if time and integration progress permit.

## 6. Participation and payment modes

The modes serve different merchant needs and must not be presented as interchangeable.

| Mode | Attendee experience | Merchant/payment meaning |
| --- | --- | --- |
| **Prepay and pick up — preferred** | Selects merchandise, completes an online checkout, receives verified order and pickup details | The merchant's supported provider processes payment; our platform manages event fulfillment |
| **Reserve now, pay at pickup — alternative** | Holds an available item for a defined period and receives a reservation code | No online payment was taken; the merchant collects payment at the booth |
| **Discovery only** | Finds the booth, products or external links | No in-platform order, guaranteed availability, or checkout |

A reservation can save browsing time and protect availability, but it **does not fully eliminate checkout waiting**. Where the venue supports it, merchants should provide a clear reservation pickup/payment point; do not promise line-skipping without real physical arrangements.

**Connectivity:** Conventional web checkout and new server-confirmed reservations need a working network connection. Venue Wi-Fi may help where cellular service is congested. Previously loaded event information and already-confirmed pickup details may remain viewable offline if cached. Offline requests are **pending, not accepted**, until the server confirms them. In-person contactless or merchant POS offline modes are separate payment mechanisms and do not make a new offline web checkout possible.

## 7. Orders, inventory, and pickup: agreed behavioral principles

**Keep ordering, payment, and fulfillment separate.** An order's fulfillment status must not be mistaken for payment success, and the merchant's provider remains the authority for actual payment outcomes.

**Simple core fulfillment flow:** `Confirmed → Ready for pickup → Collected`. Cancellation and expiration are separate outcomes. A prepaid checkout may temporarily have `Pending payment`; only a verified provider result can make it a paid confirmed order. No extra `Preparing` step is required for the Codecamp prepackaged-merchandise flow.

**Inventory protection:** The backend must ensure two concurrent attendees cannot both claim the final allocated item. Stock is held or reserved through a server-controlled transaction, not through a count calculated by the browser. A failed, cancelled, or expired unpaid request releases its allocated inventory according to its actual state. Paid orders must **not** be silently expired and resold under the same rule as unpaid reservations.

**Checkout edge cases:** Starting a hosted checkout may require a temporary stock hold. Confirmations can arrive late, more than once, or out of order; the implementation must match events to the correct order and avoid double charging or double fulfillment. A browser redirect alone does not prove payment. The exact state machine and cleanup mechanism belong in `SPEC.md` and `ARCHITECTURE.md`.

**Reservation expiration:** The competition version should use a simple, real, server-enforced hold period and return stock when it expires. *Two hours is an illustrative default, not a finalized policy.* More sophisticated vendor-configurable durations, reminders, and no-show rules can follow commercially. The implemented mechanism must work, not merely display an expiry label.

**Quantity limits:** A simple server-enforced maximum per order belongs in the competition experience. This is not the same as preventing one anonymous attendee from placing multiple orders to bypass a per-person limit; stronger abuse prevention is a separate problem.

**Pickup confirmation:** Staff verify a vendor-scoped, unguessable pickup credential and prevent duplicate collection. A short, readable code is a dependable MVP fallback; QR scanning is optional enhancement. Vendors should be able to cancel an order for an actual stock problem with a clear outcome for the attendee. The specification must address incorrect scans, simultaneous staff actions, and cancellation/recovery rules.

**Order history:** A single attendee can have orders from several merchants, but checkout remains **one merchant per transaction**. Do not build a multi-merchant pooled cart or payment split for Codecamp.

## 8. Codecamp product scope and priorities

The competition is a **24-hour build by three developers using coding agents**, not a solo or manually coded project. We should pursue substantial working functionality in parallel while protecting the end-to-end demo. Priorities guide effort; they are **not** arbitrary ceilings on what the team can achieve.

### Core functional path — establish and protect

- Mobile-first event home, custom floor-plan map, and vendor directory.
- Product and vendor search over the participating event's catalog; straightforward keyword/category search is sufficient initially.
- Vendor storefronts, product details, available quantities, and a single-vendor cart.
- A functioning reservation flow and server-side protection of limited event stock, including a simple real hold expiry and per-order quantity cap.
- Vendor order queue, minimal stock controls and pause/resume ordering.
- Clear Confirmed → Ready → Collected journey, secure pickup credential, and attendee status updates.
- Correct separation of merchant access and attendee order access, plus honest connectivity and error states.
- A deployed, responsive working experience on the devices used for the demonstration.

This reservation flow is the **reliable baseline**, not the ultimate product preference. It gives the team an integrated, testable commerce-and-pickup path even if external checkout integration encounters problems.

### Priority parallel track — real prepaid checkout

**Actively pursue a real Square sandbox checkout early**, rather than waiting until every other screen is finished. Use a merchant-specific sandbox connection to create a hosted payment and verify the provider's result before confirming the order. Connect it to the **same attendee order-status and vendor pickup experience** as manual reservations.

If progress permits, demonstrate additional independently configured sandbox merchant accounts. That can show merchant-specific payment routing, but **does not prove self-service account linking, universal POS compatibility, automatic catalog sync, or support for all real merchants**. Each vendor connecting their own Square account in the app is part of the Setup phase and is built after the first payment pathway is credible; how it is done is for the Payments role to confirm.

The Square track has explicit progress assessments and may be reduced or isolated if it threatens the working demonstration. It is a high-priority intended feature, **not an unconditional guarantee of completion**.

### Additional value if progress permits

- Small read-only organizer overview showing participating vendors, active orders, and fulfillment activity.
- QR camera scanning on top of reliable text-based pickup verification.
- Improved product filtering, visual polish, additional merchant participation examples, and other low-dependency enhancements.
- Additional sandbox merchant connections or self-service onboarding work, only after the core product and first payment pathway are credible.

### Out of scope for the competition's core path

Ticketing, admission scanning, social networking, food preparation workflows, full indoor navigation, AI recommendations, a complete event schedule manager, multi-vendor payment splitting, custom POS device apps, broad payment-provider coverage, and production-grade reconciliation or tax automation. These are not implied commitments for the commercial product either.

## 9. Technical direction and extensibility

**Preferred starting stack:** React + TypeScript + Vite for a responsive PWA-style web application; Supabase PostgreSQL, Auth, real-time updates, and server-side functions; deployed on Cloudflare Workers static assets.

**Integration principle:** A capability-aware provider layer mediates supported merchant operations. The attendee experience should not hard-code Square-specific assumptions. Manual participation remains supported. Square is the first integration target; Clover and Shopify are future investigation and implementation candidates, not promised live integrations.

**Data-model principle:** Preserve the conceptual distinction between **merchant identity**, **participation at a given event**, **physical booth/location**, **products and event stock**, **orders**, **fulfillment**, and **provider connection**. A 24-hour implementation may sensibly combine certain records, but must not make later staff access, multiple events, booths, or merchant-specific provider connections unnecessarily difficult. The number of tables is not a target in itself.

**Reliability principles:** server-side inventory transactions; authorization boundaries; no sensitive provider credentials in frontend code; idempotent payment and pickup operations; clear payment-state verification; minimal attendee data; secure order retrieval; and an explicit failure path when network or provider operations are uncertain. The actual schema, APIs, security rules, and adapter interface belong in `ARCHITECTURE.md` and `SPEC.md`.

The codebase should be understandable to teammates, reviewers, and judges: coherent responsibilities, consistent naming, documented boundaries, and a small number of reliable pathways are preferable to clever but opaque shortcuts.

## 10. Experience and design direction

- **Attendee:** A distinctive, polished, visually engaging event companion; efficient map/search navigation; understandable merchandise availability, checkout type, and pickup status; no required installation or login to browse.
- **Vendor:** A calm, high-contrast working interface with prominent new orders, one-tap actions, minimal busywork, and clear warnings or pause controls.
- **Organizer:** A focused view of participating booths and event operations, rather than a giant administrative suite.
- **Across experiences:** Accessible mobile typography and touch targets, consistent order status language, useful empty/error/loading states, and honest network feedback.

The design system, a Claude artifact made with Claude Cowork, holds the visual identity, tokens, component definitions, states, layouts, and responsive guidance.

## 11. Business model and validation

**Initial commercial hypothesis:** Organizers pay a per-event software fee for improved merchandise discovery, participation, and fulfillment visibility. A free or discounted first pilot may be worthwhile in exchange for measured results and vendor feedback. No fee, price, or willingness-to-pay claim is yet validated.

**Evidence to seek:** merchant setup time, vendor participation rate, shopper search/order usage, inventory accuracy, pickup waiting and fulfillment time, merchant workload, successful pickup completion, organizer satisfaction, and repeat intent.

**Risks to validate:** low merchant participation; staffing and physical pickup arrangements; exclusive event or merchandise contracts; provider integration availability and maintenance; inaccurate walk-up inventory; weak venue connectivity; refund, tax, and chargeback responsibilities; and attendee privacy. Prepaid production pilots require appropriate merchant terms and payment/reconciliation behavior before handling real money.

The larger ambition is a reusable organizer and merchant platform with event and booth imports, easy self-service connections, supported catalog and inventory synchronization, vendor-managed pickup capacity, schedule-aware collection, notifications, broader analytics, and selectively developed POS-native fulfillment. Features should be added based on real value, not merely because they are technically possible.

## 12. Competition execution and judging philosophy

The team will plan its documentation, workflow rules, responsibilities, technical contracts, interaction patterns, and design-system specifications ahead of coding. AI assistance is welcomed at the event (the organizer's flyer says "Bring your agent"). Application implementation begins with the competition.

Work should be divided into parallel streams—for example attendee experience, vendor experience, and commerce/backend—after shared interfaces and responsibilities are agreed. The exact human roles and agent/file ownership will be set in a separate **plain-language `TEAM-PLAN.md`** after the specifications have been reviewed.

**Track progress without turning checkpoints into inflexible gates.** A feature may be *implemented* in isolation, *integrated* with other parts, or *demo-ready* on actual devices. These are useful signals, not reasons to stop all other work until every edge case is perfect. Checkpoints answer: *What works now? What blocks someone else? What should be attempted, simplified, or stabilized next?*

Time targets for deployment, the first end-to-end flow, payment integration, and feature freeze are guides to decision-making, not automatic pass/fail deadlines. Work may take more or less time than expected. Maintain an early deployed version, integrate continuously, and reserve meaningful time for device testing, presentation rehearsal, and rest. A working demo takes priority over speculative features; core correctness around payments, inventory, and order confirmation is not optional.

The demonstration should ideally show: attendee finds limited merchandise → secures it → vendor sees the order → marks it ready → attendee collects it. If the Square track works, contrast a **manual vendor** with a **prepaid sandbox vendor** within the same event. A reliable last-item inventory demonstration can illustrate technical expertise. The team must also be ready to show the **source code** as part of judging, with a short explanation of the transaction boundary and key implementation decisions.

Position the product accurately: do not imply that every merchant POS can already connect or that an unpaid reservation eliminates every line. Explain the practical value, what is implemented, and what is planned.

## 13. What is not yet decided

- What the organizer overview shows, including whether it shows sales totals.
- What happens when an event ends: whether ordering closes, and how past events appear to vendors and attendees.
- Whether vendors at several events get a "My events" list.
- Whether "Find my orders" with an email code is added.
- Whether the organizer overview and additional sandbox merchants fit the actual build pace.

These are **decisions to make deliberately**, not permission for an implementation agent to silently change the product vision.

## 14. Where the details are

`SPEC.md` (behavior, states, acceptance criteria), `ARCHITECTURE.md` (technical contracts, data model, security, deployment), `TEAM-PLAN.md` (roles and checkpoints), and the design system carry the details. This concept governs where they differ.
