import { z } from "zod";
import type { HermesGateway } from "./hermes-gateway";

export interface RelayConnection { id: string; label: string; gateway: HermesGateway }
export interface RelayActivity { id: string; source: string; target: string; profile: string; status: "delivering" | "replied" | "failed" | "reply-pending"; at: number }
const envelopeSchema = z.object({ id: z.string().regex(/^[a-f0-9]{32}$/), target_connection: z.string().max(64), target_profile: z.string().min(1).max(128), message: z.string().min(1).max(16_200) });
const profilesSchema = z.object({ profiles: z.array(z.object({ name: z.string().min(1).max(128), handle: z.string().max(128).optional(), display_name: z.string().optional(), description: z.string().optional(), ui_meta: z.record(z.string(), z.unknown()).optional() })).max(1000) });
// Mirrors Hermes: 120s lock wait + two 600s attempts + 180s settlement margin.
export const RELAY_DELIVER_TIMEOUT_MS = 1_500_000;

/** Native Hermes message_agent transport. Delivery is never retried by ByBots. */
export class BotRelay {
  readonly activity: RelayActivity[] = [];
  readonly status = new Map<string, "ready" | "unavailable">();
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private closed = false;
  private lastSync = 0;
  private readonly subscriptions = new Map<HermesGateway, () => void>();
  private readonly rosters = new Map<string, Array<Record<string, unknown>>>();
  private readonly seen = new Set<string>();
  private readonly pending = new Map<string, { sender: RelayConnection; payload: Record<string, unknown>; at: number; activity: RelayActivity }>();
  private readonly deliveries = new Set<Promise<void>>();
  constructor(private readonly connections: () => RelayConnection[]) {}

  start() {
    this.timer = setInterval(() => { void this.tick(); }, 4_000);
    this.timer.unref();
    void this.tick(true);
  }

  async tick(forceSync = false) {
    if (this.closed || this.busy) return;
    this.busy = true;
    try {
      const connections = this.connections();
      const sockets = new Set(connections.map((row) => row.gateway));
      for (const [socket, unsubscribe] of this.subscriptions) if (!sockets.has(socket)) {
        unsubscribe(); this.subscriptions.delete(socket);
      }
      for (const row of connections) if (!this.subscriptions.has(row.gateway)) {
        this.subscriptions.set(row.gateway, row.gateway.subscribe((event) => {
          if (event.type === "bot_relay.outbox.pending") void this.tick();
        }));
      }
      if (forceSync || Date.now() - this.lastSync > 60_000) {
        this.lastSync = Date.now();
        await Promise.all(connections.map(async (row) => {
          try {
            const { profiles } = profilesSchema.parse(await row.gateway.request("profiles.list", { include_sessions: false }));
            if (!this.current(row)) return;
            this.rosters.set(row.id, profiles.map((profile) => ({
              connection_id: row.id, connection_label: row.label, profile: profile.name,
              handle: profile.handle || (profile.name === "default" ? "hermes" : profile.name),
              title: profile.display_name || profile.name, description: (profile.description || "").slice(0, 500)
            })));
          } catch { this.status.set(row.id, "unavailable"); }
        }));
        await Promise.all(connections.map(async (row) => {
          try {
            if (!this.current(row)) return;
            await row.gateway.request("bot_relay.roster.sync", { agents: this.connections().filter((other) => other.id !== row.id).flatMap((other) => this.rosters.get(other.id) || []) });
            this.status.set(row.id, "ready");
          } catch { this.status.set(row.id, "unavailable"); }
        }));
      }
      await Promise.all([...this.pending].map(async ([key, pending]) => {
        if (Date.now() - pending.at > 10 * 60_000 || !this.current(pending.sender)) {
          this.pending.delete(key); pending.activity.status = "failed"; return;
        }
        await this.postReply(key, pending);
      }));
      await Promise.all(connections.map(async (sender) => {
        if (!this.current(sender) || this.deliveries.size >= 16 || this.pending.size >= 128) return;
        try {
          const response = await sender.gateway.request<{ envelopes?: unknown[] }>("bot_relay.outbox.drain");
          if (!Array.isArray(response?.envelopes)) return;
          for (const raw of response.envelopes) {
            const result = envelopeSchema.safeParse(raw);
            if (!result.success) continue;
            const envelope = result.data;
            const key = `${sender.id}:${envelope.id}`;
            if (this.seen.has(key)) continue;
            this.seen.add(key);
            if (this.seen.size > 4096) this.seen.delete(this.seen.values().next().value!);
            const delivery = this.deliver(sender, envelope, key).finally(() => this.deliveries.delete(delivery));
            this.deliveries.add(delivery);
            // Once saturated, settle the refusal before reading more claimed envelopes.
            if (this.deliveries.size > 16) await delivery;
          }
        } catch { this.status.set(sender.id, "unavailable"); }
      }));
    } finally { this.busy = false; }
  }

