# Contributing to ByBots

Thank you for helping improve ByBots. The project aims to provide a simple, accessible interface for orchestrating Hermes profiles as Bots.

## Before you start

- Open an issue for substantial behavior or architecture changes.
- Keep pull requests focused on one outcome.
- Never include API keys, session tokens, private conversations, customer data, or infrastructure-specific values.
- Treat Hermes as an external runtime. Keep version-dependent adaptation inside the Byfinity Bridge rather than scattering Hermes contracts through the React application.

## Local development

Requirements:

- Node.js 22.12 or newer, up to the 24.x line;
- npm;
- a compatible Hermes runtime for live integration testing.

Install and start the development stack:

```bash
npm ci
npm run dev
```

The Vite application is served on `http://127.0.0.1:5188` and the local Bridge on `http://127.0.0.1:4179`.

From a fresh clone, install the browser used by the smoke suite once:

```bash
npx playwright install chromium
```

## Code conventions

- Write source code, identifiers, comments, commit messages, and new technical documentation in English.
- Add both English and French translations for every user-facing string.
- Preserve keyboard navigation, visible focus, reduced-motion support, and touch targets of at least 44 px.
- Return structured, actionable failures from the Bridge instead of parsing arbitrary error text in UI components.
- Keep bodyless HTTP requests free of `Content-Type: application/json`.
- Preserve Hermes session activity ordering; do not replace it with creation-time sorting.

## Validation

Run before submitting a pull request:

```bash
npm test
npm run test:e2e
npm run build
npm run test:production-start
npm audit --omit=dev --audit-level=high
git diff --check
```

When changing a Hermes adapter, also run `npm run test:hermes` against a trusted Hermes `0.21.x` instance when a dashboard session token is available. This live check is read-only and optional in public CI.

Behavior changes require regression tests. UI changes should also be checked in the running application at desktop and mobile widths.

Maintainers can regenerate the sanitized README screenshots with `npm run screenshots`. The capture uses only deterministic example Bots and conversations; never replace those fixtures with a live Hermes profile.

## Commits and pull requests

Use concise Conventional Commit messages, for example:

```text
feat(bots): add profile import preview
fix(chat): preserve the last selected thread
docs(contributing): document Hermes compatibility checks
```

Explain the outcome, validation evidence, Hermes compatibility, and any remaining limitation in the pull request.
