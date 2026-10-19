# Local Windows verification toolchain

This records the development tools prepared on 2026-10-19 for the current
Windows workspace. They live entirely in ignored `.cache/`; no system PATH,
Windows services, global Rust installation, or Visual Studio installation was
modified. These helpers are a local development convenience, not the production
deployment method. Production uses the container configuration and its own
database and secrets.

The separate WSL Docker attempt below used a Linux-home cache and installed only
the required Ubuntu networking packages. It did not install Windows Docker
Desktop or a system-wide Docker service.

## What actually works

- Rust/Cargo **1.99.1**, host `x86_64-pc-windows-gnu`, with rustfmt and Clippy installed.
- WinLibs GCC **16.2.0**, MinGW-w64 **14.0.0**, POSIX/SEH/UCRT, release 3.
- PostgreSQL **17.11**, official EDB Windows x64 binary archive, revision 5.
- Rust and C smoke programs were compiled, linked, and executed successfully.
- An authenticated SQL query succeeded as role `nuvex` in database `nuvex`.
- The PostgreSQL listener was checked: **127.0.0.1:55432** only.
- The application database role is neither superuser nor allowed to create
  databases or roles. It owns this dedicated development database so migrations
  can create application tables.

The Visual Studio 2022 directory exists but contains no usable C++ toolchain;
the Windows SDK is absent. Existing WSL Ubuntu 26.04 starts, but contains no Rust,
C compiler, or PostgreSQL tools. A native GNU toolchain therefore provides local
backend verification without installing a system-wide IDE or modifying WSL.
This does not establish a supported Tauri Windows release toolchain: the desktop
build still needs its documented MSVC/SDK prerequisites and separate validation.

## Use the prepared tools

Run these in PowerShell from the repository root:

```powershell
. ./scripts/dev-tools/enter.ps1
rustc --version
cargo --version
./scripts/dev-tools/postgres.ps1 status
```

Dot-sourcing sets `CARGO_HOME`, `RUSTUP_HOME`, compiler/linker variables, and PATH
only in that shell. It also loads `NUVEX_DATABASE_URL` into the process environment
from `.cache/postgres/connection.json`. Do not print this variable or commit that
file. Child processes inherit it without placing the password in command-line
arguments.

The paths are derived from the repository location:

| Tool | Repository-relative path |
| --- | --- |
| Cargo/Rust proxies | `.cache/toolchains/cargo/bin/` |
| Rust toolchains | `.cache/toolchains/rustup/toolchains/` |
| GCC and GNU binutils | `.cache/toolchains/winlibs/mingw64/bin/` |
| PostgreSQL binaries | `.cache/toolchains/postgresql/pgsql/bin/` |
| PostgreSQL data | `.cache/postgres/data/` |
| PostgreSQL log | `.cache/postgres/server.log` |
| Generated development credentials | `.cache/postgres/connection.json` |

Control only the project cluster:

```powershell
./scripts/dev-tools/postgres.ps1 start
./scripts/dev-tools/postgres.ps1 stop
```

Stopping uses `pg_ctl -D <project data directory> -m fast`; it never kills every
PostgreSQL process or touches another cluster. The cluster is independent of
Windows services and survives ending a development shell until stopped.

For backend commands, first dot-source `enter.ps1` and then use the backend
development instructions. The helper intentionally does not change registration,
origin, cookie, or application security settings.

## Acquisition and verification

