# Crowd Control

A dark navy audience intelligence workspace for event operators. Includes a working React interface and persistent backend, with strictly separate demo and live databases.

## Run locally

Requires Node.js 22.13 or newer (Node's built-in SQLite module is currently experimental).

```sh
npm install
npm run dev
```

Open http://localhost:3000. The app opens directly into the persistent database. There is no app login, owner setup, workspace switch, or synthetic demo in the UI. POSH itself still requires its own login through Browser worker. The server binds to loopback by default; anyone with access to the server can read and modify the database.

```sh
npm test
npm run build
npm start
```

Copy `.env.example` to `.env` for configuration. Never commit `.env`, database files, customer exports, or webhook payloads.

## Implemented

- Overview with database-derived customer counts, net sales, repeat buyer rate, channel distribution, and upcoming events.
- Searchable audience with repeat-buyer, email-eligible, SMS-eligible, and nonbuyer filters.
- Customer profiles with purchase history, timelines, and append-only consent evidence.
- Event creation and explainable audience ranking (affinity-v2), with recency, distinct-event confidence, purchase timing, and suppression of paid/RSVP/pending registrations.
- CSV preview and transactional import, stable order IDs, refund updates, identity-conflict rejection, and replay-safe commit.
- POSH webhook inbox with shared-secret authentication and duplicate-payload protection. Deliveries remain `awaiting_mapping`; no unverified payload creates orders.
- Open application access with origin validation, request verification headers, and audit entries.
- The application always uses the persistent database. Legacy authenticated/demo mode is retained only as an explicit server factory option for compatibility.

## Daily collector and outreach drafts

The [collector architecture and setup guide](docs/collector.md) covers browser-based event discovery, complete order backfills, daily scheduling, reviewed first import, source reconciliation and campaign drafts. Live POSH mappings require account validation. Email/SMS sending is not connected yet.

## Import an event report

For browser-driven downloads, persistent login, and scheduled imports, see [Embedded browser worker](docs/browser-worker.md). The worker is part of this app and uses open-source Playwright; live POSH selectors and export compatibility still require verification with your account.

1. Create an event in your live workspace.
2. Choose **Import CSV** and download the sample template.
3. Transform the POSH export into one row per order. Exclude transfers. The importer is not a claim of full compatibility with every POSH export layout.
4. Use ISO 8601 purchase dates with explicit offsets, such as `2026-09-18T20:00:00-05:00`.
5. Preview and check new orders, updated orders, and file net sales. Commit only after reviewing.

Required columns: `order_id,name,email,quantity,subtotal,purchased_at`.

Optional: `phone,city,refund,channel,tracking_link,scanned_count`.

Amounts are USD decimal values without currency symbols or thousands separators. The server stores integer cents. Some POSH column aliases are supported (Order Number, First Name + Last Name, Order Subtotal, Refund Amount, Tickets Scanned, etc.). Downloaded template rows are illustrative: replace them before importing real data.

Imports are snapshots for the included orders: re-imports replace their values. Use the latest complete export. Missing rows do not delete existing orders. Cancellations with no refund, disputes, transfers, ticket-level ownership, other currencies, and arbitrary column mapping are not implemented. Resolve these in a reviewed source transform before importing; do not treat canceled/transfer rows as ordinary sales. Phone, city and name on an existing email profile are not overwritten automatically. Review identity changes rather than silently merging people.

CSV phone numbers do not imply permission. Record consent evidence separately. Scanned counts are order-level facts and must not be treated as proof that the named buyer attended.

## Metrics and recommendations

- Owned audience: unique stored profiles, not the number reachable by a channel.
- Net ticket sales: subtotal less refunds on orders purchased within the last 90 days; excludes taxes/fees and is not a payout reconciliation. Chart shows 12 completed rolling weeks. Refunds reduce their original order's net value, not a refund-date ledger.
- Repeat rate: people with paid orders at more than one distinct event / people with any paid event, across all stored history. Free RSVPs are not paid buyers.
- Market filtering on overview scopes profiles by recorded home city. Upcoming cards separately filter event city.
- Attribution: the recorded order channel, not causal attribution or Meta-reported ROAS.
- Ranking: content affinity up to 40, series up to 25, location up to 20, recency/repeat history up to 15, with 180-day decay. Tier A >=65; B >=30; C otherwise. Scores are not probabilities. See the collector guide for confidence, timing evidence and exclusions.

## POSH webhook integration boundary

Set `POSH_WEBHOOK_TOKEN` to a random value of at least 32 bytes. The receiver is `POST /api/webhooks/posh`, using `Authorization: Bearer <token>` with JSON. Confirm that the POSH account can configure this authentication; otherwise use a verified server-side relay and implement POSH's supported signature/authentication contract before exposure. Do not remove authentication to make it connect.

The inbox acknowledges only after persisting the raw payload. Identical JSON serialization is deduplicated. Source event-ID normalization, signature support, replay ordering, order mapping, retries from the source, and reconciliation must be validated against actual POSH fixtures. Payloads are not mapped to sales yet, intentionally avoiding double-counting across CSV and webhook sources.

## Deployment and data handling

This is a single-owner, single-server foundation. SQLite persists in `DATA_DIR` (default `./data`); use a persistent disk, not ephemeral serverless storage. Real data is in `crowd-control.sqlite`; the isolated synthetic demo is regenerated in memory on startup. WAL mode and transactional imports are enabled. The embedded browser adds version 2 source/job tables; the collector adds version 3 provenance, event metadata and campaign tables; future schema changes need explicit migrations. The [Fly deployment guide](docs/fly-deployment.md) uses one machine and one persistent volume for the complete app.

Before hosting with real PII:

- Use HTTPS and set `PUBLIC_ORIGIN` to the exact public origin. The application has no login gate; use the intended network access boundary when hosting.
- Keep reverse-proxy and host configuration controlled. `HOST` defaults to `127.0.0.1`; use `0.0.0.0` only behind the intended access boundary. Do not enable broad proxy trust.
- Encrypt the server disk and backups, restrict filesystem access, and test restoration. Use SQLite's online backup API or stop the service for a consistent backup; copying just the main file while WAL is active is insufficient.
- Define source-payload retention, deletion/export workflows, backup expiry and consent evidence review. Those operational workflows are not automated here.
- Set up monitoring and off-device backups. Password reset, MFA, multiple staff roles, production email/SMS integrations, ticket-level transfer reconciliation and PostgreSQL migration remain follow-up work.
- Fonts currently load from Google Fonts with local sans-serif fallbacks; self-host the fonts when preparing a locked-down production deployment.

Use PostgreSQL and an explicit migration framework before multi-instance hosting. The current database adapter is isolated in `server/db.mjs`, but its SQLite SQL and synchronous driver require a deliberate migration—not just a connection-string swap.

## Layout

```text
src/                 React UI and responsive styling
server/app.mjs       Auth, validation, API, import and webhook workflows
server/db.mjs        Schema, queries, demo fixtures and transactions
server/index.mjs     Single-origin dev/production server
server/imports.mjs   Shared CSV staging and transactional import service
server/browser/      Embedded Playwright worker, network policy, vault, and API
src/BrowserPanel.jsx Owner browser controls, sync recipes and import review
docs/                Browser setup and single-machine Fly deployment
tests/               API behavior and security checks
```

`npm test` covers demo isolation, owner setup/session enforcement, origin protection, import validation and atomicity, refunds, consent precedence, registration suppression, and webhook authentication/deduplication.

After building, `npx playwright test` runs a complete browser workflow against a temporary database: desktop/mobile navigation, owner setup, event creation, CSV preview/import, consent recording and persistence. Install the test browser with `npx playwright install chromium` when needed. Screenshots and traces are saved under `test-results/`.
