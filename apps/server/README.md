# nu.vex server

Rust/Axum messaging server with PostgreSQL persistence: registration, opaque sessions, communities, invitations, text channels, history and authenticated WebSocket events. Voice, real attachments, federation and plugin execution are outside this milestone.

## Run locally

The prepared development toolchain is Rust 1.99.1. The package declares Rust 1.89 as its dependency minimum; that minimum has not been separately tested. Development uses PostgreSQL 17. There is no SQLite fallback. Exact direct dependency versions and `Cargo.lock` are committed.

From the repository root on the prepared Windows environment:

```powershell
. ./scripts/dev-tools/enter.ps1
$env:NUVEX_ALLOWED_ORIGIN = 'http://127.0.0.1:5173'
$env:NUVEX_INSECURE_DEV = 'true'
$env:NUVEX_REGISTRATION_OPEN = 'true'
cargo run --locked --manifest-path apps/server/Cargo.toml -- --migrate
cargo run --locked --manifest-path apps/server/Cargo.toml
```

On other systems, supply the environment variables below and use the same Cargo commands. The binary does not automatically read `.env` files.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NUVEX_DATABASE_URL` | Required | PostgreSQL URL. Keep credentials outside Git and shell history. |
| `NUVEX_BIND` | `127.0.0.1:3001` | Listener; `0.0.0.0:3001` inside Docker. |
| `NUVEX_ALLOWED_ORIGIN` | Required in production | One exact frontend origin, without path or trailing slash; HTTPS in production. |
| `NUVEX_INSECURE_DEV` | `false` | Permit HTTP cookies only with a loopback frontend origin. Development origin defaults to `http://127.0.0.1:5173`. |
| `NUVEX_REGISTRATION_OPEN` | `false` | Explicitly enable registration. |
| `NUVEX_MIGRATE_ON_START` | `false` | Apply migrations before listening. Prefer an explicit `--migrate` deployment step. |
| `NUVEX_INSTANCE_NAME` | `nu.vex` | Public instance name, 1–80 characters. |
| `NUVEX_TRUSTED_PROXIES` | Empty | Comma-separated proxy CIDRs. Only these peers may supply one valid `X-Real-IP`. Configure narrow networks and make the proxy overwrite this header. |
| `RUST_LOG` | `nuvex_server=info` | Logging filter. The request pipeline does not log URLs, tokens or bodies. |

`--migrate` runs embedded SQLx migrations and exits. SQLx takes its PostgreSQL advisory migration lock. Never edit a migration already applied to a deployed database.

## HTTP contract

All application paths below have the prefix `/api/v1`. JSON uses camelCase. Errors have the form `{"error":{"code":"forbidden","message":"…"}}`; SQL errors are never returned to clients.

Browser mutations require the exact configured `Origin`. Native/command-line clients may omit Origin and Cookie entirely: protected mutations then require an explicitly supplied, valid bearer credential; login/registration require JSON with `transport: "bearer"`. Do not fabricate a browser Origin. Any present Origin must match exactly; empty, `null`, malformed, duplicate, and foreign values are rejected even with a bearer credential. Keep `NUVEX_ALLOWED_ORIGIN` configured for the intended browser frontend.

| Method and path | Body / response |
| --- | --- |
| `GET /instance` | Public `{name,version,registrationOpen,authMethods}`. |
| `POST /auth/register` | `{email,password,displayName,handle,transport?}` → `{user,accessToken?}`. |
| `POST /auth/login` | `{email,password,transport?}` → `{user,accessToken?}`. |
| `GET /auth/me` | `{user}`; email is only present in the account's own profile. |
| `POST /auth/logout` | Revoke this session → `204`. |
| `GET /bootstrap` | `{user,communities,members}`; members belong to shared communities or are the current account. |
| `POST /communities` | `{name}` → `{community}` with a default text channel. |
| `POST /communities/{id}/channels` | Owner only, `{name}` → `{channel}`. |
| `POST /communities/{id}/invites` | Owner only → `{code}` expiring in seven days. |
| `POST /invites/{code}/join` | Join as member → `{community}`. |
| `DELETE /communities/{id}/members/{userId}` | Owner only; owners cannot remove themselves. |
| `GET /channels/{id}/messages?limit=50&before={messageId}` | `{messages}` ascending within the page; limit 1–100. |
| `POST /channels/{id}/messages` | `{content,clientId}` → `{message}`; `clientId` is a UUID. |
| `DELETE /channels/{channelId}/messages/{messageId}` | Delete your own message → `204`. |
| `POST /events/ticket` | Authenticated → `{ticket}` for one WebSocket upgrade. |
| `GET /events` | Authenticated WebSocket; optional `?ticket=…`; ticket audience determines the Origin policy below. |

