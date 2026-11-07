# Security

SpatialChat is a **secure private messaging service, not an end-to-end encrypted messenger**. TLS protects data in transit (when you deploy with HTTPS); the server and database operator can read messages. No custom cryptography is used.

## Implemented controls
| Area | Control |
|---|---|
| Passwords | Argon2id (19 MiB, t=2, p=1), 10-128 chars, timing-equalised login, generic credential errors |
| Sessions | Random 256-bit token in HttpOnly/SameSite=Lax/Secure(prod)/`__Host-` cookie; stored only as HMAC-SHA256; absolute + idle expiry; rotated on login and password change; revoked on logout, reset, delete |
| CSRF | Synchronizer token header + Origin allow-list on all state-changing requests; SameSite cookies |
| CORS / WS | Exact origin allow-list; sockets need valid session cookie and allowed Origin |
| AuthZ | Every endpoint and socket event checks participation/ownership server-side; non-participants get 404; sender/time/participants never taken from client |
| Rooms | Clients cannot join rooms; server emits only to authorised users' private rooms |
| Idempotency | Unique `(senderId, clientId)` |
| Validation | Zod on all REST/socket input; 16 KB body limit; 4000-char messages |
| XSS | React escaping only (no `dangerouslySetInnerHTML`), strict CSP (`script-src 'self'`) |
| Headers | Helmet, CSP, HSTS (prod), `Referrer-Policy: no-referrer`, frame-ancestors none |
| Rate limits | Login (per IP and per account), register, forgot/reset, search, contact requests, REST sends, per-socket event bucket |
| Enumeration | Generic login/forgot responses; min 3-char search, rate limited; blocked/missing users look identical; no emails in public profiles |
| Data | Prisma parameterised queries; FK cascades; CHECK constraints; reset tokens hashed, 30-min, single-use; expired data purged |
| Logging | No passwords, cookies, tokens, bodies; no stack traces to clients |
| Config | Zod-validated env; production refuses unsafe settings |

## Requires infrastructure or configuration
HTTPS/TLS termination and WebSocket proxying; a strong `SESSION_SECRET` in a secret manager; SMTP provider with SPF/DKIM/DMARC; encrypted DB storage and backups; network firewalling of PostgreSQL; WAF/DDoS protection; multi-instance rate limiting and presence (Redis); regular `npm audit` and dependency updates.

## Known limitations
No E2EE, no 2FA, no email verification, no avatar upload scanning (none offered), registration reveals that "username or email" is taken, in-memory presence, rate limits are per process, no admin/abuse-report tooling. Not independently audited.

## Manual test guide
1. Register two users in two browsers (normal + private window). 2. Search, send/accept request, chat; confirm instant delivery, typing, read ticks. 3. Turn off network on one side, send, restore: message sends once. 4. Copy a chat URL into a third account: "Conversation not found". 5. Block: sending is refused, user vanishes from search. 6. Logout in one tab: other tab returns to sign-in. 7. In DevTools, edit the `X-CSRF-Token` header: request fails with 403. 8. Check `Set-Cookie` flags and response headers. 9. Resize to 320px: no horizontal scroll; keyboard keeps composer visible. 10. Request password reset (Mailpit at :8025), use link twice: second use fails.

Report vulnerabilities privately to the maintainers; do not open public issues.
