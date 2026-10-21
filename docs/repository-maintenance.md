# Repository maintenance

The public upstream repository is [ImPaul17/nu.vex](https://github.com/ImPaul17/nu.vex).
During the Alpha it is maintained solely by `ImPaul17` and does not accept
external code contributions. The Apache-2.0 license permits independent use
and forks; public visibility does not grant repository write permissions.
See [CONTRIBUTING.md](../CONTRIBUTING.md) for this policy and the fork build workflow.

## Access and main protection

Verified through GitHub's API on 21 October 2026:

- `ImPaul17` is the sole account with write/admin access. No collaborator
  invitations are pending. Readers cannot push or create upstream branches.
- `main` requires a pull request and all eleven existing CI checks, with the
  branch up to date before merging. The policy also applies to administrators.
- Force pushes and deletion of `main` are disabled. Linear history and resolved
  review conversations are required.
- No additional approving reviewer is required: the owner can maintain the
  repository without an external collaborator.
- Squash is the only enabled merge method. Merged PR branches are deleted
  automatically. The owner can create temporary working branches for maintenance.
- Workflows triggered by all external fork contributors require manual owner
  approval. Default workflow permissions are read-only and automated approval of
  pull requests is disabled.

The required checks cover web/core validation on Windows and Linux, real-instance
messaging, Compose deployment, native compilation on Windows/Linux/macOS,
Windows/Linux native UI, and real HTTPS/WSS on Windows/Linux. Their pull-request
triggers run regardless of changed paths, so a documentation-only PR does not
wait forever for a check excluded by a path filter.

These settings are live GitHub repository configuration, separate from the files
in a clone. The owner can change them; no protection can prevent an owner from
deliberately changing their own access policy. Recheck collaborators, invitations
and branch protection when adding an integration or changing maintainership.

GitHub reference: [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
