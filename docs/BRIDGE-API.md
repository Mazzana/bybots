# Bridge API v1

The Byfinity Bridge is the policy boundary between browser, PWA, or Electron
clients and Hermes. API version `1` is the first public contract supported for
third-party clients.

## Version discovery and compatibility

- Every normal HTTP response carries `X-Byfinity-Bridge-Api-Version: 1`.
- `GET /api/health` returns `{ "ok": true, "apiVersion": "1" }`.
- Version 1 keeps the existing unprefixed `/api/...` paths. A future breaking
  contract will use a new advertised API version and migration notes.
- Adding an optional response field, enum member, SSE event, or optional route
  is compatible. Clients must ignore unknown fields and events.
- Removing a route or field, changing a field type or meaning, narrowing an
  accepted input, or changing a successful status code is breaking.
- Hermes capability-dependent routes may return `404` when the connected
  supported Hermes runtime does not expose that capability.

The Bridge API version is independent from the application version and the
Hermes compatibility range.

## Transport and access

JSON requests use `Content-Type: application/json`. Profile imports use
`application/gzip`; exports return `application/gzip`. Live thread updates use
server-sent events (`text/event-stream`). Request bodies and archives are
bounded by the Bridge.

In `0.3.1`, the first-party composer reads supported text attachments locally
and includes their bounded text content in the existing message `text` field.
The Bridge therefore receives a normal message request and never receives a
machine-local path. Binary and multimodal upload are not part of Bridge API v1.

`GET /api/health` is public. When role tokens are configured, all other routes
require `Authorization: Bearer <token>`:

- `viewer`: all reads except Hermes connection management;
- `operator`: viewer access plus messages, thread creation, group stop/message,
  and execution of an existing routine;
- `admin`: all routes.

When no role token is configured, the Bridge is local-only and grants the local
client the admin role. It accepts only explicitly trusted Host and browser
Origin values. Remote proxies should inject a Bridge role token. A single-user
private proxy may instead use an exact `BYFINITY_TRUSTED_HOSTNAMES` entry only
when it authenticates every request; a hostname allowlist does not replace that
external identity check.

The first-party interface never receives Hermes session or OAuth tokens. The
Bridge exchanges the one-time OAuth code and does not return credentials from
any endpoint.

## Optional outgoing activity in conversation snapshots

Bot conversation responses and SSE `conversation` events may include
`dispatches: [{ id, target, status }]`. IDs are Hermes tool-call IDs scoped to
that Bot conversation, not globally unique delivery IDs. Status is `started`,
`dispatched`, `failed`, or `unknown`. In particular, `dispatched` is not a
receipt acknowledgement. The list contains at most 50 observations in Bridge
memory, with no message bodies, credentials, or raw tool results. Absence of
this optional field does not prove that no Bot-to-Bot activity occurred.

## Error contract

Validation and Hermes failures use:

```json
{
  "error": {
    "reason": "invalid_request",
    "title": "Invalid request",
    "detail": "Human-readable detail",
    "hint": "Safe recovery guidance",
    "retryable": false,
    "action": "none"
  }
}
```

Supported actions are `retry`, `configure`, `wait`, `reconnect`, and `none`.
Clients must branch on `reason`, `retryable`, and `action`, not English text.

## Route inventory

Parameters beginning with `:` are percent-encoded path segments.