  private current(connection: RelayConnection) {
    return !this.closed && this.connections().some((row) => row.id === connection.id && row.gateway === connection.gateway);
  }

  private async deliver(sender: RelayConnection, envelope: z.infer<typeof envelopeSchema>, key: string) {
    const activity: RelayActivity = { id: envelope.id, source: sender.id, target: envelope.target_connection, profile: envelope.target_profile, status: "delivering", at: Date.now() };
    this.activity.unshift(activity); this.activity.splice(50);
    const target = this.connections().find((row) => row.id === envelope.target_connection && row.id !== sender.id);
    let payload: Record<string, unknown>;
    try {
      if (!this.current(sender) || !target) throw new Error("Target gateway is disconnected or Bot relay is disabled.");
      if (this.deliveries.size >= 16) throw new Error("Bot relay is busy. Message was not delivered.");
      if (!this.rosters.get(target.id)?.some((row) => row.profile === envelope.target_profile)) throw new Error("Target Bot is not in the shared gateway roster.");
      const response = await target.gateway.request<{ reply?: unknown }>("bot_relay.deliver", { profile: envelope.target_profile, message: envelope.message }, RELAY_DELIVER_TIMEOUT_MS);
      if (typeof response?.reply !== "string") throw new Error("Invalid relay response. Delivery outcome is unknown; do not resend blindly.");
      payload = { id: envelope.id, reply: response.reply };
    } catch (cause) {
      // Forward structured reasons, not arbitrary gateway errors which can contain credentials.
      const reason = (cause as { data?: { reason?: unknown } })?.data?.reason;
      payload = { id: envelope.id, error: "ByBots could not confirm delivery. Check both gateways before resending.", ...(typeof reason === "string" && /^[a-z_]{1,64}$/.test(reason) ? { reason } : {}) };
      activity.status = "failed";
    }
    if (!this.current(sender)) { activity.status = "failed"; return; }
    if (this.pending.size >= 128) { activity.status = "failed"; return; }
    const pending = { sender, payload, at: Date.now(), activity };
    this.pending.set(key, pending);
    await this.postReply(key, pending);
  }

  private async postReply(key: string, pending: { sender: RelayConnection; payload: Record<string, unknown>; activity: RelayActivity }) {
    try {
      await pending.sender.gateway.request("bot_relay.reply", pending.payload);
      pending.activity.status = pending.payload.error ? "failed" : "replied";
      this.pending.delete(key);
    } catch { pending.activity.status = "reply-pending"; }
  }

  async settle() { await Promise.all([...this.deliveries]); }
  async revoke(connection: RelayConnection) {
    this.rosters.delete(connection.id); this.status.delete(connection.id); this.lastSync = 0;
    try { await connection.gateway.request("bot_relay.roster.sync", { agents: [] }); } catch { /* Offline roster cleared on a later consented connection. */ }
    await this.tick(true);
  }
  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear(); this.pending.clear();
  }
}
