# One-app Fly deployment

The included Dockerfile packages the web app, API, database adapter, and open-source Chromium worker together. `fly.toml` mounts a persistent volume at `/data` and disables automatic stopping. The scheduler runs on the server, independent of the owner's computer.

This configuration has not been deployed or container-tested from this Windows environment. Verify the image and a real export on Fly before enabling scheduled imports. Chromium runs as the non-root `node` user with its sandbox enabled; check browser startup on the target host rather than disabling the sandbox to hide launch failures.

## First deployment

From the repository, with Fly CLI installed and authenticated:

1. Run `fly launch --no-deploy`. Keep the provided Dockerfile, single app, region, and volume configuration. Use your chosen unique app name; no managed database is needed for this SQLite setup.
2. Create the volume if launch did not create it: `fly volumes create crowd_control_data --region dfw --size 3`.
3. Set Fly secrets `PUBLIC_ORIGIN=https://YOUR-APP.fly.dev`, and optionally `BROWSER_VAULT_KEY` (64 random hexadecimal characters). Generate independent values locally with `npm run browser:key`. Use Fly's secrets interface or `fly secrets set`; never commit values or paste them into a tracked file. Set the exact origin of your custom domain instead if applicable.
4. Run `fly deploy --ha=false` and ensure `fly scale count 1`. Keep exactly one machine: this implementation shares a local SQLite database and one browser profile. Multiple machines would have independent databases and duplicate schedules.
5. Check `fly status`, `fly logs`, and the public `/healthz` endpoint. The app opens without login; anyone with network access can read/change data and operate its POSH browser. Configure the intended network access boundary, then follow the [browser setup guide](browser-worker.md).
6. Confirm a reviewed real POSH import, then enable automatic importing and scheduling. Close the interactive browser, verify a scheduled run finishes, restart the machine, and confirm the database and login state persist.

The starting machine size is 2 GB RAM with one shared CPU. Monitor memory during real exports and increase if needed. One always-running machine and a volume incur Fly charges; the browser software itself is free.

## Operations

Keep automatic stopping disabled; an in-process scheduler cannot wake its own stopped machine. Store the database, browser state, reports, and encrypted credential file on the mounted volume. Fly volumes are machine-local and are not a multi-machine shared filesystem.

Set up independent backups and test restoration. Use SQLite's online backup interface or stop the app before copying its database; copying only the main SQLite file while WAL writes continue is not a consistent backup. Preserve the vault key separately in secure storage. Define a retention policy for downloaded reports and browser state. A failed machine/volume still needs an operational recovery procedure; this is not a high-availability deployment.

Reference: [Fly volumes](https://fly.io/docs/volumes/overview/) and [automatic stopping and starting](https://fly.io/docs/launch/autostop-autostart/).
