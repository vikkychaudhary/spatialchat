# SpatialChat

A secure, private one-to-one messaging web app with a "spatial" glass UI: React + TypeScript frontend, Express + Socket.IO backend, PostgreSQL via Prisma.

> **Status:** the source was written and syntax-checked, but dependencies were **not installed and the tests/build were not executed** in the environment that produced this archive (no network or database). Run the steps below; see [Verification](#verification-checklist). The Prisma migration is hand-written; if `npx prisma migrate dev` reports drift, let it generate a corrective migration.

## 1. Overview and features
Registration/login/logout, profile (display name, status, avatar colour), password reset by email, account deletion; username/display-name search; contact requests (send, accept, decline, cancel, remove); block/unblock; real-time 1:1 chat with history, pagination, optimistic sending with retry, idempotent delivery, typing indicators, read receipts, unread counts, online/last-seen with privacy toggle, reply, copy, delete for me / for everyone, conversation and in-conversation search, pin/archive/mute, emoji, toasts, offline banner, light/dark theme, responsive layout from 320px.

Not implemented (by design): end-to-end encryption, avatar image uploads (colour avatars only), email verification, group chats. This is a *secure private messaging service*, **not** an end-to-end encrypted messenger: the server can read messages.

## 2. Stack
React 18, Vite, TypeScript, Tailwind CSS 3, React Router, socket.io-client, lucide-react | Node 20+, Express 4, Socket.IO 4, Prisma 6, PostgreSQL 16, Zod, Argon2id, Helmet, express-rate-limit, Nodemailer | Vitest + Supertest, Playwright.

## 3. Architecture
```
Browser (SPA) --HTTPS--> Express (/api/v1 REST, serves built SPA in production)
        \--WSS--> Socket.IO (same server)  --> Prisma --> PostgreSQL
```
* Sessions: random token in an HttpOnly, SameSite=Lax (Secure in production, `__Host-` prefixed) cookie; only an HMAC-SHA256 hash is stored in the `Session` table. Absolute (7d) and idle (72h) expiry; rotated on login and password change.
* CSRF: per-session synchronizer token (`X-CSRF-Token`) + Origin allow-list on every state-changing request.
* Sockets: authenticated from the session cookie at handshake, Origin checked. Clients never join rooms; the server places each socket only in its own `user:<id>` room and emits to participants after authorizing. Guessing conversation IDs cannot subscribe anyone.
* Frontend dev server proxies `/api` and `/socket.io` to the API so cookies are same-origin.

### Socket.IO contract
Client -> server (all validated with Zod, rate limited, acknowledged with `{ok:true,...}` or `{ok:false,error}`):
`message:send {conversationId, clientId(uuid), body, replyToId?}` -> ack `{message}` | `message:read {conversationId}` | `typing {conversationId, isTyping}`.
Server -> client: `message:new`, `message:deleted {conversationId,messageId,scope}`, `message:read {conversationId,readerId,messageIds}`, `typing`, `presence {userId,online,lastSeenAt}`, `contact:request`, `contact:request-removed`, `contact:accepted`, `contact:removed`, `conversation:removed`.
Reconnection: on `connect` the client refetches lists and the open conversation and re-sends failed messages with the **same** `clientId` (server de-duplicates on `(senderId, clientId)`). Sender, timestamps and participants are always derived server-side.

### REST (all under `/api/v1`, JSON)
`POST /auth/register|login|logout|forgot-password|reset-password|change-password`, `GET /auth/me`, `DELETE /auth/account` | `GET /users/search?q&cursor`, `GET /users/by-username/:u`, `PATCH /me/profile`, `PATCH /me/settings` | `GET /contacts`, `GET|POST /contacts/requests`, `POST /contacts/requests/:id/accept|decline`, `DELETE /contacts/requests/:id`, `DELETE /contacts/:userId`, `GET|POST /blocks`, `DELETE /blocks/:userId` | `GET|POST /conversations`, `PATCH /conversations/:id`, `GET|POST /conversations/:id/messages` (`before`, `after`, `limit`, `q`), `POST /conversations/:id/read`, `DELETE /conversations/:id/messages/:mid?scope=me|all`. Plus `GET /health`, `GET /ready`.

## 4. Prerequisites and installation
Node.js 20+ (22 recommended), npm 10+, Docker Desktop (or your own PostgreSQL 14+).
* **Windows:** install Node LTS from nodejs.org and Docker Desktop; use PowerShell. Replace `cp` with `copy`.
* **macOS/Linux:** use nvm (`nvm install 22`) or your package manager; install Docker.

## 5-9. Run locally
```bash
npm install
cp .env.example .env                 # then set SESSION_SECRET (see section 16)
docker compose up -d db mailpit      # PostgreSQL + local mail catcher (http://localhost:8025)
npm run db:deploy                    # apply migrations (or: npm run db:migrate while developing)
npm run db:seed                      # optional fictional demo users alice/bob/carol, password DemoPassw0rd!
npm run dev                          # API :4000 + web http://localhost:5173
```
The test database `spatialchat_test` is created automatically the first time the `db` container initialises (`docker/initdb`). If your volume already existed: `docker compose exec db psql -U spatialchat -c "CREATE DATABASE spatialchat_test"`.

## 10. Tests
```bash
npm run test          # unit + API/socket integration tests (applies migrations to TEST_DATABASE_URL first)
npm run typecheck
npx playwright install chromium   # once
npm run test:e2e      # starts the app; two-user messaging flow, 320px layout checks
```
Covered: registration/login, generic credential errors, rate limits, session expiry/rotation/logout, CSRF and Origin checks, password-reset tokens, search/contacts, messaging, pagination, idempotent retries, participant authorization, unauthorized socket connections and room/event abuse, impersonation attempts, blocking, invalid/oversized input, DB constraints and cascades.

## 11. Production build
```bash
npm run build         # backend -> backend/dist, frontend -> frontend/dist
NODE_ENV=production npm start
```
The API serves `frontend/dist` itself, so one origin and one certificate cover everything.

## 12-13. Deployment, HTTPS, CORS, cookies, email
1. Provision PostgreSQL (managed is best). Set `DATABASE_URL`.
2. Set env vars in your host's secret manager (never in git): `NODE_ENV=production`, `SESSION_SECRET`, `CLIENT_ORIGINS=https://chat.example.com`, `APP_URL=https://chat.example.com`, `TRUST_PROXY=1`, SMTP settings.
3. Run `npm run db:deploy` on each release, then `npm start` (or `docker compose --profile app up --build`; the Dockerfile runs migrations at start).
4. Terminate TLS in a reverse proxy (Caddy/nginx/cloud LB) forwarding HTTP **and WebSocket upgrades** to port 4000, and send `X-Forwarded-For/Proto`.
* The server refuses to start in production if the secret is the example value, `COOKIE_SECURE=false`, rate limits are disabled, or any origin isn't `https://`.
* CORS/CSRF/WebSocket origin allow-list = `CLIENT_ORIGINS` (exact origins, comma-separated).
* Cookies: `__Host-sc_sid`, HttpOnly, Secure, SameSite=Lax, Path=/.
* Email: set `SMTP_HOST/PORT/USER/PASS/SECURE` and `MAIL_FROM` to your provider (SES, Postmark, SendGrid SMTP...). Without `SMTP_HOST`, reset emails are not sent. Reset links expire after 30 minutes and are single use.

## 14. Troubleshooting
* `Invalid environment configuration` - a required variable is missing/short; compare with `.env.example`.
* `P1001 can't reach database` - `docker compose ps`; check port 5432 isn't used by another Postgres.
* `EADDRINUSE :4000/:5173` - stop the other process or change `PORT` (also update `vite.config.ts` proxy).
* Login works but you bounce to login in production - cookies need HTTPS and `TRUST_PROXY=1` behind a proxy; `CLIENT_ORIGINS` must match the browser URL exactly.
* WebSocket fails behind proxy - enable upgrade headers.
* 403 "bad_origin" - add the exact origin to `CLIENT_ORIGINS`.
* Tests fail at setup - make sure `spatialchat_test` exists and `TEST_DATABASE_URL` points to it.

## 15. Security
See [SECURITY.md](SECURITY.md) for implemented controls, limitations and the manual test guide.

## 16. Creating a production secret
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
Store it in your secret manager as `SESSION_SECRET`. Rotating it signs everyone out and invalidates outstanding reset links.

## 17. Operations
* Backups: `pg_dump -Fc "$DATABASE_URL" > spatialchat-$(date +%F).dump`; test restores regularly (`pg_restore`). Messages are plaintext in the database, so encrypt backups.
* Migrations: change `backend/prisma/schema.prisma`, run `npm run db:migrate`, commit the new folder; deploy with `npm run db:deploy`.
* Housekeeping: expired sessions and used/expired reset tokens are purged hourly.
* Monitoring: `/health` (liveness), `/ready` (DB). Logs never contain passwords, cookies, tokens or message bodies.
* Scaling: presence is in-memory and rooms are per process. For multiple instances add `@socket.io/redis-adapter` and move presence to Redis.
* Run `npm run audit` regularly.

## Verification checklist
`npm install` -> `npm run typecheck` -> `npm run db:deploy` -> `npm run test` -> `npm run build` -> `npm run test:e2e`. Fix anything reported before deploying.
