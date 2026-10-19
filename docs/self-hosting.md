# Self-hosting a nu.vex instance

The repository includes the Rust service, SQL migrations, static web client, and a Compose stack. Implementation and successful deployment are different milestones: an isolated Docker attempt was blocked before daemon startup by the WSL host failing to start, so image builds, Compose startup, and container backup/restore remain to be executed. A [dedicated CI job](testing.md#actual-compose-deployment-in-ci) is prepared to verify the real deployment and browser against Nginx; no hosted run is recorded yet. Check [release readiness](release-readiness.md) before treating this as a supported production release.

Accounts belong to the instance you operate. A company can host its own nu.vex server and domain, create local nu.vex accounts, and control its database. This does not authenticate an arbitrary company website or an existing identity-provider account. OIDC/enterprise SSO is a separate planned feature. No centrally operated nu.vex account service is required.

## Topology and defaults

`compose.yaml` starts PostgreSQL 17, a one-shot migration service, the Rust API, and an unprivileged Nginx web server. Only web port 8080 is published, bound to `127.0.0.1` by default. PostgreSQL has no published port and uses the internal `data` network; its durable volume is mounted at `/var/lib/postgresql/data`, the correct location for the selected PostgreSQL 17 image. See the [official PostgreSQL image documentation](https://hub.docker.com/_/postgres).

The database initialization script creates a separate `nuvex` login without superuser, database-creation, or role-creation privileges. It owns the application database so migrations can create its schema. The PostgreSQL administrative password is separate from the application's password. The API and web containers run as non-root users with read-only root filesystems and minimal Linux capabilities.

Nginx serves the client and proxies `/api/*`, including `/api/v1/events`, to `server:3001` without rewriting the path. `/health/live` and `/health/ready` reach the backend; `/health/web` checks Nginx itself. WebSocket Upgrade/Connection headers are explicitly forwarded, as required by [Nginx's WebSocket proxy documentation](https://nginx.org/en/docs/http/websocket.html).

## Configure and start

Install Docker Engine or Docker Desktop with the Compose v2 plugin. From the repository root, copy `.env.example` to `.env` using your shell or editor. Generate two independent secrets:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Run that command twice and paste the values into `POSTGRES_PASSWORD` and `NUVEX_DATABASE_PASSWORD`. The application password must contain at least 64 hexadecimal characters because Compose uses it in a connection URI. No working passwords are supplied. Required blank values fail configuration/startup rather than using fallback credentials.

Set `NUVEX_ALLOWED_ORIGIN` to the exact public origin, such as `https://chat.your-domain.example`, with no path or trailing slash. Leave `NUVEX_INSECURE_DEV=false`. Set `NUVEX_REGISTRATION_OPEN=true` only when you intend to permit account creation; its default is false. Registration is local to your instance. An invite-only/admin-provisioned registration workflow requires its own implementation and is not implied by closing registration.

Protect `.env` with operating-system file permissions, keep it out of Git/backups shared publicly, and do not paste expanded `docker compose config` output into issues. This first deployment uses environment-based secret injection; Docker administrators can inspect container environments. A production secret-manager integration is separate work.

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps -a
docker compose logs --tail=100 migrate server
```

Inspect the actual output: the migration service must exit with code 0, and the server/web health checks must become healthy. Compose waits for database health, successful migration completion, and backend readiness using [dependency conditions](https://docs.docker.com/compose/how-tos/startup-order/). Migration failure blocks the application instead of silently serving an incompatible schema.

### Local-only HTTP evaluation

For evaluation on the same computer, deliberately set:

```dotenv
NUVEX_ALLOWED_ORIGIN=http://127.0.0.1:8080
NUVEX_INSECURE_DEV=true
NUVEX_REGISTRATION_OPEN=true
```

Keep `NUVEX_WEB_BIND=127.0.0.1` and open that exact address. The backend permits insecure development only for HTTP loopback origins. Use separate test credentials. These values do not provide HTTPS, and changing the host to a LAN/public address does not create a supported insecure deployment.

### HTTPS and company domains

Run a trusted HTTPS reverse proxy on the same host and proxy your chosen domain to `127.0.0.1:8080`. `infra/Caddyfile.example` provides a small Caddy example; configure real DNS, certificates, firewall access to 80/443, and the matching `NUVEX_ALLOWED_ORIGIN`. Follow the [Caddy reverse-proxy guide](https://caddyserver.com/docs/quick-starts/reverse-proxy) or your existing proxy's documentation.

Keep registration policy explicit and `NUVEX_INSECURE_DEV=false` on the HTTPS deployment. The backend uses Secure cookies outside local development and validates the exact browser origin for state-changing requests. The inner proxy does not trust client-supplied forwarded headers for authentication. Do not expose PostgreSQL or the raw API port to bypass the proxy/origin model.

The shipped web CSP deliberately permits connections only to its own origin. Therefore the production web image supports a client and API on the same instance origin. Selecting an unrelated remote API from this web image is currently unsupported even if the server's CORS configuration allows it. A future public multi-instance web client needs a controlled connection policy; do not replace this with unrestricted `connect-src *`. Desktop remote-instance access likewise needs an explicitly reviewed native network/CSP design.

### Trusted proxies and client rate limits

The API trusts `X-Real-IP` only from `NUVEX_TRUSTED_PROXIES`. Compose assigns Nginx the fixed private IP `172.29.251.10` and trusts exactly that `/32`; Nginx always replaces the header with its resolved `$remote_addr`. The API ignores `X-Forwarded-For`. Outside Compose, trusted proxies default to none; do not trust all private networks or `/0` merely to remove a shared rate limit.

With an additional host HTTPS proxy, Nginx initially sees that proxy's address. Until the outer hop is explicitly configured, its users share an IP-based rate limit. The Caddy example overwrites `X-Real-IP` from its actual network peer. Inspect Nginx logs to identify Caddy's real peer address, then configure only that IP in `infra/nginx-realip.conf` using `set_real_ip_from`, `real_ip_header X-Real-IP`, and `real_ip_recursive off`. The commented gateway address is an example, not proof of your network topology. Keep the published port on loopback so untrusted remote clients cannot bypass the trusted hop.

If the reserved Docker subnet conflicts with an existing network, choose another unused subnet and matching web address through `NUVEX_EDGE_SUBNET` and `NUVEX_WEB_INTERNAL_IP`; Compose derives the API's trusted `/32` from that address. Recreate the affected network in a planned maintenance window without removing the database volume, and verify that client-IP spoofing is rejected and distinct clients receive distinct rate-limit identities. Additional CDNs/proxies require their own explicit chain design.

## Configuration

| Setting | Purpose |
| --- | --- |
| `POSTGRES_PASSWORD` | Required PostgreSQL administrator secret for a fresh database volume |
| `NUVEX_DATABASE_PASSWORD` | Required separate application's secret; 64+ hexadecimal characters |
| `NUVEX_DATABASE_NAME` | Database name, default `nuvex`; lowercase identifier, maximum 63 characters |
| `NUVEX_ALLOWED_ORIGIN` | Required exact HTTPS browser origin; HTTP loopback only with explicit development mode |
| `NUVEX_INSECURE_DEV` | Defaults false; permits only local HTTP evaluation when true |
| `NUVEX_REGISTRATION_OPEN` | Defaults false; opt in to local account registration |
| `NUVEX_WEB_BIND`, `NUVEX_WEB_PORT` | Published web listener; defaults `127.0.0.1:8080` |
| `NUVEX_EDGE_SUBNET`, `NUVEX_WEB_INTERNAL_IP` | Reserved Docker edge subnet and fixed web proxy IP; defaults `172.29.251.0/24`, `172.29.251.10` |

Compose sets `NUVEX_DATABASE_URL`, `NUVEX_BIND=0.0.0.0:3001`, `NUVEX_MIGRATE_ON_START=false`, and the web proxy's exact trusted `/32` for the server. The separate migrator runs `--migrate`. Outside Compose, the server accepts those same variables; see [backend source/setup](../apps/server/README.md). The optional `NUVEX_INSTANCE_NAME` configures the instance display name when supplied directly to the service.

PostgreSQL initialization variables/scripts apply to a fresh volume only. Changing `.env` passwords does not rotate an existing database role's password; coordinate actual role changes and configuration updates. Do not delete the persistent volume to apply a configuration change to a real instance.

## Run the service from source

For Windows development, the [repository-local toolchain](toolchain-local.md) supplies an isolated Rust/PostgreSQL setup without changing global tools. After its database is initialized, a PowerShell session can load the helper and explicitly choose loopback development settings:

```powershell
. ./scripts/dev-tools/enter.ps1
./scripts/dev-tools/postgres.ps1 start
$env:NUVEX_BIND = '127.0.0.1:3001'
$env:NUVEX_ALLOWED_ORIGIN = 'http://127.0.0.1:5173'
$env:NUVEX_INSECURE_DEV = 'true'
$env:NUVEX_REGISTRATION_OPEN = 'true'
$env:NUVEX_MIGRATE_ON_START = 'false'
cargo run --locked --manifest-path apps/server/Cargo.toml -- --migrate
cargo run --locked --manifest-path apps/server/Cargo.toml
```

The helper supplies the local database URL from an ignored, user-protected secret file. It does not create a public production configuration. On other environments, install the documented Rust/PostgreSQL prerequisites and set `NUVEX_DATABASE_URL` to your own database connection; the Rust service does not implicitly source the Compose `.env` file.

Run `npm run dev` in a second terminal and open the exact Vite origin above. The Vite `/api` proxy sends requests to `127.0.0.1:3001`, keeping browser authentication on the frontend origin. Use the server's real login/registration flow; `/demo` is explicitly local and cannot validate the messaging service.

## Backup and restore

With the configured database container running, create a custom-format archive and metadata:

```sh
node infra/backup-db.mjs
```

An optional first argument chooses a new output path. Existing archives/metadata are never overwritten. The default is an ignored `backups/` directory. The helper uses a binary file descriptor rather than shell redirection, so PowerShell does not decode the dump as text. The metadata records source database, application version, `pg_dump` version, archive size, UTC creation time, and SHA-256.

Backups contain private messages, account data, and credential hashes. Keep the archive and its `.json` together, encrypt/protect off-host copies, define retention, and verify restores. SHA-256 detects accidental changes; it does not authenticate an untrusted backup or make restoring arbitrary SQL safe.

Restore into a **new, empty database name**, never over the active database:

```sh
node infra/restore-db.mjs backups/your-backup.dump restore_drill_20261019
```

The helper checks metadata/hash and `pg_restore` readability before creating a database. `createdb` refuses an existing target; restore uses one transaction and does not pass `--clean` or drop anything. A failed new target is retained for diagnosis. The active instance is not automatically repointed.

Verify accounts, memberships, messages, ordering, and permission denials on the restored database in an isolated test instance. For a deliberate recovery cutover, stop web/server traffic, retain the old database, set `NUVEX_DATABASE_NAME` to the verified restored name, rerun migrations with the matching application version, and recreate the runtime containers. Confirm readiness and the two-user scenario before restoring traffic. A backup command without this drill is not proof of recovery.

## Updates

Back up first. Stop incoming traffic, build or select the reviewed release images, run the migration service once, and bring up the application. For source builds, a typical sequence is:

```sh
docker compose stop web server
node infra/backup-db.mjs
docker compose build --pull migrate server web
docker compose run --rm migrate
docker compose up -d server web
docker compose ps -a
```

Review logs and readiness. A migration failure must keep traffic stopped. Schema downgrades are not assumed; rollback may require restoring a verified backup with a compatible earlier application version. Use `docker compose stop` to stop services while retaining data. Do not use volume-removal commands as an update or recovery shortcut.

Base images are pinned by version and registry digest in the Dockerfiles/Compose file. Refresh them through a reviewed dependency update and rebuild; operating-system packages installed during the server build still follow the selected Debian repository's updates. The supplied tags/digests were inspected, but container execution has not yet been verified in this environment.

## Release gate

A supported self-hosting release still needs an executed image/Compose test, two-user messaging/restart tests, a restore drill, an HTTPS deployment test, reviewed registration/admin operations, a real security contact, and documented upgrade compatibility. Track those checks in [release readiness](release-readiness.md). Native desktop installers are a separate build and signing workflow.