Health routes have no API prefix: `GET /health/live` and `GET /health/ready`. Readiness checks PostgreSQL with a three-second timeout.

Authentication defaults to the host-only `nuvex_session` cookie: `HttpOnly`, `SameSite=Lax`, seven days, `Secure` in production. `transport: "bearer"` returns the same opaque credential as `accessToken` instead of setting a cookie. Send it as `Authorization: Bearer …`; browser clients must keep it in memory, never localStorage. PostgreSQL stores session hashes, not plaintext credentials.

Browser WebSockets cannot set Authorization headers. Obtain a REST ticket, then connect to `/events?ticket=…`. Tickets expire after 30 seconds, are single-use, are bounded to 2048 globally/eight per account, and require a live session. The server derives their audience from the authenticated ticket request: browser-origin tickets require the exact configured Origin on upgrade; originless-bearer tickets require no Origin or Cookie. These audiences cannot be interchanged. Native clients obtain their ticket with Bearer and no Origin/Cookie, then open a ticket-only WebSocket without Origin/Cookie/Authorization. Ticket upgrades reject an additional Authorization credential. Cookie or direct-bearer WebSocket authentication without a ticket retains the exact browser-Origin requirement.

Reverse proxies must preserve original Origin headers, including empty/duplicate values, or reject invalid input themselves. Do not replace Origin with a configured value or strip an empty value into absence. The supplied Nginx proxy forwards the original headers rather than reconstructing them from `$http_origin`.

Live presence is not implemented. Profile status marks only the current account as online and uses offline for other profiles; it is not a measurement of other users' activity. Profile role labels summarize shared communities. Authorization always checks the actual community membership/owner in PostgreSQL.

Events are `{"type":"message.created","message":…}` and `{"type":"message.deleted","channelId":"…","messageId":"…"}`. Only committed writes broadcast. PostgreSQL rechecks the current session and membership before every event. A 256-event buffer and five-second send deadline bound slow consumers. Lagging connections receive `resync.required` and close; reconnect and fetch history to recover missed events.

Connections are bounded to 256 globally and eight per account, separately from ticket limits. Quota leases are released when the connection closes. Channel and membership changes emit a data-free `workspace.updated`; a removed member receives that refresh instruction but no community content. Message submission is limited to 120 requests per account per minute with a bounded 4096-account rate map.

Message content is trimmed and limited to 1–4000 UTF-16 units, matching the frontend. Retrying an identical author/client UUID returns the original message without a second broadcast. Changed content/channel returns `409`. Deletion erases content and retains metadata for idempotency; retrying a deleted send returns `410`.

Login and registration permit 30 attempts per client IP per 15 minutes, with 4096 tracked IPs. By default the client is the TCP peer, and all forwarded headers are ignored. When `NUVEX_TRUSTED_PROXIES` explicitly trusts that peer, one valid `X-Real-IP` supplies the client IP. `X-Forwarded-For` is always ignored. A reverse proxy must overwrite `X-Real-IP`, and the backend port must remain private; otherwise spoofing or shared proxy rate limits can result. Argon2 runs outside the asynchronous executor with four concurrent workers; excess calls receive `429`. Login cleanup retains at most 20 sessions per account, serialized against concurrent logins. Public deployments should also configure edge abuse limits.

## Checks

```sh
cargo fmt --manifest-path apps/server/Cargo.toml -- --check
cargo check --locked --manifest-path apps/server/Cargo.toml
cargo test --locked --manifest-path apps/server/Cargo.toml
cargo clippy --locked --manifest-path apps/server/Cargo.toml --all-targets -- -D warnings
```

Unit tests cover account fields, message bounds, tokens, rate limits and allowed origins. Integration requires a real running PostgreSQL instance; consult the root testing documentation for the harness and actual results.

API references: [Axum WebSockets](https://docs.rs/axum/0.8.9/axum/extract/ws/), [SQLx migrations](https://docs.rs/sqlx/0.8.6/sqlx/migrate/struct.Migrator.html), [Argon2](https://docs.rs/argon2/0.5.3/argon2/).
