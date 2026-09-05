# Changelog

All notable changes to this project will be documented in this file. The project follows [Semantic Versioning](https://semver.org/) and keeps changes grouped by release.

## [Unreleased]

### Added

- Authenticated gateway status indicators above Settings in the sidebar, with
  one indicator per configured connection. Shared status labels distinguish
  reachable gateways, missing authentication and unavailable connections.
- Gateway-aware archive imports with the main gateway preselected.
- Persistent metadata-only relay intent journal: interrupted exchanges become
  uncertain and are not automatically forwarded again after a restart. Journal
  errors or capacity exhaustion stop forwarding. A persisted global pause and
  a rolling limit of 30 forwards per ten minutes bound new relay traffic.
- Sidebar Bots are grouped by gateway with counts and gateway-name search.
  Administrators can choose a persistent main gateway in Settings, used by
  default for new Bots and displayed first. Existing Bot IDs, conversations,
  sessions and relay permissions remain unchanged.
- Multi-gateway preview: keep the primary Hermes connection and up to eight
  additional gateways, each with independent session-token or native OAuth
  authentication. Bots share one list with gateway labels and scoped profile
  IDs; new Bots can be created on a selected gateway. Existing primary IDs stay
  unchanged. Administrators explicitly enable native Bot relay on each trusted
  gateway; ByBots synchronizes rosters, forwards `message_agent` envelopes and
  returns replies using Hermes' four `bot_relay.*` methods. The bounded activity
  list contains routing/status metadata, not message content. Group rooms remain
  gateway-local. See the [multi-gateway guide](docs/MULTI-GATEWAY.md) for trust,
  availability and restart limitations. This work is unreleased.
- Manual desktop update checks in Settings → About. Electron checks the fixed
  public GitHub repository for its latest stable release on demand, compares
  versions without proposing a downgrade, and links to the official release.
  Previews are excluded. No automatic download, install, or signature claim is
  made. Requests are bounded, shared, cached for one minute, and restricted to
  the trusted main application frame.
- A bounded live outgoing Bot-message activity panel based on Hermes
  `message_agent` tool events. Started, dispatched, failed, and unavailable
  acknowledgements remain distinct from confirmed receipt; repeated events
  share one row and raw tool arguments/results are not retained in the panel.
- Read-only, on-demand Bot access previews before creating a group and from
  an existing group's header, including mobile. Enabled skills, tools, and MCP
  integrations are reported separately for each member; unavailable or timed-out
  configurations are never presented as an absence of access.
- An on-demand model search dialog in the chat header with device-local
  favorites and the eight most recent successful model selections. The list
  only includes models advertised by the current Hermes Bot configuration.
  Model switching retains role, running-state, and expensive-model safeguards.
- Hermes Bot-to-Bot deliveries in the canonical `Bot Chat` are now normalized
  into structured sender and recipient attribution and rendered as a distinct
  delivery event instead of appearing to come from the human user. Current and
  legacy Hermes 0.21 delivery prefixes remain supported.

### Fixed

- OAuth WebSocket ticket requests now have a fifteen-second deadline covering
  headers and body, a bounded response size and no redirects. Closing or
  replacing a gateway cancels ticket acquisition and prevents late sockets.
  Ticket HTTP 401/403 responses show authentication required in the sidebar;
  network failures remain unavailable. WebSocket opening has a separate
  fifteen-second deadline. Reconnection obtains a fresh ticket.
  Initial health and authentication HTTP checks also allow fifteen seconds;
  the initial gateway probe no longer cuts these stages short at eight seconds.
  Isolated HTTP/WebSocket tests cover rejection recovery and redirect refusal.
- A target socket closing after relay submission now keeps the delivery outcome
  uncertain, including after returning an error to the source or retrying that
  error reply. It is never mislabeled as a confirmed failure or forwarded again.
  Real-Bridge WebSocket fault tests cover reconnecting reply delivery, journal
  deduplication across restart, persistent pause and healthy-gateway isolation.
- Gateway status buttons now expose a subtle hover and keyboard-focus state,
  matching Settings while retaining 44px touch targets.
- Settings now use one additive gateway-management flow instead of displaying
  the legacy local/remote replacement picker beside it. Every saved connection
  can be reauthenticated without editing its address. A local-reconnect action
  preserves remote OAuth sessions and does not grant Bot relay automatically.
- Late or misrouted live thread events no longer replace the selected
  conversation after switching Bots or threads.
- Late history, send, retry, and attachment-read responses no longer replace a
  different conversation. Failed sends preserve subsequent draft edits.
- Canceled OAuth attempts no longer reopen sign-in or complete a newer attempt.
  A gateway change already saved by the Bridge still refreshes the workspace
  if its settings panel has been closed.
- MCP connection tests and saves stay associated with their original Bot;
  switching Bots or leaving settings cannot display a stale configuration.
- Rejected Bot prompts release the running state and notify live subscribers.
  Concurrent submissions share session hydration and cannot submit twice.
- Stopping a group invalidates queued turns before waiting for Hermes, so
  delayed session creation or interruption cannot start the next Bot.

- First-run recovery pauses during remote gateway configuration, ignores stale
  local health responses, and only completes after authentication, compatibility,
  and workspace loading succeed. Failed loading remains retryable.
- The welcome screen now links to a step-by-step Hermes setup guide and keeps
  keyboard focus inside the dialog. Loopback detection includes IPv6 and rejects
  remote hostnames beginning with `127.`.
- An unavailable local Hermes runtime now produces a dedicated, actionable
  message with the expected loopback address, automatic-session guidance, and
  an accessible retry action. Remote gateway failures retain their separate
  diagnostics flow.
- A fresh installation no longer drops users into a broken workspace when the
  local Hermes service is stopped. ByBots keeps the connection onboarding open,
  explains that no reconfiguration is needed, and resumes automatically after
  Hermes becomes available. Returning users retain the compact in-app warning.

## [0.3.1-alpha.1] - 2026-09-04

### Continuity and interaction quality

#### Added

- One local draft per Bot thread and group conversation, bounded to 100,000
  characters per draft and 1,000,000 characters across the local draft store.
- Portable text-file attachments in Bot and group composers. A message accepts
  up to five supported text files, 256 KiB each and 512 KiB in total, and sends
  their content rather than a machine-local path.
- A configurable display name used in the account row and for `@user` mentions
  inside group conversations.
- Opt-in desktop completion notifications when a Bot or group finishes while
  ByBots is in the background.
- Safe **Open** actions for generated `http` and `https` results. Local paths
  remain copy-only.

#### Changed

- Bot configuration reports which sections changed, disables no-op saves, and
  asks before discarding unsaved edits or closing the application.
- Manual routine runs require confirmation of the selected Bot's current
  access, and the schedule editor shows the local time zone.
- Usage explains when the independently reported total and per-model token
  figures do not reconcile.
- Settings and Bot configuration load on demand; Markdown rendering is isolated
  in a cacheable production chunk. Long threads initially mount their newest 80
  messages and reveal older history in bounded batches without losing scroll
  position.

#### Performance

- The production entry JavaScript decreased from 521,536 bytes before vendor
  chunking to 355,544 bytes. The entry plus Markdown graph is 521,563 bytes;
  total JavaScript is 565,035 bytes and CSS is 83,561 bytes, all covered by
  explicit build budgets documented in `docs/PERFORMANCE.md`.

#### Compatibility

- Binary and multimodal uploads remain unavailable until Hermes publishes a
  verified upload contract. The text-attachment transport works with local and
  remote gateways because it does not expose local filesystem paths.

### Changed

- The public repository now uses English consistently across its README,
  documentation index, installation, user, self-hosting, troubleshooting, and
  publication guides. The redundant language-specific README was removed and
  documentation checks now reject French prose.
- Public screenshots now use polished English desktop and mobile journeys with
  sanitized demonstration data, proper Hermes Blobatar avatars, generated-result
  cards, a multi-Bot launch workflow, and the mobile conversation layout without
  its hidden sidebar.
- macOS now has a native hidden-inset title bar, draggable application chrome,
  system typography, and the same external-browser OAuth completion tracking as
  Windows.
- Bot configuration now follows a mission-oriented four-step workspace for
  identity, model, authorized access, and instructions. Capabilities can be
  searched, filtered, and changed in batches, while the fixed header and footer
  keep long Hermes profiles usable on desktop and mobile.
- Cost estimates are temporarily hidden from the interface. A dedicated Usage
  settings section now shows token, session, call, cache, reasoning, and
  per-model consumption without presenting unverified billing data. Per-model
  shares are represented by percentages and accessible colored progress bars.
- Opened the `0.3.0` development cycle as `0.3.0-alpha.1`.
- MCP servers are now connection-tested before they can be assigned to a Bot;
  the Bridge returns only bounded tool names and counts to the interface.
- Catalog-only MCP servers can no longer appear ready before they are installed
  in Hermes.
- Opened the `0.2.0` development cycle as `0.2.0-alpha.1`; pre-release builds
  remain explicitly separate from signed official releases.
- Renamed the user-facing application from Byfinity Bots to ByBots while preserving stable technical identifiers and upgrade data paths.

### Fixed

- Bot configuration loading failures now provide an in-place retry, and both
  configuration levels support complete arrow-key tab navigation.
- The Windows app now uses compact ByBots window controls instead of the native
  caption buttons. Its top bars drag the frameless window without selecting
  interface text, while interactive controls remain clickable.
- Electron now adopts the session token served by an unauthenticated loopback
  Hermes instance before opening its WebSocket, matching Hermes Desktop without
  asking the local user for a token. Native OAuth navigation is forwarded to
  the system browser instead of being silently blocked by the desktop shell;
  the Electron interface then follows completion without leaving its window.
- The packaged Electron application now loads Node dependencies natively instead of bundling incompatible dynamic CommonJS imports into its ESM main process.

### Added

- A publication-ready documentation hub with separate installation, user,
  self-hosting, troubleshooting, and release-readiness guides, plus an English
  project overview and automated checks for broken internal links or tracked
  infrastructure runbooks.
- Universal Intel and Apple Silicon macOS packaging as DMG and ZIP, including a
  generated 1024 px icon, hardened-runtime entitlements, automated bundle and
  architecture qualification, packaged-app smoke tests, Developer ID signing,
  notarization gates, checksums, and release provenance.
- Automated Windows artifact qualification for installer and portable builds,
  including an isolated packaged-app launch, embedded Bridge health, metadata,
  Authenticode, PE-header, and SHA-256 verification. Tagged releases now reject
  unsigned artifacts, and the clean-machine install, upgrade, and rollback
  checklist is documented.
- Remote Hermes gateways now mirror Hermes Desktop connection setup: ByBots
  detects the advertised authentication mode and provider label, opens the
  native OAuth PKCE flow without asking for a provider identifier, and keeps
  the manual token form for session-token gateways. WebSockets use single-use
  tickets after OAuth sign-in.
- Remote OAuth sessions now persist their expiry, rotate access and refresh
  tokens before expiration, retry temporary provider outages, and ask for a
  fresh sign-in when Hermes rejects an expired refresh token.
- Open-source contribution guidelines, issue templates, pull request checks, and automated CI.
- An optional read-only compatibility check for the Hermes 0.21 REST and JSON-RPC contracts.
- Administrator-only Bot profile import and export through bounded Hermes archives.
- Explicit release criteria separating implemented work from platform
  qualification.
- Administrator-only local or remote Hermes gateway selection with connection testing and safe runtime switching.
- Browser smoke journeys for first-run connection, the core Bot lifecycle, profile transfer, accessibility, and long histories.
- Enforced bundle budgets plus automated English/French coverage and resilient loading and connection states.
- A non-root production container that starts only ByBots and reuses an existing loopback Hermes runtime.
- A bounded shared exchange directory for profile transfers across separate ByBots and Hermes containers.
- The MIT license for source use, modification, and redistribution.
- A sanitized architecture, trust-boundary overview, and explicit Hermes and operating-system support policy.
- Reproducible public desktop and mobile screenshots backed by sanitized example data.
- Complete keyboard navigation and focus management for thread/avatar tabs, group mentions, composers, and modal dialogs.
- Explicit, recoverable loading, empty, offline, access, compatibility, conversation, group, and usage states across the primary interface.
- On-demand diagnostics export with a complete pre-download preview and a strict privacy-safe field allowlist.
- A frozen public Bridge API v1 contract, response version discovery, and published migration guarantees.

### Security

- Tokenless local Bridge requests now reject untrusted Host and browser Origin values, closing the DNS-rebinding path to implicit administrator access.
- Hermes WebSocket connections now bound connection time, request lifetime, pending request count, malformed frames, and unexpected disconnect cleanup.
- Gateway subscribers and asynchronous group completion failures are isolated so one bad event cannot terminate or indefinitely block the Bridge.
- Live SSE streams now enforce global and per-principal quotas, a maximum lifetime, and slow-consumer backpressure cleanup.

## [0.1.0] - 2026-09-03

### Added

- Dynamic Hermes Bot profiles with title, description, appearance, model, SOUL, skills, toolsets, and MCP configuration.
- Native per-Bot conversation threads with in-chat tabs and last-used thread restoration.
- Live Hermes response streaming with polling fallback and actionable retry states.
- Group discussions, persistent routines, usage analytics, multi-machine inventory, roles, settings, and English/French localization.
- Shared responsive React interface for the Web and Electron applications.

### Fixed

- Bodyless requests no longer declare a JSON content type.
- Chats open at the latest message without forcing users back down while they read older content.

[Unreleased]: https://github.com/Mazzana/bybots/compare/v0.3.1-alpha.1...HEAD
[0.3.1-alpha.1]: https://github.com/Mazzana/bybots/releases/tag/v0.3.1-alpha.1
[0.1.0]: https://github.com/Mazzana/bybots/releases/tag/v0.1.0