| Method | Path | Minimum role | Result |
| --- | --- | --- | --- |
| GET | `/api/health` | public | Bridge readiness and API version |
| GET | `/api/access` | viewer | Effective Bridge role |
| GET | `/api/diagnostics` | viewer | Actionable Bridge/Hermes checks |
| GET | `/api/diagnostics/report` | viewer | Redacted diagnostics export |
| GET | `/api/hermes/connection` | admin | Redacted active connection |
| POST | `/api/hermes/connection/auth` | admin | Probe the public Hermes status and provider metadata without credentials |
| POST | `/api/hermes/connection/oauth/start` | admin | Start native PKCE authorization and let Hermes select its eligible provider |
| GET | `/api/hermes/connection/oauth/callback` | public, state-bound | Consume the one-time code and return to the local application |
| POST | `/api/hermes/connection/test` | admin | Non-persisted gateway probe |
| PUT | `/api/hermes/connection` | admin | Probe and persist gateway |
| DELETE | `/api/hermes/connection` | admin | Restore environment gateway |
| GET | `/api/machines` | viewer | Hermes peer summaries |
| GET | `/api/bots` | viewer | Bot summaries |
| POST | `/api/bots` | admin | Create a Bot profile |
| DELETE | `/api/bots/:name` | admin | Delete a non-system Bot |
| POST | `/api/bots/:name/export` | admin | Download a bounded archive |
| POST | `/api/bots/import?name=&gatewayId=` | admin | Import a bounded archive to the selected or default gateway |
| PATCH | `/api/bots/:name/avatar` | admin | Update Bot appearance |
| GET | `/api/bots/:name/usage?days=` | viewer | Bot usage summary |
| POST | `/api/bots/:name/mcp/:server/test` | admin | Test one installed MCP server and return a bounded tool inventory |
| GET | `/api/bots/:name/config` | viewer | Profile and capability configuration |
| PATCH | `/api/bots/:name` | admin | Update profile and capabilities |
| GET | `/api/bots/:name/routines` | viewer | Routine definitions |
| POST | `/api/bots/:name/routines` | admin | Create a routine |
| PATCH | `/api/bots/:name/routines/:routineId` | admin | Enable or pause a routine |
| POST | `/api/bots/:name/routines/:routineId/run` | operator | Run an existing routine |
| DELETE | `/api/bots/:name/routines/:routineId` | admin | Delete a routine |
| GET | `/api/bots/:name/routines/:routineId/runs` | viewer | Routine run history |
| GET | `/api/bots/:name/conversation` | viewer | Legacy canonical conversation |
| POST | `/api/bots/:name/messages` | operator | Send to the canonical conversation |
| GET | `/api/bots/:name/threads` | viewer | Byfinity-owned native threads |
| POST | `/api/bots/:name/threads` | operator | Create a native thread |
| GET | `/api/bots/:name/threads/:threadId` | viewer | Thread snapshot |
| GET | `/api/bots/:name/threads/:threadId/events` | viewer | Bounded SSE stream |
| POST | `/api/bots/:name/threads/:threadId/messages` | operator | Send a thread message |
| PATCH | `/api/bots/:name/threads/:threadId` | admin | Rename a thread |
| DELETE | `/api/bots/:name/threads/:threadId` | admin | Archive a thread |
| GET | `/api/groups` | viewer | Group rooms and run state |
| POST | `/api/groups` | admin | Create a group |
| POST | `/api/groups/:id/messages` | operator | Start or continue a group exchange |
| POST | `/api/groups/:id/stop` | operator | Stop the active group run |

## Server-sent events

The thread event route can emit `conversation`, `delta`, `archived`, and
`error`. A heartbeat comment is sent every 15 seconds. Connections have global
and per-principal limits, a maximum lifetime, and are closed when the consumer
cannot keep up. A refused stream returns `429` with `Retry-After`.

## Conversation message attribution

Conversation snapshots may add an optional `attribution` object to a message.
For a Hermes Bot-to-Bot delivery it currently has this bounded shape:

```json
{
  "kind": "agent",
  "source": "hermes-delivery-prefix",
  "sender": { "displayName": "Research Lead", "profile": "research" },
  "recipient": { "displayName": "finance", "profile": "finance" },
  "status": "delivered"
}
```

The Bridge derives this compatibility metadata only from current or legacy
Hermes 0.21 delivery prefixes inside the canonical `Bot Chat`. It strips the
transport prefix from the displayed body. User messages in other threads are
not reinterpreted. In the multi-gateway preview, `gatewayId`, `gatewayLabel` and
`gatewayDefault` identify a Bot's connection. Additional-gateway Bot IDs use
`gatewayId::profile`; original unqualified IDs keep their original routing.

### Multi-gateway preview additions

- `GET /api/gateways/status` is available to authenticated viewer/operator/admin
  roles and returns only connection IDs, labels, default flags and authenticated
  reachability status. It does not expose URLs or credentials.
- `GET /api/hermes/connection/gateways` is administrator-only and includes the
  relay `safety` state and bounded metadata activity.
- `PUT /api/hermes/connection/gateways/:id/default` persists the default for
  new Bots and imports, without moving existing identities.
- `PUT /api/hermes/connection/relay/pause` accepts `{ "paused": true }` (or
  `false`) and requires administrator access. It stops new forwards, not turns
  already accepted by Hermes.

The canonical implementation and validation schemas remain in `server/app.ts`.
Changing the public contract requires updating this document, focused API tests,
and `CHANGELOG.md` in the same change.
