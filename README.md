# Event Commerce Platform

Find merchandise at an event, secure it from your phone, and collect it at the booth.

## Overview

Attendees open an event from a QR code or link, search for a product, and see which booth sells it and whether it is in stock. They either prepay through the vendor's own Square account or reserve the item and pay at pickup. Vendor staff see incoming orders on a phone, mark them ready, and hand them over against a pickup code.

This is a 24-hour competition build by three developers working with coding agents.

## Status

Planning is complete and no application code exists yet. The steps under "Getting started" apply once the project is scaffolded at the start of the competition.

## Docs

| Document | What it answers |
| --- | --- |
| [CONCEPT.md](CONCEPT.md) | What the product is, who it serves, and why. |
| [SPEC.md](SPEC.md) | What the app does, feature by feature. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the parts fit together and the rules that must hold. |
| [TEAM-PLAN.md](TEAM-PLAN.md) | Who builds what, and the plan for the 24 hours. |
| [CLAUDE.md](CLAUDE.md) | Instructions for coding agents. |

New to the project? Read this page, then `TEAM-PLAN.md`, then the parts of `SPEC.md` for your role.

## Prerequisites

- Node.js 20 or later, with npm
- Docker, for the local Supabase
- Supabase CLI
- Accounts: Supabase, Cloudflare, Square developer (sandbox), Resend

## Getting started

1. Clone the repository and run `npm install`.
2. Copy `.env.example` to `.env.local` and fill in the browser values. Copy the Edge Function values to `supabase/functions/.env`.
3. Run `supabase start`, then `supabase db reset` to create the tables and the demo event.
4. Run `npm run dev` and open `http://localhost:5173`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the app locally. |
| `npm run build` | Builds the app for deployment. |
| `npm run typecheck` | Checks types. |
| `npm run lint` | Checks code style. |
| `npm test` | Runs the tests. Order and access tests need the local Supabase running. |
| `supabase db reset` | Rebuilds the local database from migrations and seed data. |
| `supabase functions serve` | Runs the Edge Functions locally. |
