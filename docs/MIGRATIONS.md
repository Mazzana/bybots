# Migration guarantees

These guarantees define how ByBots evolves persisted settings, Bot
metadata, and profile transfers. They apply to the stable `1.x` line; every
`0.x` change must already follow the same rules where the current data model
supports them.

## General rules

- Upgrades are forward-only and must not silently delete user-owned data.
- Additive fields receive safe defaults. Unknown fields are ignored when read
  and preserved when Byfinity owns and rewrites the surrounding record.
- A required destructive or ambiguous conversion must stop with actionable
  recovery guidance. It must never guess, truncate, or overwrite the source.
- Every schema change requires a fixture for the previous supported schema, an
  idempotent migration test, a current-version round trip, and a downgrade or
  documented rollback test.
- Release notes identify migrations, backup requirements, and the oldest
  directly supported source version.

## Interface settings

The product rename from **Byfinity Bots** to **ByBots** deliberately keeps the
technical package name `byfinity-bots`, Windows application ID
`com.byfinity.bots`, Hermes thread source markers, and the existing user-data
directory. This prevents the rename from creating a second installation
identity or losing saved connections and conversation references.

Browser preferences remain under `byfinity.preferences`; language and last-used
threads retain their existing origin-scoped keys. Missing, malformed, or older
preference fields fall back independently to documented defaults. Adding a
setting must not reset valid existing settings.

Conversation drafts use the additive `byfinity.drafts.v1` key. Each entry is
addressed by Bot thread or group identifier, malformed entries are ignored, and
the reader never migrates draft text into Hermes. The writer limits individual
drafts, entry count, and the total saved character count. Removing the local
browser or Electron profile removes these drafts without changing Hermes
messages.

Thread identifiers are references to Hermes sessions, not copies of messages.
If a saved identifier no longer exists, the interface recovers through normal
thread discovery instead of modifying Hermes history.

## Saved Hermes connection

`connection.json` is an application-owned, versioned record. Schema version `1`
contains the normalized Hermes base URL and session token. Schema version `2`
adds the authentication mode and optional OAuth refresh, provider, and expiry fields. This
release reads versions `1` and `2`, then writes version `2`. An unknown version
is rejected without rewriting it.

Connection writes use a private temporary file and atomic replacement. Resetting
the connection removes only this application-owned record and returns to the
environment-provided gateway; it does not alter Hermes.

## Bot and group metadata

Hermes remains the source of truth. Byfinity-owned Bot presentation metadata is
stored below `ui_meta["hermes-bots"]`; group projection data is stored below
`ui_meta["hermes-bots-groups"]`, currently schema version `3`.

Updates preserve unrelated Hermes `ui_meta` keys and unknown fields inside the
Byfinity Bot metadata object. Group migrations normalize older or missing
snapshots into the current shape and preserve room records that remain valid.
Compare-and-set revisions are used when Hermes exposes them.

ByBots never treats profile names as tenant boundaries. Submitted conversation
bodies remain in Hermes; unfinished drafts are intentionally local private
content in the separate bounded draft store rather than profile metadata.

## Profile archives

Profile archives are opaque Hermes artifacts. ByBots guarantees bounded
binary transport, an exact dedicated exchange path, regular-file and gzip
checks, and temporary-file cleanup. Archive contents and migrations are governed
by the supported Hermes contract, not by the Bridge.

An application release may claim archive portability only between Hermes
versions listed in `HERMES-COMPATIBILITY.md`. Imports never replace an existing
profile unless Hermes explicitly implements and documents that behavior.

## Rollback boundary

The multi-gateway preview also owns `<connection-file>.gateways.json` and
`<connection-file>.relay.json`. Back up both alongside the per-gateway session
records. The registry adds optional main-gateway and relay-pause fields while
reading older registries without them. Older preview builds use strict schemas
and may reject these newer fields: rollback requires the matching pre-upgrade
registry backup. Keep relay disabled on an older build that cannot honor the
new intent journal, and retain that journal for the next forward upgrade.
The journal contains no prompts or replies; it is not a conversation backup.

Before an official upgrade, operators retain the previous signed installer and
back up the application connection record plus Hermes-owned data using the
Hermes procedure. Rolling back the application must not require rolling back
Hermes unless the release notes explicitly say otherwise.

The rollback guarantee is not considered demonstrated until an official signed
release has been installed, upgraded, rolled back, and re-opened against a copy
of representative Hermes data on a clean supported Windows machine. That
release qualification remains a separate release gate.
