# Team plan

How three developers and their coding agents build this app in 24 hours without getting in each other's way. Everything here is a starting proposal. Change it together whenever it stops helping.

## The three roles

Each folder has one owner, so two people rarely edit the same file. Each role mixes kinds of work, so nobody does only screens or only server code.

| Role | Fits the person who | Builds | Folders |
| --- | --- | --- | --- |
| **Payments & design** | Knows how payments work and is strongest at design | Square checkout from start to finish, confirmation email, the design system, and the shared status and payment wording. | `supabase/functions/`, `src/shared/ui/`, `tests/payments/` |
| **Attendee app** | Has built an event app with a map and QR codes | Everything the attendee sees: map, search, storefronts, cart, order page, offline states, and QR as an Extra. | `src/features/discover/`, `src/features/order/` |
| **Data & vendor** | Knows tables and Supabase setup | Project scaffolding, Supabase and hosting setup, the tables and order functions, the functions screens call, live updates, tests, and the vendor queue. | `supabase/migrations/`, `supabase/seed.sql`, `src/shared/api/`, `src/shared/types/`, `src/shared/live/`, `tests/` (except `tests/payments/`), `src/features/vendor/` |

The organizer overview (`src/features/organizer/`) is an Extra. Whoever is free first takes it.

### How the split works

- **Everyone gets a mix.** Payments & design has server code and design. Attendee app has screens plus the map and QR work. Data & vendor has the database plus the vendor screen, which is a direct view of its own order functions.
- **The vendor queue is the swing area.** It needs a bare version by hour 8 for the first full journey. If the Data & vendor role is stretched, the vendor queue is the first whole area to hand to whoever is free.
- **Helping works by whole tasks.** Someone who finishes early asks an owner "what can I take?" and takes one complete piece in that folder, or reviews. They do not start editing alongside the owner.
- **Design continues without owning screens.** The Payments & design role owns the shared components and wording, and reviews how screens look. If design becomes too much next to payments, a teammate takes a set of shared components as a whole task.

### Is the load fair?

- **Payments & design** carries the most unknowns, because Square is an outside service. The design system is made tonight so that it does not compete with payments during the build.
- **Attendee app** has the most screens to build, but screens carry the least risk and agents handle them well.
- **Data & vendor** has to be exactly right. A mistake here means overselling or exposing someone's order. Most of that work lands in the first eight hours.

## Where the roles meet

The roles meet in one place: the list of functions in `src/shared/api/`. It is written out in `ARCHITECTURE.md`, "Shared API".

- **Screens**, attendee and vendor alike, call these functions and nothing else. A screen never talks to the database directly.
- **Data & vendor** owns them. In the first hour they return sample data, so screens can start immediately. The sample data is then replaced with real behavior, one function at a time.
- **Payments & design** provides what sits behind `startCheckout` and `confirmCheckout`, and asks Data & vendor for any database change it needs.

To change a function's name, inputs, or outputs, tell the Data & vendor role first. A two-line message is enough. For a change in someone else's folder, ask that person; do not let an agent make it quietly.

## Tonight

No application code is written tonight. This is preparation only.

- [ ] Confirm the roles.
- [ ] Prepare the design system (colors, type, spacing, core components), if the competition rules count it as preparation.
- [ ] Read `SPEC.md` once, and your own role's parts of `ARCHITECTURE.md`.
- [ ] Read the "Shared API" list together and agree on it.
- [ ] Create the shared git repository and give all three access.
- [ ] Create the accounts: Supabase project, Cloudflare, Square developer account with two sandbox sellers, Resend.
- [ ] Payments & design: set up Square's MCP server locally, so agents can call the Square sandbox directly. Run `ACCESS_TOKEN=<sandbox token> SANDBOX=true npx square-mcp-server start`. Use a sandbox token only, never a production one.
- [ ] Buy the domain and add Resend's DNS records, so email is verified by morning.
- [ ] Share keys through a private channel. Keys never go in git.
- [ ] Decide which phones are used for the demo.
- [ ] Tonight or first thing tomorrow: sketch the competition venue's floor plan as a simple image. The demo event's map uses it as its background, with the booths placed on it.

## The 24 hours

The times are guides for deciding what to do next. They are not pass-or-fail deadlines.

| By | Aim |
| --- | --- |
| Hour 1 | The project is scaffolded and a placeholder page is live on Cloudflare. Shared functions return sample data. Everyone has started. |
| Hour 4 | Screens show the real catalog. A reservation passes the last-item test. A Square checkout page opens from the server. |
| Hour 8 | **First full journey on the live site, on phones:** reserve, vendor sees it, marks ready, collects. |
| Hour 12 | **Square check-in.** Can a sandbox payment confirm an order from start to finish? If yes, connect it to the screens. If it is close, keep going until hour 16. If not, keep it on one booth or drop it. |
| Hour 16 | Both paths work on the live site. Email and hold expiry work. Extras start. |
| Hour 20 | **Feature freeze.** Fixes only. Test on the demo phones and write the demo script. |
| Hour 22 | Rehearse the demo twice. Prepare the short source-code walkthrough. Rest. |

At each check-in, each person answers three questions: What works now? What is blocking someone else? What should be tried, simplified, or steadied next?

Take turns sleeping. A tired person debugging payments at hour 19 costs more than a two-hour nap at hour 14.

## Saying how far something is

Use the same three words, so "done" means the same thing to everyone.

| Word | Meaning |
| --- | --- |
| **Implemented** | It works on its own, on one person's machine. |
| **Integrated** | It works together with the other roles' parts, on the live site. |
| **Demo-ready** | It works on the demo phones, including when something goes wrong. |

## Working together

- **One branch, always working.** `main` deploys to the live site on every push. Commit small and often, and pull before starting something new.
- **Stay in your folders.** This is what keeps merges painless.
- **Database changes go through Data & vendor.** A change is a new migration file. A migration that is already pushed is never edited, because teammates' databases have already run it.
- **Say it when you take a shortcut.** If something behaves differently from `SPEC.md`, add a row to "Intentional simplifications" in `ARCHITECTURE.md`. Judges hear about deliberate choices, not surprises.
- **If the spec is silent or looks wrong, ask each other.** Agents do not invent product behavior.

## Code reviews and verification

Most code needs no review. Merge it and move on.

Three areas are the exception, because a mistake there breaks the demo's main claims: **order functions, access rules, and payment handling**. For a change in those areas:

1. The tests in `tests/` pass, including a new test for new behavior.
2. A second agent reviews the change, when practical. A fresh session or a different tool works best, because it has no stake in the first one's reasoning.
3. One teammate takes a quick look before or shortly after it is merged.

For screens, say what was checked: at phone width or not, with real or sample data, and what was not checked.

## If Square is not working

The reservation path is the fallback. It is a complete demo on its own.

- At hour 12, decide honestly using the check-in above.
- If Square is cut back, keep it on a single booth so nothing else depends on it.
- If Square is dropped, the demo says so plainly: prepaid checkout is designed, and reservation is what runs.

## The demo

1. An attendee finds a limited item through search and sees its booth on the map, which shows the room the judges are sitting in.
2. They reserve it. The vendor's phone shows the order, and the vendor marks it ready.
3. The attendee's phone updates. The vendor enters the pickup code and the order is collected.
4. If Square works: the same journey at a prepaid booth, paid through Square's sandbox test payment.
5. The last-item moment: two phones try to take the final unit, and only one gets it.
6. A short look at the source: the reservation transaction and the payment check.

Say what is built, what is simplified on purpose, and what comes next. Do not claim every vendor's system can connect, or that a reservation removes every line.
