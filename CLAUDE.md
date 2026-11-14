# CLAUDE.md — Event Commerce Platform

Instructions for every coding agent working in this repository. `AGENTS.md` points here.

A 24-hour competition build by three developers. Favor working, readable code over process. Judges read the source.

**State:** the app is scaffolded and deployed, with the attendee screens built. `src/shared/api/` and `src/shared/live/` call Supabase; a network failure is thrown, and a refusal is returned as a typed result. `supabase/migrations/` holds the tables, the order, vendor, checkout, payment, refund, and email functions, and the table privileges; `supabase/seed.sql` holds the demo event. The payment provider module, payment verification, and the Edge Functions `create-checkout`, `confirm-checkout`, `expire-checkouts`, and `send-order-email` are in `supabase/functions/`. Not created: the vendor screens, the `square-webhook` function, and the scheduled call to `expire-checkouts`. If a folder or script is missing, it has not been created; do not assume it is broken.

## Documents

| Document | Open it when |
| --- | --- |
| `SPEC.md` | The task adds or changes behavior. Read the section for that feature. It is the source of truth for what to build. |
| `ARCHITECTURE.md` | The task touches data, shared functions, access rules, or payments. Read the section for that area. |
| `TEAM-PLAN.md` | You need to know which role owns a folder. |
| `CONCEPT.md` | A product-direction question comes up. It wins over the other documents. |

Do not implement behavior that `SPEC.md` does not describe without raising it with the developer first. Small edits inside existing code do not need a reread. Do not create other planning, process, or handoff documents.

## Stack

React + TypeScript (strict) + Vite. Supabase: Postgres, Auth, Realtime, Edge Functions. Square sandbox for prepaid checkout. Resend for email. Cloudflare Workers static assets for hosting. Vitest for tests. npm.

## Commands

```bash
npm run dev              # Vite dev server, http://localhost:5173
npm run build            # production build into dist/
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint
npm test                 # Vitest; order and access tests need the local Supabase running
supabase start           # local Supabase (API on http://127.0.0.1:54321)
supabase db reset        # re-apply all migrations and seed.sql to the local database
supabase functions serve # run Edge Functions locally
```

## Structure

```text
src/features/      screens, one folder per area: discover, order, vendor, organizer
src/shared/ui/     shared components and the status/payment label module
src/shared/api/    the only code that talks to Supabase
src/shared/types/  types for the shared functions
src/shared/live/   realtime subscriptions and online/offline status
supabase/migrations/   tables, access rules, order functions
supabase/seed.sql      demo event, booths, products, vendor accounts
supabase/functions/    Edge Functions; Square code in _shared/providers/
tests/             order and access tests; payment tests in tests/payments/
```

## Ownership

Work in the folders of the role you are assisting (`TEAM-PLAN.md`, "The three roles"). For a change needed elsewhere, tell the developer what is needed and why, and make it only once they confirm it is agreed with that folder's owner.

- `supabase/migrations/` and `supabase/seed.sql` belong to the Data & vendor role. Add or edit a migration from another role only when the developer confirms that role has agreed.
- `tests/payments/` belongs to the Payments & design role. The rest of `tests/` belongs to Data & vendor.
- Function names, parameters, and types in `src/shared/api/` and `src/shared/types/` are the shared contract. Changes go through the Data & vendor role.
- Helping another role means taking one whole task in that folder with the owner's agreement, not editing alongside the owner.

## Rules that must hold

- Browser code never inserts, updates, or deletes orders, order items, or stock. It calls the functions in `src/shared/api/`.
- Screens never import `supabase` directly; they go through `src/shared/api/`.
- Stock changes and the order change that caused them are in one database transaction.
- An order is confirmed as paid only after the server has fetched the payment from Square and matched seller, provider order, amount, currency, and completed status. A redirect or a webhook body is not proof.
- `collected`, `cancelled`, and `expired` orders never return to an active status.
- Every `security definer` function sets `search_path = ''` and has execute granted by name.
- Functions called by users authorize with `auth.uid()` inside the function. Service entry points (`svc_*`, called by Edge Functions) have no user: they are granted to `service_role` only and check that role inside the function. The Edge Function authenticates its own caller (session token, webhook signature, or service key) before calling one.
- Internal helpers live in the `private` schema and are not reachable over the API.
- Totals are calculated on the server from catalog prices.
- Square-specific code stays in `supabase/functions/_shared/providers/`.
- Money is integer cents.
- Status and payment wording comes from the shared label module in `src/shared/ui/`. Never label a reservation as paid, a pending payment as complete, or an unconfirmed action as successful.
- Every screen handles loading, empty, error, and offline states.

## Do not touch

- **A migration that has been pushed.** Teammates' databases and the hosted database have already run it, so an edit makes them disagree. Add a new migration.
- **Order functions, access rules, and payment verification, from outside the owning role.** A wrong edit oversells stock, exposes another person's order, or confirms an unpaid order. Ask the developer first.
- **Secrets.** No service-role key, Square token, webhook signature key, or Resend key in `src/`, in `VITE_` variables, or in git. `VITE_` values are bundled into the public app.
- **`CONCEPT.md`.** It is the product direction and only the product lead changes it.
- **Product behavior.** Do not add requirements or change behavior. If the spec is silent or looks wrong, ask the developer.

## Code

- TypeScript strict. No `any` in the shared contract.
- Feature folders do not import from each other; shared code goes in `src/shared/`.
- Reuse existing components and helpers before adding new ones. No abstractions for features that are not in `SPEC.md`.
- Ask before adding a package. Prefer a few lines of code over a new dependency.
- Comments only where the code cannot say why: transaction boundaries, idempotency, access checks, provider quirks.
- Mobile first: design and check at phone width before anything wider.

## Scope

- **Core** (the reservation baseline) and **Square** (prepaid checkout) are parallel priorities from the start. Square carries more completion risk, but it is not postponed until Core is finished. **Extra** items are taken on as progress permits.
- When taking a shortcut that changes behavior, tell the developer so it is added to "Intentional simplifications" in `ARCHITECTURE.md`.

## Commits

Small and frequent. Small changes go straight to `main`, which deploys. Open a pull request instead when a change:

- touches another role's folders,
- changes shared code others build on (`src/shared/`),
- is in an order function, access rule, or payment handling, or
- is large enough that a teammate should see it before it deploys.

The message is one short imperative sentence saying what changed, for example `Add last-item test for create_reservation`. Pull before starting new work.

## Before saying something is done

- Typecheck and lint pass.
- For changes to order functions, access rules, or payment handling: the related tests in `tests/` pass, with a new test for new behavior. Mention to the developer that an independent AI review is encouraged for these changes when practical (`TEAM-PLAN.md`, "Code reviews and verification").
- For screens: state whether it was checked in a browser at phone width, and against real or sample data. Report what was not checked.
- Say whether the work is implemented, integrated, or demo-ready (`TEAM-PLAN.md`, "Saying how far something is").
