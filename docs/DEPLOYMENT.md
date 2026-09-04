# Deployment guide

For a step-by-step installation using the production Compose file, see
[`SELF-HOSTING.md`](SELF-HOSTING.md). This document describes the security
model and deployment invariants behind that procedure.

ByBots is composed of a React/Electron client, a local Fastify Bridge, and a Hermes runtime. The Bridge is the only component that should communicate directly with Hermes contracts. Hermes may run beside the Bridge or behind a trusted private network.

## Security boundary

Keep Hermes on loopback when it is co-located with the Bridge. For a remote Hermes gateway, use HTTPS or a trusted private tunnel and do not expose the gateway directly to the public internet. Expose the Bridge only through an authenticated private network or an identity-aware reverse proxy. Never publish Hermes session tokens, provider keys, conversation databases, profile assets, or operational runbooks.

```text
Authorized device
  -> private network or identity-aware proxy
  -> Byfinity Bridge
  -> loopback or private-network Hermes runtime
```

## Local production build

```bash
npm ci
npm test
npm run build
npm start
```

`npm start` launches only the prebuilt Bridge. It never installs or starts
Hermes. Set `HERMES_URL` and `HERMES_DASHBOARD_SESSION_TOKEN` in the process
environment when Hermes is not the local development runtime. The default
production endpoint is `http://127.0.0.1:4179`.

Use `npm run start:local` only for the all-in-one local workflow that deliberately
starts a development Hermes runtime beside the Bridge.

## Existing Dockerized Hermes on Linux

[`compose.production.yaml`](../compose.production.yaml) builds a dedicated
ByBots container without bundling or starting Hermes. It uses Linux host
networking so both services remain reachable only through their existing host
loopback bindings. No application port is published by Docker.

1. Copy `.env.production.example` to `.env.production`, add only the Hermes
   dashboard session token, and protect the file with mode `600`.
2. Create local `data` and `exchange` directories owned by UID/GID `1000`, or
   adjust their ownership to the non-root identity used by both containers.
3. Mount the same host `exchange` directory into the existing Hermes service at
   `/var/lib/byfinity-bots/exchange`. This narrow mount is required because the
   Hermes 0.21 profile archive contract exchanges file paths rather than archive
   bytes. Do not mount the Hermes data directory into ByBots.
4. Validate both Compose files, build the image, and start ByBots.
5. Confirm `http://127.0.0.1:4179/api/health` succeeds on the host before adding
   a private reverse proxy or Tailscale Serve route.

The matching addition to the existing Hermes service is intentionally limited
to one directory:

```yaml
services:
  hermes:
    volumes:
      - /absolute/path/to/byfinity-bots/exchange:/var/lib/byfinity-bots/exchange
```

Both containers must see the exchange directory at the exact same absolute
container path. ByBots creates a fresh operation directory, rejects
symlinked exchange roots, enforces the 25 MB archive limit, and removes the
operation directory after every success or failure.

## Remote access

For a small trusted device fleet, route the loopback Bridge through a private overlay network such as Tailscale Serve. Do not use a public funnel.

For multiple users, place the Bridge behind an identity-aware access layer such as Cloudflare Access and assign separate Bridge roles:

- `viewer`: read-only access;
- `operator`: conversations and existing routine execution;
- `admin`: Bot, group, capability, and schedule administration.

Configure role tokens through the deployment secret store. Never place their values in Git, issue reports, screenshots, or support messages.

The local Bridge rejects unknown `Host` and browser `Origin` values when role
tokens are absent. Prefer proxy-injected Bridge role tokens. For a single-user
private proxy that already authenticates every request, add only its exact
public hostname to the comma-separated `BYFINITY_TRUSTED_HOSTNAMES` allowlist.
Never use a wildcard and never trust forwarded host headers from an untrusted
proxy. A hostname allowlist does not replace Tailscale or identity-aware access.

Administrators can select and test a Hermes gateway from **Settings → Hermes**. As in Hermes Desktop, ByBots first probes the public `/api/status` contract and reads `/api/auth/providers` only for a human-readable label. An OAuth gateway opens Hermes' native PKCE flow and lets Hermes automatically select its single eligible provider; users never enter a provider identifier. A session-token gateway instead displays the dashboard token form. OAuth uses a loopback callback and single-use WebSocket tickets. The Bridge renews OAuth credentials before expiry, retries temporary provider outages, and requires a fresh sign-in after a terminal refresh rejection. The Bridge validates the health and authenticated `profiles.list` contract before switching all REST and WebSocket services. Credentials are never returned to the browser. A saved selection is stored in the local user-scoped Bridge configuration; set `BYFINITY_CONFIG_FILE` to place that file in a deployment-managed secret volume. Protect the file with operating-system permissions and prefer environment-managed credentials on shared servers.

The Web client stores bounded unfinished drafts in origin-scoped browser
storage. On shared workstations, use separate operating-system or browser
profiles and clear site data when access is transferred. Draft storage is not a
server backup and is not synchronized between devices.

## Required checks

Before exposing a deployment:

1. Confirm Hermes and the Bridge listen only on the intended interfaces.
2. Confirm unauthenticated API requests are rejected.
3. Test each role against read and mutation routes.
4. Verify backups and perform a restoration drill.
5. Confirm logs do not contain tokens, WebSocket query strings, or private conversation content. Rotate the Hermes session token if historical access logs captured `/api/ws?token=` URLs.
6. Record the deployed ByBots commit and Hermes version.

Infrastructure-specific addresses, usernames, paths, backup destinations, and recovery procedures belong in a separate private runbook.
