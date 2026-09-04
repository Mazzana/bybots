# Multiple Hermes gateways (unreleased preview)

ByBots can keep its existing primary gateway and up to eight additional local
or remote Hermes connections. All their Bots appear in one list, with a gateway
label. Credentials, profile names, conversations and groups remain separate.
This is development-branch functionality, not a new published release.

## Connect another gateway

Settings use an additive connection list, not the first-launch local/remote
replacement selector. If your remote gateway was connected through the older
selector, **Connect local Hermes too** restores the local connection alongside
it without signing out the remote session. Relay remains a separate opt-in.

1. Open **Settings → Hermes → Multiple gateways** as an administrator.
2. Enter a recognizable name and the gateway URL, then **Add and configure**.
3. Use Hermes native OAuth when offered, or enter that gateway's session token.
   Health and authenticated profile access are checked before credentials are
   saved. Tokens are kept in the Bridge, not returned to the browser. OAuth
   refresh remains independent for each gateway.
4. Select a Bot from the common sidebar. Two profiles named `writer` are still
   different Bots. **Create a Bot → Gateway** chooses where a new Bot lives.

Adding a connection alone does **not** permit Bot-to-Bot relay. Removing one
forgets its saved session in ByBots, but never deletes Bots or conversations on
Hermes. Its local drafts are not deleted either. Re-adding the same URL creates
a new connection ID; it does not automatically restore the former ID's drafts.
Once using multiple gateways, add a new connection instead of editing a gateway
address to avoid accidentally routing existing history to another server.

## Allow Bots to communicate

Enable **Allow Bot relay** on at least two gateways you trust. Each enabled
gateway receives the other enabled gateways' Bot roster. A Bot running in
Hermes' canonical **Bot Chat**, with native Bot Mode / `message_agent` available,
can address a Bot on another gateway. For example:

> Ask writer@gw-012345abcdef to review this plan and summarize its reply.

Replace the example ID with the actual relay address shown in Settings.
Use `handle@connection-id` when handles are ambiguous. The model must actually
call `message_agent`: an ordinary textual mention is not a delivery. If your
Bot has only regular threads, create a thread titled exactly **Bot Chat** and
ensure Bot Mode is enabled on that Hermes installation. ByBots does not silently
enable server-side capabilities, grant tools, or convert ordinary threads.

The protocol follows Hermes Desktop's native
[relay implementation](https://github.com/NousResearch/hermes-agent/blob/b0ab2e163a50d4e6c36507eba955a6067fde6abc/apps/desktop/src/plugins/hermes-bots/relay.ts)
and [gateway handlers](https://github.com/NousResearch/hermes-agent/blob/b0ab2e163a50d4e6c36507eba955a6067fde6abc/tui_gateway/methods_bot_relay.py):

| RPC | Purpose |
| --- | --- |
| `bot_relay.roster.sync` | Publish the other enabled gateways' Bots |
| `bot_relay.outbox.drain` | Claim queued outgoing envelopes on the sender |
| `bot_relay.deliver` | Deliver to the target Bot on its own gateway |
| `bot_relay.reply` | Return the result or typed failure to the sender |

ByBots keeps the sockets open, reacts to pending-outbox events and polls every
four seconds as a fallback. Rosters refresh at most every minute and after
configuration changes. A gateway without these RPCs is marked unavailable for
relay; normal conversation access is independent.

## Trust and availability

- Relay consent shares **all Bots on the selected gateway**, not a per-Bot
  allowlist. Bot identities, descriptions, messages and replies cross this
  boundary. Only connect gateways whose owners and Bots you trust.
- Target Bots keep their existing tools, files and integrations. Relay does not
  impose a new sandbox, spending limit or approval policy on their actions.
- Keep the ByBots desktop application or Web Bridge running. Closing only a Web
  browser tab does not stop a still-running Bridge's relay.
- Do not run Hermes Desktop or another ByBots relay against the same gateways
  simultaneously. Hermes' install-wide roster/outbox is shared between clients;
  this preview does not coordinate multiple relay owners.
- Disabling relay stops new forwards. It cannot recall a turn already accepted
  by another gateway. An offline gateway may retain its stale roster until it
  is reachable again; ByBots never forwards from a disabled connection.
- A **Gateway responded** status can mean a Bot Chat queue acknowledgement,
  not that the target Bot has completed its answer. Check the actual Bot Chat.
- Delivery has a 25-minute client budget matching the upstream lock/retry
  ceiling plus margin. ByBots never retries the target turn automatically;
  only returning a known reply is retried for up to ten minutes in memory.
  Hermes can apply its own retry policy inside a turn.
- Activity is bounded to 50 metadata rows, and delivery deduplication is bounded
  in memory. In-flight work/replies are not recovered durably after a Bridge
  crash. Do not blindly resend an uncertain delivery. A concurrency limit of
  16 bounds active forwards; it is not a cross-Bot loop or token-spend budget.
- Group rooms currently require all members to use **one gateway**. Native
  Bot Chat relay works across gateways; mixed-gateway group orchestration does
  not ship in this preview. Avatar-pet catalogs and archive imports still use
  the primary gateway.

## Verification and remaining qualification

Automated tests exercise the real Bridge with two authenticated WebSocket
protocol fixtures, routing collisions, stream identity, persistence across
restart, relay consent, failure replies and administrator-only management.
Browser checks cover adding and connecting another gateway, enabling relay,
and mobile containment. Fixtures do not call a language model.

Before release, qualify the full exchange against two real Hermes installations
with Bot Mode enabled, plus native OAuth reconnection on both desktop platforms.
No live provider, remote credential or production Bot was modified to run the
fixture tests.
