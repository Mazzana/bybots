# Hermes compatibility

ByBots currently targets the Hermes `0.21.x` contract. Unit tests protect the adapters against representative payloads, while the optional live check detects drift in a running Hermes installation.

## Public health check

Start Hermes, then run:

```bash
npm run test:hermes:health
```

Set `HERMES_URL` when Hermes is not listening on `http://127.0.0.1:9119`.

## Full read-only contract check

Provide a dashboard session token through the process environment and run:

```bash
npm run test:hermes
```

The script does not print the token and performs no mutations. It validates the surfaces currently used by ByBots:

- public health and version metadata;
- REST profile and cron reads;
- JSON-RPC profile, session, model, and MCP catalog reads.

Do not store the token in Git, shell history, screenshots, or issue reports. CI intentionally runs only mocked adapter tests because a standard pull request has no trusted Hermes runtime or session token.

## Security-sensitive contract gaps

Hermes `0.21.x` currently authenticates the `/api/ws` handshake with a session
token in the query string. This repository does not prove support for an
authentication header, cookie, subprotocol, or one-time exchange token on that
endpoint. Until an alternative is verified live and versioned here, keep Hermes
on loopback or a trusted private network, use HTTPS/WSS for remote transport,
redact query strings from every proxy and trace, and rotate tokens that may have
entered historical access logs.

Group sessions are created with the selected member profile so the Bot keeps its
identity and configured capabilities. Hermes `0.21.x` does not expose a verified
Bridge contract here for a structured non-instruction transcript channel or a
least-privilege group capability override. Group members must therefore be
treated as one trust domain. Do not mix profiles with materially different
private data or mutating tool authority until that contract is available and
covered by an adversarial live test.

Hermes `0.21.x` does not expose a verified binary or multimodal upload contract
for ByBots. The 0.3.1 text-attachment feature therefore embeds bounded textual
content in the submitted message and never forwards a machine-local path. Files
outside the documented text allowlist remain unavailable until a versioned
upload contract is validated against a live Hermes runtime.

## Profile portability

The Data settings use the Hermes 0.21 profile export and import endpoints. ByBots stages archives in an isolated operating-system temporary directory, transfers at most 25 MB, and removes the staging directory after every attempt.

Hermes excludes credential files and redacts secret-shaped text during export. Profile archives can still contain conversations, persona documents, skills, routines, and other private context. Store and share them as sensitive data.
