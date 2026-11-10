# AllesImBlick Push-Backend (Cloudflare Worker + D1)

This is an isolated backend prototype. It does not change the production GitHub Pages app.

## What it does
- Stores browser Push API subscriptions in D1.
- Accepts per-device reminder upserts and deletions.
- Checks due reminders every minute and sends Web Push notifications.
- Removes expired subscriptions (404/410) and retries transient push failures.
- Stores only the push subscription and the notification title/body needed for delivery.

## Required setup (Cloudflare account)
1. Create a D1 database named `allesimblick-reminders`.
2. Copy its database ID into `d1_databases[0].database_id` in `wrangler.jsonc`.
3. Run `npm install` in this folder.
4. Run `npm run db:migrate`.
5. Generate one VAPID key pair with `npx web-push generate-vapid-keys`.
6. Add these Worker secrets (never commit them):
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` (for example `mailto:your-contact-email@example.com`)
7. Deploy with `npm run deploy`.

The public key is returned by `GET /api/config`; the private key remains a Cloudflare secret.

## API
All routes except `/api/health` and `/api/config` require an Authorization header:
`Authorization: Bearer <random-device-token>`.
The app must generate and keep a random token per browser installation. Only its SHA-256 hash is stored on the server.

- `GET /api/health`
- `GET /api/config` → `{ "publicKey": "..." }`
- `POST /api/register` body: `{ "subscription": PushSubscription.toJSON() }`
- `PUT /api/reminders` body: `{ "id", "scheduledAt", "title", "body" }`
- `DELETE /api/reminders/:id`
- `POST /api/unregister`

Reminder times must be in the future and no more than 366 days away. Cron checks every minute. This is a prototype: before public launch, add account-level authentication, abuse/rate controls, privacy policy and a user-facing unsubscribe/delete flow.

## Important
- Do not put VAPID private keys in GitHub or client-side code.
- Do not deploy this Worker until the D1 database and all three secrets are configured.
- The production app's `index.html` and `main` branch remain untouched.
