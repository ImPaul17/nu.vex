# Security

## Current support status

nu.vex is a pre-release communication platform. A Rust authentication/messaging service and deployment files are under development and verification; there is no supported stable production release or completed security audit. The explicit local demo is not a private or durable communication channel. No end-to-end encryption claim is made. See [release readiness](docs/release-readiness.md).

## Reporting a vulnerability

Use the repository's [private vulnerability reporting form](https://github.com/ImPaul17/nu.vex/security/advisories/new). Private vulnerability reporting was enabled and its enabled state verified through GitHub's API on 19 October 2026.

You can also open **Security → Report a vulnerability** in [ImPaul17/nu.vex](https://github.com/ImPaul17/nu.vex). If the form is unavailable, ask the maintainer for a private channel without disclosing the exploit publicly. Never send secrets, real user messages, or a database dump in a public issue. No security email address is published here.

Include the affected version or commit, environment, impact, minimal reproduction using synthetic data, and any proposed fix. Coordinate disclosure with the maintainer. Acknowledgement and remediation deadlines have not yet been established; this file does not promise an unattended reporting service.

## Engineering boundaries

- Treat imported themes, message content, files, URLs, and future plugin output as untrusted.
- Restrict theme imports to validated data mapped to known tokens; do not evaluate scripts or inject arbitrary CSS/HTML.
- Keep native capabilities explicit and minimal. Remote instance content must never inherit operating-system privileges.
- For phase 2, authorize every server operation and WebSocket subscription using current membership and permissions. UI visibility is not an access control.
- Keep credentials out of source, logs, URLs, browser theme exports, and build-time public variables.
- Require secure transport in real deployments and document session revocation, request limits, backups, and updates before supporting production use.

These boundaries guide the current implementation and future milestones. Executed functional tests are recorded in [current verification](docs/verification-current.md); they do not constitute a security audit or a production support commitment.