Rust was installed using the
[official rustup installation method](https://rust-lang.github.io/rustup/installation/other.html),
with `--no-modify-path --profile minimal --default-host x86_64-pc-windows-gnu
--default-toolchain 1.99.1`. Both home directories were set to the project-local
paths before running the installer. Rustup checks the Rust component manifests.
The bootstrap executable's SHA-256 was compared with the official `.sha256`
file before execution.

WinLibs is listed among the
[MinGW-w64 standalone distributions](https://www.mingw-w64.org/downloads/).
Its ZIP was obtained from the [publisher's release](https://github.com/brechtsanders/winlibs_mingw/releases/tag/16.2.0posix-23.1.3-14.0.0-ucrt-r3)
and compared with the release asset's published SHA-256 digest before extraction.
The build without LLVM was selected to avoid an unnecessary second compiler.

PostgreSQL was downloaded through the Windows x64 link for version 17.11 on the
[official EDB binary archive page](https://www.enterprisedb.com/download-postgresql-binaries),
which resolved to
[`postgresql-17.11-5-windows-x64-binaries.zip`](https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip).
Only `pgsql/bin`, `pgsql/lib`, and `pgsql/share` were extracted. No vendor checksum
was exposed by that download page; the digest below records the received archive
for subsequent integrity comparison, not independent publisher verification.

| Artifact | SHA-256 recorded during preparation |
| --- | --- |
| Official GNU `rustup-init.exe` | `6d5b5709addc0122c916d8c810da8d8a7b086a5d64fa805ef404d506392aadc8` |
| WinLibs x64 GCC 16.2.0 UCRT r3 ZIP | `3c69305081e4a647144339a936244fcf7d3d9e558319e1ad7be2cd2886d4b6a1` |
| EDB PostgreSQL 17.11-5 Windows x64 ZIP | `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f` |

Archives are retained in `.cache/toolchains/downloads/`. Treat future downloads
as new acquisitions: verify their published hashes instead of assuming the
bootstrap URL remains unchanged.

## WinLibs paths containing spaces

The original WinLibs GCC specs expression
`%:if-exists(default-manifest.o%s)` split the repository's `VSC Projects` path
while invoking the linker. The cache-local specs now references
`default-manifest.o%s` directly, retaining the same manifest object through GCC's
standard library-file lookup. The original archive and executable are unchanged.
Apply this configuration again after re-extracting the pinned toolchain:

```powershell
./scripts/dev-tools/fix-winlibs-path.ps1
```

This workaround was verified with both Rust and C executables. It is local
toolchain configuration; no absolute workstation path is stored in Cargo files.

## Initialize a fresh development cluster

After preparing the PostgreSQL binaries at the path above, run:

```powershell
./scripts/dev-tools/init-postgres.ps1
```

Initialization refuses to replace an existing cluster or disturb a listener on
port 55432. It generates independent cryptographic random admin/application
passwords, limits the cache directory ACL to the current Windows identity, uses
SCRAM authentication, binds loopback, and creates the dedicated role/database.
The instance uses UTC and is not registered as a Windows service. The temporary
password file used by `initdb` is removed after successful initialization.

This is disposable development data. Do not reuse its credentials, plaintext
local transport, or cluster settings in a hosted deployment. Use the documented
production secret handling, TLS, backups, and migrations for real instances.

## Real instance acceptance

After compiling the backend, the dependency-free Node harness starts its own
server process on loopback port 3301 and stops only that process:

```powershell
. ./scripts/dev-tools/enter.ps1
node ./scripts/verify-instance.mjs
```

`NUVEX_SERVER_BIN` optionally selects a different compiled executable, and
`NUVEX_VERIFY_PORT` changes the isolated verification port. The script refuses to
use an occupied port. It creates uniquely prefixed account/community data and
retains that data, without deleting any existing records. Reports are written to
ignored `.cache/verify-instance/<run UUID>/`; credentials are never printed.

The first execution passed all 11 groups: migrations repeated safely, real
cookie/bearer authentication, origin enforcement, community permissions,
invitations, message idempotency/deletion, 41-message cursor pagination, session
revocation, process restart persistence, membership revocation, pending-ticket
limits, and authentication request limits. WebSocket browser behavior has its
own browser tests; this harness does not claim to test that transport.

To verify a native development backup, coordinate a brief window without writes
to this disposable database, then run:

```powershell
./scripts/dev-tools/verify-backup.ps1
```

The helper creates a custom-format `pg_dump`, restores it into a fresh
`nuvex_restore_<random suffix>` database, and compares row counts and complete-row
fingerprints for all eight application/migration tables. It checks the source
again afterward to detect concurrent changes. It never drops or clears an
existing database. Dumps and reports inherit the private `.cache/postgres` ACL;
the restored verification database is retained for inspection.

The initial restore passed with four accounts, three sessions, one community,
one membership, two channels, one invitation, 42 messages including a deletion
tombstone, and one migration. Every table fingerprint matched, and the source
was unchanged. This validates native PostgreSQL backup/restore, not execution of
the Docker Compose deployment.

## WSL Docker verification boundary

The existing `Ubuntu` WSL 2 distribution was inspected before attempting Docker:
Ubuntu 26.04, systemd, cgroup v2, kernel 6.18.33.2, and overlayfs were available.
No Docker, containerd, or Docker socket existed. The official Docker Ubuntu
repository was read with its signed APT metadata into a dedicated cache; its
packages were downloaded and extracted without running Docker package install
scripts or registering Docker services. The CLI reported Engine **29.9.1**,
Compose **5.6.0**, and Buildx **0.38.0**; containerd package **2.4.2** was also
acquired. Their files and package digests are under
`/home/impaul/.cache/nuvex/docker/` in that distribution.

Ubuntu's signed repository supplied `iptables` and five required libraries
(approximately 3 MB installed). No Windows package was installed, no global
Windows PATH was changed, and no existing Docker data or service was replaced.
Acquisition followed the [official Docker Ubuntu package instructions](https://docs.docker.com/engine/install/ubuntu/).

Before the private daemon could be launched, WSL stopped accepting commands.
Even `/bin/true`, an explicit `--cd /`, and the WSL system distribution failed
with **error 6, step 2, `Wsl/Service/CreateInstance/E_FAIL`**. The authoritative
inventory showed `Ubuntu` stopped. One bounded recovery terminated only that
exact stopped distribution, then tried `/bin/true` once; it failed identically.
There was no global `wsl --shutdown`, Windows restart, filesystem deletion, or
attempt to kill `vmmemWSL`.

Consequently the daemon, Docker image builds, Compose startup, and container
health checks were **not executed successfully in this local WSL attempt**.
CLI version output and static configuration checks do not establish a working
container deployment. Native Windows Rust/PostgreSQL verification remains
independent of this host problem.

A later [hosted CI run for commit `4265617`](https://github.com/ImPaul17/nu.vex/actions/runs/39193292317)
passed all four jobs, including actual Compose builds/startup, REST/restart,
new-database restore with 8 matching table fingerprints, and the then-current
four-scenario browser suite through Nginx. The later [run for `c0f8cda`](https://github.com/ImPaul17/nu.vex/actions/runs/39193801672)
also passed all four jobs, including all five browser scenarios, controlled
remote-origin bearer/WebSocket access through Nginx, actual credential-redaction
checks, and the 8-table container restore with an unchanged source. These HTTP
loopback CI results do not repair or verify this local WSL daemon, establish an
external HTTPS topology, or verify a native desktop runtime. See
[current verification](verification-current.md) for subsequent results.

Prepared helpers, which still require runtime verification after WSL is repaired:

```powershell
./scripts/dev-tools/run-docker.ps1 start-daemon
./scripts/dev-tools/run-docker.ps1 status-daemon
./scripts/dev-tools/run-docker.ps1 compose --env-file .cache/compose.env config --quiet
```

The helper always selects the private UNIX socket and Linux-filesystem data
directory under `/home/impaul/.cache/nuvex/docker`; it never selects a TCP daemon
endpoint or the default `/var/run/docker.sock`. Its stop action verifies the
recorded PID's command line before signaling it. No Compose credentials were
generated or printed during the failed launch attempt. Actual container
acceptance must be run on a working Linux/Docker host or the repository's CI.
