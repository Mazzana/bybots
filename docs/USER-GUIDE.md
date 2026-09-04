# User guide

## First launch

ByBots supports two connection modes:

- **Local Hermes** for a gateway running on the same computer;
- **Remote Hermes** for a trusted HTTPS URL or private network endpoint.

For a remote gateway, ByBots detects the advertised authentication mode. When
Hermes offers OAuth, **Sign in** opens its native PKCE flow in the default
browser. Otherwise, an administrator can enter the session token supplied by
the gateway owner. ByBots verifies health and profile access before saving the
new connection.

## Bots and conversations

The sidebar lists Bots supplied by Hermes. Select a Bot to reopen its last used
thread.

- **New thread** starts a separate conversation for the current Bot.
- Thread tabs reopen earlier conversations.
- Long threads open on the newest 80 messages. Use **Show older messages** to
  reveal earlier history in additional batches without losing the current
  reading position.
- Each Bot thread and group keeps its own local draft. Switching conversations
  or restarting ByBots restores unfinished text without sending it to Hermes.
- The composer grows with the message. `Enter` sends and `Shift + Enter` adds a
  line when send-on-enter is enabled.
- **Attach text files** adds up to five text, Markdown, CSV, JSON, YAML, XML,
  source-code, SQL, or log files. Each file is limited to 256 KiB and the
  combined encoded payload to 512 KiB. ByBots sends the content inline, so a
  remote gateway never receives a path from the local computer.
- A running answer can be stopped from the visible conversation control.
- Failures offer a relevant recovery action: retry, wait, reconnect, or open settings.

Messages and threads remain stored in Hermes rather than a second ByBots
database. Drafts stay only in the current browser or Electron profile and can
contain sensitive text; they are not synchronized between devices.

## Configure a Bot

### Find a model quickly

Use **Find a model** (the search icon in a Bot conversation header) to search
the models advertised by Hermes. Search matches model and provider names.
**Add favorite** keeps a model in the favorites section; **Use model** applies
the selection. The list also groups the eight most recent successful choices.
On mobile, this compact shortcut remains available without showing the full
desktop toolbar. The normal desktop selector still supports inheriting the
main profile's model.

Favorites (up to 24) and recent model identifiers stay in the current browser
or Electron profile, not in Hermes, and do not contain credentials. Unavailable
models are hidden even if previously favorited. Model changes require an
administrator and are disabled during a running answer. Hermes confirmation
and rejection rules continue to apply.

### Profile configuration

An administrator can create or edit a Bot from its configuration workspace:

1. **Identity** — name, mission, and appearance.
2. **Model** — the default Hermes model.
3. **Authorized access** — skills, tools, and MCP servers already available in Hermes.
4. **Instructions** — mission guidance and `SOUL.md` content.

Grant only the capabilities required by the Bot's mission. ByBots can discover
and test an MCP server, while installation and authentication remain managed in
Hermes. The save action remains disabled until something changes. Closing an
edited configuration asks for confirmation and the footer reports how many
configuration sections differ from the saved profile.

## Groups

A group coordinates several Bots inside a bounded discussion. `@BotName`
mentions target a member, and user mentions display the configured user label.
Turns are serialized, and each member can pass silently.

Choose **Review Bot access** after selecting members in the creation dialog,
or use the shield button in an existing group's header (also on mobile). The
read-only preview loads enabled skills, tools, and MCP integrations for each
Bot only when opened. **Refresh access** reloads the snapshot after a Hermes
configuration change. A member that fails to respond within 15 seconds is
marked unavailable without hiding the other members' results.

This is declared configuration, not a check of effective file permissions or
credentials. **None reported by Hermes** does not certify that a Bot has no
access; an unavailable configuration must never be interpreted that way either.

Treat every Bot in a group as part of the same trust domain. Do not mix a Bot
with highly sensitive data access and a Bot with powerful mutation tools unless
that combined access is intentional.

## Routines

Routines mirror native Hermes cron schedules. Depending on their role, users can
view run history, start an existing routine, or, for administrators, create,
edit, pause, and delete schedules.

Always review the selected Bot, authorized tools, prompt, and frequency before
enabling an autonomous routine. ByBots shows schedules in the device's local
time zone and asks for confirmation before an immediate manual run.

## Usage

**Settings → Usage** reports tokens, sessions, calls, cache reads, reasoning,
and each model's share of total usage. Per-Bot costs remain hidden until Hermes
exposes a stable and verified billing contract. Hermes may report overall and
per-model token counters independently; ByBots labels the breakdown when those
figures do not reconcile rather than silently presenting them as identical.

## Generated results

Hermes `MEDIA:` output appears as a generated-result card. A result using an
`http` or `https` URL can be opened in a separate browser tab. A local path is
never opened automatically and remains available only through **Copy path**.
Review every external destination before opening or sharing it.

## Personal preferences and notifications

**Settings → General** controls language, density, and the display name used in
the account row and group mentions. **Settings → Chat** controls send-on-enter
and completion notifications.

Notifications are disabled by default. Enabling them requests the operating
system or browser permission in response to that action. ByBots sends a local
notification only when an active Bot or group changes from running to complete
while the application is in the background. A denied permission must be changed
in the operating-system or browser settings.

## Data and diagnostics

In **Settings → Data**, an administrator can import or export a Hermes profile
archive. An archive may contain conversations, persona instructions, skills,
and other private context. Store it as sensitive data.

**Sanitized diagnostics** shows the complete report before download. It excludes
credentials, gateway URLs, Bot names, conversations, and user files. Prefer this
report to raw logs when requesting support.

## Roles

| Role | Main permissions |
| --- | --- |
| `viewer` | Read data without mutations |
| `operator` | Chat, stop a group, and run an existing routine |
| `admin` | Manage Bots, groups, capabilities, schedules, gateways, and archives |

The Bridge enforces permissions on the server. Hiding a button in the interface
is never the only authorization control.

## Mobile and accessibility

On mobile, ByBots behaves like a messaging application: navigation is hidden
inside a conversation and restored with the back control. Interactive elements
support keyboard access, visible focus, screen-reader labels, and reduced
motion. Language and display density are available in **Settings**.
