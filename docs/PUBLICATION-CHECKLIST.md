# Public repository checklist

This checklist prepares the public repository without confusing source
publication with a stable product release.

## Repository identity

- [x] Create or select the official public repository.
- [x] Add its URL to `package.json` and replace the clone placeholders in
  `README.md` and `docs/INSTALLATION.md`.
- [x] Configure the default branch and branch protections.
- [x] Confirm that the public name, description, topics, and icon all use
  **ByBots**.

## Privacy

- [x] Scan the complete public Git history, not only the current tree, for secrets.
- [x] Confirm that no infrastructure runbook, `.env` file, token, Hermes
  archive, backup, or raw diagnostics report is tracked.
- [x] Keep VPS procedures and infrastructure coordinates in a separate private
  operations repository.
- [x] Enable private vulnerability reporting on the Git hosting platform.

`npm run test:docs` fails when a known private runbook is tracked, forbidden
infrastructure data appears in public documentation, public documentation
contains French prose, or an internal Markdown link is broken. This check does
not replace a full-history secret scanner.

## Community and quality

- [x] MIT license.
- [x] English project README.
- [x] Installation, user, self-hosting, and troubleshooting guides.
- [x] Contribution guidelines, code of conduct, and pull request template.
- [x] Security policy and issue templates.
- [x] CI for tests and builds.

## Release candidate

- [ ] Confirm that `package.json`, `README.md`, `CHANGELOG.md`, and the release
  tag all identify the same candidate version.

```bash
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:production-start
npm audit --omit=dev --audit-level=high
```

- [ ] Build artifacts from a tag that exactly matches `package.json`.
- [ ] Sign Windows with the publisher certificate.
- [ ] Sign and notarize macOS with repository-managed Apple credentials.
- [ ] Verify SHA-256 checksums and artifact provenance.
- [ ] Complete the checklists on clean Windows and macOS machines.
- [ ] Install, upgrade, roll back, and complete the first launch → Hermes
  connection → Bot creation → complete reply journey.

## Publish

- [ ] Turn [CHANGELOG.md](../CHANGELOG.md) changes into release notes.
- [ ] Publish a pre-release first and collect qualification feedback.
- [ ] Create a stable tag only after the support matrix and every release
  qualification check pass.
- [ ] Verify links, downloads, and checksums from a signed-out browser session.

Choices and external evidence still required remain explicit in the support and
release documentation so they are not accidentally marked complete.
