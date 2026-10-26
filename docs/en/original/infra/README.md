# Instance infrastructure

- `Dockerfile.server`: locked Rust release build and unprivileged Debian runtime.
- `Dockerfile.web`: pinned npm/static frontend build and unprivileged Nginx runtime.
- `nginx.conf`: same-origin API/WebSocket proxy, local assets, health routes, bounded request size, and access logs with invite paths redacted. Error logging is disabled only for the WebSocket-ticket endpoint and invite-join endpoint because Nginx errors can expose their original request line; the access log retains HTTP failure status. `nginx-api-proxy.conf` supplies their shared proxy configuration.
- `write-csp.mjs`: hashes the actual built inline SvelteKit bootstrap for the script CSP; scripts do not use `unsafe-inline`. `connect-origins.mjs` validates an optional build-time API/WebSocket allowlist, with same-origin connections as the default.
- `postgres-init.sh`: fresh-volume application role/database creation without granting the application PostgreSQL superuser privileges.
- `backup-db.mjs` / `restore-db.mjs`: binary-safe backups with metadata/hash verification and restoration into a new database only.
- `Caddyfile.example`: optional HTTPS proxy example for a domain owned by the operator.

The root `compose.yaml` connects these pieces. See [self-hosting](../docs/self-hosting.md) for secrets, startup/migrations, HTTPS, local development, persistence, updates, and recovery. Default registration is closed, insecure mode is off, required secrets/origin have no working defaults, and only the loopback web port is published.

Run the infrastructure boundary tests without Docker:

```sh
node --test infra/infra.test.mjs
```

These tests check restore-target safeguards, archive integrity validation, and actual CSP generation/invalid-origin rejection. They do not execute PostgreSQL, `pg_dump`, Docker images, Compose, or Nginx. The disposable Compose acceptance separately checks real Nginx credential redaction. See the current [verification record](../docs/verification-current.md) for executed deployment checks. Desktop Tauri packaging is separate from this server stack.

To permit selected independent HTTPS APIs, set `NUVEX_CONNECT_ORIGINS=https://chat.example.org,https://team.example.org:8443` in the Compose environment and rebuild `web`. The value is passed only as a Docker build argument; the generated policy includes the matching `wss://` sources. HTTP origins are accepted only for `localhost`, `127.0.0.1`, and `[::1]`, with matching `ws://` sources. Use exact origins without a trailing slash, credentials, paths, queries, fragments, or wildcards. The limit is 16 entries and 2048 UTF-8 bytes. Surrounding spaces between comma-separated entries are allowed, control characters are rejected, and duplicates/default ports are normalized. This extends `connect-src` only; scripts, fonts, and other code stay local. See [self-hosting](../docs/self-hosting.md#connecting-to-other-instances) for the matching backend configuration.
