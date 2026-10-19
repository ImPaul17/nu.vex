# Instance infrastructure

- `Dockerfile.server`: locked Rust release build and unprivileged Debian runtime.
- `Dockerfile.web`: pinned npm/static frontend build and unprivileged Nginx runtime.
- `nginx.conf`: same-origin API/WebSocket proxy, local assets, health routes, bounded request size, and minimal access logs.
- `write-csp.mjs`: hashes the actual built inline SvelteKit bootstrap for the script CSP; scripts do not use `unsafe-inline`.
- `postgres-init.sh`: fresh-volume application role/database creation without granting the application PostgreSQL superuser privileges.
- `backup-db.mjs` / `restore-db.mjs`: binary-safe backups with metadata/hash verification and restoration into a new database only.
- `Caddyfile.example`: optional HTTPS proxy example for a domain owned by the operator.

The root `compose.yaml` connects these pieces. See [self-hosting](../docs/self-hosting.md) for secrets, startup/migrations, HTTPS, local development, persistence, updates, and recovery. Default registration is closed, insecure mode is off, required secrets/origin have no working defaults, and only the loopback web port is published.

Run the infrastructure boundary tests without Docker:

```sh
node --test infra/infra.test.mjs
```

These tests check restore-target safeguards, archive integrity validation, and CSP generation. They do not execute PostgreSQL, `pg_dump`, Docker images, or Compose. Docker configuration/build/startup and a real backup/restore drill remain explicit release checks. Desktop Tauri packaging is separate from this server stack.
