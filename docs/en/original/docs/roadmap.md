# Roadmap and acceptance criteria

No dates or production readiness are implied. Each phase must be verified before the next adds substantial scope.

Current work has advanced from the initial frontend shell into the real-instance messaging implementation. Source/configuration now exist for the backend and Compose deployment. [Current verification](verification-current.md) records executed checks; [release readiness](release-readiness.md) tracks remaining deployment, browser, distribution, and publication work. The earlier [phase 0/1 check results](verification.md) apply to that historical snapshot. Apache-2.0 was subsequently approved and applied.

## Phase 0 — Inspect and decide

Inventory the repository, toolchain, available Rea integration, and supplied assets. Record observations separately from proposed architecture. Establish workspace boundaries, contribution/security guidance, font/brand provenance, and an approved license. The owner has selected Apache-2.0.

Acceptance: another contributor can identify what existed, what runs, which tools are missing or unverified, and which design decisions remain open. No proprietary implementation is used as a source dependency.

## Phase 1 — Design system and client shell

Deliver shared tokens, official branding, readable typography, reusable glass surfaces, navigation, messages, members, search, responsive layout, theme controls, and an optional Tauri shell scaffold. Demo operations remain visibly labeled and separate from service-backed features.

Acceptance: the web client starts and builds from a lockfile; automated checks execute; a user can navigate, send an ephemeral demo message, and change/import/export supported appearance data. Keyboard focus, narrow layouts, reduced motion, and import errors are checked. Native builds are reported separately, with platform/toolchain limitations. This milestone does not satisfy the messaging MVP.

## Phase 2 — First real messaging MVP

Implement the Rust/Axum service, PostgreSQL migrations, registration/login/logout, basic profiles, communities, text channels, owner/member permissions, message persistence, authenticated WebSocket events, and web-to-instance configuration. Provide a real backend Compose deployment with health checks, secrets documentation, and backup/restore instructions.

The exit scenario is explicit:

1. Deploy a fresh instance on independently controlled infrastructure with a new database.
2. Register two distinct users in independent browser sessions.
3. Create a community and text channel, then admit the second user through a defined membership flow.
4. Exchange messages in both directions without a page refresh.
5. Restart the service and reload both clients; history remains visible in the correct order.
6. Reconnect a dropped client; missed messages arrive without duplicate persisted sends.
7. Remove a user's permission and verify that history, sends, and live subscriptions are denied by the server.
8. Back up and restore to a separate database and verify accounts, memberships, and messages.

Also test invalid input, duplicate requests, expired/revoked sessions, unauthorized channel IDs, and bounded request/event sizes. A screenshot or single browser demo cannot substitute for this scenario.

## Phase 3 — Advanced communication

Sequence direct messages and moderation before larger media scope. Add file attachments with storage quotas and validation, notification preferences, and user controls. Design and evaluate voice channels, video, and screen sharing through WebRTC, an SFU, and TURN/STUN.

Acceptance is feature-specific: privacy and authorization tests for direct messages; upload/storage tests for attachments; delivery and preference tests for notifications; and real device/network tests for media permissions, reconnection, and group-call limits. Browser/PWA offline behavior requires its own cache and security design; a responsive website alone is not a finished PWA.

## Phase 4 — Open ecosystem and distribution

Build versioned bot/developer APIs, advanced theme tooling, and a capability-based plugin SDK. Prepare signed desktop releases with verified update metadata and reproducible build instructions. Evaluate Android/iOS and improved administration, migration, and data export tools.

Acceptance includes clean-install tests on Windows/macOS/Linux, upgrade/recovery tests, documented API compatibility, extension isolation tests, and platform-specific release checks. Public distribution also requires the approved project license, brand policy, dependency notices, and a working security contact.

Enterprise OIDC/SSO requires its own identity-provider, account-linking, authorization/group-mapping, logout/revocation, and security test milestone. Hosting a company-owned nu.vex instance with local accounts does not by itself implement enterprise SSO.

Federation remains a separate proposal. It must first define identity, addressing, transport, moderation, abuse controls, deletion, and consistency semantics. No federation is assumed by the single-instance data model.
