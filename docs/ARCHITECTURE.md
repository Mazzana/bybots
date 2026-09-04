# Architecture and data flow

ByBots is a thin client and policy boundary around Hermes. Hermes remains
the source of truth for profiles, sessions, conversations, routines, tools, MCP
configuration, and usage data. ByBots does not duplicate that state in a
second database.

## Components

```text
React interface
  Web/PWA or sandboxed Electron renderer
              |
              | same-origin REST and SSE
              v
Byfinity Bridge (Fastify)
  validation, role enforcement, error adaptation
              |
              | Hermes REST, JSON-RPC, and WebSocket contracts
              v
Hermes 0.21.x
  profiles, sessions, memory, routines, tools, MCP, usage
```

- **React interface:** renders Bots and conversations and stores display
  preferences, bounded per-conversation drafts, and the last selected thread in
  browser storage.
- **Electron shell:** starts an embedded loopback Bridge, loads only that local
  origin, keeps Node integration disabled, enables renderer sandboxing, and
  redirects external links to the operating system.
- **Byfinity Bridge:** is the only component that understands Hermes contracts.
  It validates input, maps failures into stable UI actions, enforces roles, and
  serves the production frontend.
- **Hermes:** owns all agent and conversation state and executes model, tool,
  routine, and MCP operations.

## Primary data flows

### Startup and diagnostics

1. The interface requests Bridge access, diagnostics, profiles, groups, and
   machine summaries in parallel.
2. The Bridge reads its default Hermes URL and session token from the process
   environment. An administrator-selected gateway may use a saved session token
   or OAuth bearer credentials from the local connection store instead.
3. Diagnostics probe Hermes health and the authenticated `profiles.list`
   contract. Hermes credentials are never returned to the interface.
4. Missing authentication opens the first-run connection flow; other failures
   remain visible as actionable diagnostics.

### Conversation

1. A user selects a Bot and a native Hermes thread.
2. The interface sends the message to the Bridge with the selected profile and
   thread identifiers.
3. The Bridge validates the request and forwards it to Hermes.
4. The interface follows the thread through server-sent events. A bounded
   polling fallback handles unavailable or interrupted streams.
5. The completed transcript remains in Hermes and is fetched again when the
   thread is reopened.

### Drafts and text attachments

Drafts are local interface state stored below `byfinity.drafts.v1`. ByBots keeps
at most 80 entries, 100,000 characters per draft, and 1,000,000 characters in
the saved draft set. Writes are debounced and flushed when the page is hidden or
the interface closes. Drafts are never sent until the user submits a message.

Text attachments are read by the renderer after explicit file selection and
embedded in the submitted message. The interface accepts no more than five
files, 256 KiB each and 512 KiB across the encoded attachment set. Binary and
multimodal files are rejected. Local paths are not sent to the Bridge or to a
remote Hermes gateway.

### Profile archive transfer

Hermes 0.21 exchanges filesystem paths for profile archives. When the Bridge
and Hermes run in separate containers, both receive one dedicated exchange
directory mounted at the same absolute path. The Bridge uses a fresh directory
for every operation, rejects a symlinked exchange root, limits archives to
25 MB, and cleans the operation directory in `finally`. The Hermes data volume
is never mounted into the Bridge.

## Trust boundaries

| Boundary | Trusted input | Untrusted input | Control |
| --- | --- | --- | --- |
| Browser/Electron to Bridge | Same-origin application shell | Host, Origin, form values, archives, route parameters | Exact trusted-host/origin policy, Zod validation, body limits, role checks |
| Bridge to Hermes | Configured URL and local session secret | Hermes payloads and failures | Contract adapter, request and connection deadlines, bounded pending work, typed failures |
| Bridge filesystem | Dedicated config and exchange paths | Imported archive bytes, returned archive paths | Regular-file checks, path equality, size limits, cleanup |
| Remote device to deployment | Authenticated private-network identity | Network requests | Loopback binding, Tailscale or identity-aware proxy |
| Electron renderer to host | Packaged local application | Rendered conversation content and links | Context isolation, sandbox, no Node integration, navigation allowlist |

Bridge roles are enforced server-side. UI visibility is only a convenience and
is never treated as authorization. A `viewer` reads data, an `operator` may
converse and run existing routines, and an `admin` may change Bots, groups,
capabilities, schedules, gateways, and profile archives.

## Persisted data

| Location | Contents | Sensitivity |
| --- | --- | --- |
| Hermes data volume | Profiles, sessions, conversations, memory, routines, credentials | Very high |
| Bridge connection file | Selected Hermes URL and session or OAuth credentials | Secret |
| Browser/Electron storage | Language, display preferences, bounded drafts, last-used thread IDs | Local private content and metadata |
| Temporary exchange directory | One bounded profile archive during transfer | Sensitive and short-lived |

Operational addresses, credentials, backups, and incident procedures belong in
private deployment runbooks, not in the public repository.

## Deployment invariants

- Production `npm start` launches only the prebuilt Bridge.
- Hermes is never exposed directly to the public internet.
- A single-user VPS deployment binds both services to host loopback and exposes
  only ByBots through authenticated Tailscale Serve.
- Multi-user deployments require an identity-aware proxy and distinct access
  roles; Hermes profiles alone are not system-level tenant isolation.
- The deployed ByBots commit and Hermes version are recorded together.

## Versioned contracts

Bridge API version 1 is the public third-party contract. Its compatibility
rules, role matrix, route inventory, and SSE behavior are frozen in
[`BRIDGE-API.md`](BRIDGE-API.md). Hermes compatibility remains isolated behind
the Bridge adapters. See [`HERMES-COMPATIBILITY.md`](HERMES-COMPATIBILITY.md),
[`MIGRATIONS.md`](MIGRATIONS.md), and [`SUPPORT.md`](SUPPORT.md).
