# Embedded browser worker

The React dashboard, Express API, SQLite database, scheduler, and Playwright Chromium worker run in one repository and one server process. Playwright is Apache-2.0 open source. No browser subscription, LLM API, or separate worker service is required. Hosting still has infrastructure costs.

This is deterministic browser automation with configurable export steps, not a general-purpose AI agent. Real POSH compatibility has not been verified against an authenticated account. The starter selectors are examples, not a supported POSH integration contract.

## Local use

Use Node 22.13 or newer. Run `npm ci`, `npm run browser:install`, then `npm run dev`. On Linux, install Chromium's OS dependencies with `npx playwright install --with-deps chromium`.

1. Open the app and create your event. No app account is required.
2. Open **Browser worker**, enter the POSH organizer URL, and open the browser. Click the streamed page and use the text/key controls to sign in and complete verification.
3. Optionally configure `BROWSER_VAULT_KEY` with the output of `npm run browser:key`, restart the server, and save your login in **Saved login**. Keep the key separate from the data directory. Saving credentials permits one login attempt per sync when the session has expired. The exact login origin and field selectors must match; multi-step login and verification may require manual interaction.
4. Choose **Close & save**. Chromium's persistent profile keeps cookies/local storage on disk. Only one interactive session or sync runs at a time; leave the browser closed for scheduled work. An interactive session closes after 15 minutes without user activity.
5. Add an event sync. Choose the destination event, organizer report URL, a selector visible only when signed in, optional click/check/select steps, and the final CSV download selector. Confirm these against the actual POSH interface. Arbitrary scripts are not accepted.
6. Run once. Review the downloaded report's sample and totals, then import. Failed validation leaves customer/order data untouched.
7. After a successful reviewed import, enable automatic imports and scheduling if desired. Changing the recipe or destination event requires a new reviewed import. Intervals range from 30 minutes to one week.

The report must match the [documented order schema](../README.md#import-an-event-report): one row per order, stable order IDs, USD amounts, explicit timezones, and no transfers. Some POSH header aliases are recognized. If POSH's report differs, add a tested mapping using a sanitized real report before enabling unattended imports. Missing rows do not delete orders; this is not complete cancellation, transfer, dispute, or payout reconciliation.

## Behavior and storage

- Schedules and jobs persist in SQLite. Missed schedules queue one run after restart, rather than replaying every missed interval.
- Runs progress through queued, running, review, imported/unchanged, or actionable failure states. A report awaiting review blocks another run for that event. Interrupted jobs require retry.
- CSV downloads are limited to 4 MB; a run has a three-minute deadline. Exact repeats of the last imported report are skipped. Order IDs make reviewed re-imports idempotent, and updated refunds replace earlier values.
- Customer changes and job completion commit in one transaction. Automatic imports use the same validation as manual CSV imports.
- `/data/browser/profile` contains sensitive authenticated browser state. `/data/browser/credentials.enc` contains AES-256-GCM encrypted credentials; the key comes from environment secrets. `/data/browser/reports` retains downloaded CSV reports. Screenshots stream to the app and are not saved by the application. There is no automatic report retention/deletion policy yet.
- The app and browser endpoints are open to anyone with server access; there is no app login. Navigation defaults to `posh.vip` and its subdomains. Request checks block private-network destinations; WebSockets and service workers are disabled. Additional authentication domains must be explicitly allowed in server configuration. This may require adjustment for POSH's live authentication flow.
- Keep the server and data volume private, backed up, and limited to trusted operators. The browser profile itself is not encrypted by the credential vault. Changes in page layout, expired sessions, CAPTCHA, and MFA can pause automation; the app does not bypass challenges.

## Verification

`npm test` uses real Chromium against a local authenticated fixture to verify login, persistent sessions after worker restart, saved-password reauthentication, downloads, review, deduplication, scheduled refund updates, restart recovery, API authorization, and rejected import formats. `npm run build` followed by `npx playwright test` checks the desktop/mobile application, imports, consent workflow, and sync configuration UI. These tests do not establish live POSH compatibility.
