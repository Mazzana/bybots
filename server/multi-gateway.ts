import { randomBytes } from "node:crypto";
import type { ChatService, GroupService, HermesService } from "./app";
import { BotRelay, type RelayConnection } from "./bot-relay";
import { FileHermesConnectionStore, HermesConnectionManager, normalizeHermesUrl, type HermesConnectionInput, type HermesConnectionService } from "./hermes-connection";
import { resolveLocalHermesSessionToken } from "./hermes-local-token";
import type { GatewayRegistry, RegistryStore } from "./gateway-registry";
import type { BotSummary } from "./hermes-client";
import type { GroupRoom } from "./group-chat-service";
import type { RelayJournalStore } from "./relay-journal";

interface Entry { id: string; label: string; manager: HermesConnectionManager; relay: boolean }
export interface GatewayView { id: string; label: string; isDefault: boolean; baseUrl: string; hasToken: boolean; authMode: string; requiresReauthentication?: boolean; relay: boolean; relayStatus: "disabled" | "checking" | "ready" | "unavailable" }
const scoped = (id: string, value: string) => id === "primary" ? value : `${id}::${value}`;

export class MultiGateway implements HermesConnectionService {
  readonly hermes: HermesService;
  readonly chat: ChatService;
  readonly groups: GroupService;
  readonly relay: BotRelay;
  private entries = new Map<string, Entry>();
  private registry: GatewayRegistry = { version: 1, primaryRelay: false, gateways: [] };
  private mutation: Promise<unknown> = Promise.resolve();
  private oauthOwners = new Map<string, { id: string; baseUrl: string; at: number }>();
  private health?: { at: number; rows: Array<{ id: string; label: string; isDefault: boolean; status: "connected" | "unavailable" | "auth-required" }> };
  private healthRequest?: Promise<NonNullable<MultiGateway["health"]>["rows"]>;

  connectionStatuses() {
    if (this.health && Date.now() - this.health.at < 10_000) return Promise.resolve(this.health.rows);
    if (this.healthRequest) return this.healthRequest;
    this.healthRequest = Promise.all([...this.entries.values()].map(async (entry) => {
      const connection = await entry.manager.getConnection();
      let status: "connected" | "unavailable" | "auth-required" = "auth-required";
      if (connection.hasToken && !connection.requiresReauthentication) {
        try {
          if (entry.manager.relayGateway) await entry.manager.relayGateway.request("profiles.list", { include_sessions: false }, 5_000);
          else await entry.manager.hermes.listBots();
          status = "connected";
        } catch { status = "unavailable"; }
      }
      return { id: entry.id, label: entry.label, isDefault: entry.id === this.defaultGatewayId, status };
    })).then((rows) => { this.health = { at: Date.now(), rows }; return rows; }).finally(() => { this.healthRequest = undefined; });
    return this.healthRequest;
  }

  constructor(readonly primary: HermesConnectionManager, private readonly store: RegistryStore, private readonly connectionPath: string,
    private readonly factory = (id: string, baseUrl: string) => new HermesConnectionManager({ defaultConnection: { baseUrl, token: "" }, store: new FileHermesConnectionStore(`${connectionPath}.${id}.json`), resolveLocalToken: resolveLocalHermesSessionToken }), journal?: RelayJournalStore) {
    this.entries.set("primary", { id: "primary", label: "Hermes", manager: primary, relay: false });
    this.relay = new BotRelay(() => this.relayConnections(), journal);
    this.hermes = new Proxy(primary.hermes, { get: (_target, method: string) => {
      if (method === "listBots") return () => this.listBots();
      if (method === "listMachines") return async () => (await this.partial(async (entry) => (await entry.manager.hermes.listMachines?.() || []).map((machine) => ({ ...machine, id: scoped(entry.id, machine.id), name: `${entry.label} · ${machine.name}` })))).flat();
      if (["listAvatarPets", "getAvatarPetSprite"].includes(method)) return Reflect.get(primary.hermes, method);
      if (method === "importBot") return async (data: Uint8Array, name?: string, gatewayId = this.defaultGatewayId) => {
        const entry = this.entry(gatewayId);
        if (!entry.manager.hermes.importBot) throw new Error("This gateway does not support Bot imports");
        return this.bot(entry, await entry.manager.hermes.importBot(data, name));
      };
      if (method === "createBot") return async (input: { gatewayId?: string } & Record<string, unknown>) => {
        const { gatewayId = this.defaultGatewayId, ...fields } = input;
        const entry = this.entry(gatewayId);
        const bot = await entry.manager.hermes.createBot(fields as unknown as Parameters<HermesService["createBot"]>[0]);
        return this.bot(entry, bot);
      };
      if (typeof Reflect.get(primary.hermes, method) !== "function") return undefined;
      return async (name: string, ...args: unknown[]) => {
        const { entry, value } = this.resolve(name);
        const fn = Reflect.get(entry.manager.hermes, method);
        if (typeof fn !== "function") throw new Error("This gateway does not support this action");
        const result = await fn(value, ...args);
        return this.mapBotResult(entry, result);
      };
    } });
    this.chat = new Proxy(primary.chat, { get: (_target, method: string) => {
      if (typeof Reflect.get(primary.chat, method) !== "function") return undefined;
      return async (name: string, ...args: unknown[]) => {
        const { entry, value } = this.resolve(name);
        const fn = Reflect.get(entry.manager.chat, method);
        if (typeof fn !== "function") throw new Error("This gateway does not support this action");
        if (method === "watchThread") {
          const listener = args[1] as (event: unknown) => void;
          args[1] = (event: unknown) => listener(this.mapBotResult(entry, event));
        }
        return this.mapBotResult(entry, await fn(value, ...args));
      };
    } });
    this.groups = {
      listGroups: async () => (await this.partial(async (entry) => (await entry.manager.groups.listGroups() as GroupRoom[]).map((room) => this.group(entry, room)))).flat(),
      createGroup: async (name, members) => {
        const routes = members.map((member) => this.resolve(member));
        const entry = routes[0]?.entry;
        if (!entry || routes.some((route) => route.entry !== entry)) throw new Error("Group members must use the same gateway. Use Bot Chat and message_agent for cross-gateway conversations.");
        return this.group(entry, await entry.manager.groups.createGroup(name, routes.map((route) => route.value)) as GroupRoom);
      },
      sendMessage: async (id, text, thread) => {
        const { entry, value } = this.resolve(id);
        return this.group(entry, await entry.manager.groups.sendMessage(value, text, thread) as GroupRoom);
      },
      stop: async (id) => {
        const { entry, value } = this.resolve(id);
        if (!entry.manager.groups.stop) throw new Error("Stop is unavailable on this gateway");
        return this.group(entry, await entry.manager.groups.stop(value) as GroupRoom);
      }
    };
  }

  async initialize() {
    this.registry = await this.store.load();
    this.entry("primary").relay = this.registry.primaryRelay;
    for (const saved of this.registry.gateways) {
      const manager = this.factory(saved.id, normalizeHermesUrl(saved.baseUrl));
      // A broken additional session must not prevent the primary workspace from opening.
      // Its unauthenticated initial runtime remains configurable; no secret is logged.
      try { await manager.initialize(); } catch { /* Ask the user to connect this gateway again. */ }
      this.entries.set(saved.id, { ...saved, manager });
    }
    await this.relay.initialize();
    this.relay.start();
  }
  private entry(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("Unknown gateway");
    return entry;
  }
  private get defaultGatewayId() { return this.registry.defaultGatewayId || "primary"; }
  private resolve(name: string) {
    const separator = name.indexOf("::");
    return separator < 0 ? { entry: this.entry("primary"), value: name } : { entry: this.entry(name.slice(0, separator)), value: name.slice(separator + 2) };
  }
  private bot(entry: Entry, bot: BotSummary) {
    return { ...bot, name: scoped(entry.id, bot.name), displayName: bot.displayName || bot.name, gatewayId: entry.id, gatewayLabel: entry.label, gatewayDefault: entry.id === this.defaultGatewayId, profile: bot.name };
  }
  private mapBotResult(entry: Entry, value: unknown): any {
    if (Array.isArray(value)) return value.map((item) => this.mapBotResult(entry, item));
    if (!value || typeof value !== "object" || value instanceof Uint8Array) return value;
    const result = { ...value } as Record<string, unknown>;
    if (typeof result.bot === "string") result.bot = scoped(entry.id, result.bot);
    if (result.conversation) result.conversation = this.mapBotResult(entry, result.conversation);
    return result;
  }
  private group(entry: Entry, room: GroupRoom): GroupRoom {
    return { ...room, id: scoped(entry.id, room.id), name: this.entries.size > 1 ? `${room.name} · ${entry.label}` : room.name, members: room.members.map((name) => scoped(entry.id, name)),
      turn: room.turn ? scoped(entry.id, room.turn) : undefined,
      messages: room.messages.map((message) => ({ ...message, author: message.authorKind === "bot" ? scoped(entry.id, message.author) : message.author })),
      activity: room.activity?.map((item) => ({ ...item, member: item.member ? scoped(entry.id, item.member) : undefined })) };
  }
  private async partial<T>(operation: (entry: Entry) => Promise<T[]>) {
    const entries = [...this.entries.values()];
    if (entries.length === 1) return [await operation(entries[0]!)];
    const results = await Promise.allSettled(entries.map(async (entry) => (await entry.manager.getConnection()).hasToken ? operation(entry) : []));
    if (results.every((result) => result.status === "rejected")) throw new Error("All Hermes gateways are unavailable");
    return results.map((result) => result.status === "fulfilled" ? result.value : []);
  }
  private async listBots() { return (await this.partial(async (entry) => (await entry.manager.hermes.listBots()).map((bot) => this.bot(entry, bot)))).flat(); }
  private relayConnections(): RelayConnection[] {
    if (this.registry.relayPaused) return [];
    return [...this.entries.values()].flatMap((entry) => entry.relay && entry.manager.relayGateway ? [{ id: entry.id, label: entry.label, gateway: entry.manager.relayGateway }] : []);
  }
  get relaySafety() { return { paused: Boolean(this.registry.relayPaused), journalError: this.relay.journalError, journalFull: this.relay.journalFull, rateLimited: this.relay.rateLimited }; }
  setRelayPaused(paused: boolean) {
    return this.serialize(async () => {
      const previous = this.relayConnections();
      const next = { ...this.registry, relayPaused: paused };
      await this.store.save(next); this.registry = next;
      if (paused) await Promise.all(previous.map((connection) => this.relay.revoke(connection)));
      else await this.relay.tick(true);
    });
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation);
    this.mutation = result.catch(() => {});
    return result;
  }
  async listGateways(): Promise<GatewayView[]> {
    return Promise.all([...this.entries.values()].map(async (entry) => ({ ...await entry.manager.getConnection(), id: entry.id, label: entry.label, isDefault: entry.id === this.defaultGatewayId, relay: entry.relay, relayStatus: entry.relay ? this.relay.status.get(entry.id) || "checking" : "disabled" })));
  }
  setDefaultGateway(id: string) {
    return this.serialize(async () => {
      this.entry(id);
      const next = { ...this.registry, defaultGatewayId: id };
      await this.store.save(next);
      this.registry = next;
    });
  }
  addGateway(input: { label: string; baseUrl: string }) {
    return this.serialize(async () => {
      const baseUrl = normalizeHermesUrl(input.baseUrl);
      if (this.registry.gateways.length >= 8) throw new Error("Up to eight additional gateways are supported");
      if ((await this.listGateways()).some((row) => row.baseUrl === baseUrl)) throw new Error("This gateway is already configured");
      const saved = { id: `gw-${randomBytes(6).toString("hex")}`, label: input.label.trim(), baseUrl, relay: false };
      const next = { ...this.registry, gateways: [...this.registry.gateways, saved] };
      await this.store.save(next);
      this.registry = next;
      this.entries.set(saved.id, { ...saved, manager: this.factory(saved.id, baseUrl) });
      return saved;
    });
  }
  setRelay(id: string, enabled: boolean) {
    return this.serialize(() => this.applyRelay(id, enabled));
  }
  private async applyRelay(id: string, enabled: boolean) {
      const entry = this.entry(id);
      const previous = this.relayConnections().find((row) => row.id === id);
      const next = id === "primary" ? { ...this.registry, primaryRelay: enabled } : { ...this.registry, gateways: this.registry.gateways.map((row) => row.id === id ? { ...row, relay: enabled } : row) };
      await this.store.save(next); this.registry = next; entry.relay = enabled;
      if (!enabled && previous) await this.relay.revoke(previous);
      else await this.relay.tick(true);
  }
  removeGateway(id: string) {
    return this.serialize(async () => {
      if (id === "primary") throw new Error("The primary gateway cannot be removed");
      const entry = this.entry(id);
      const previous = this.relayConnections().find((row) => row.id === id);
      const next = { ...this.registry, defaultGatewayId: this.defaultGatewayId === id ? "primary" : this.defaultGatewayId, gateways: this.registry.gateways.filter((row) => row.id !== id) };
      await this.store.save(next); this.registry = next; this.entries.delete(id);
      if (previous) await this.relay.revoke(previous);
      entry.manager.close();
      await new FileHermesConnectionStore(`${this.connectionPath}.${id}.json`).clear();
      for (const [state, owner] of this.oauthOwners) if (owner.id === id) this.oauthOwners.delete(state);
    });
  }
  getConnection(id = "primary") { return this.entry(id).manager.getConnection(); }
  testConnection(input: HermesConnectionInput, id = "primary") { return this.entry(id).manager.testConnection(input); }
  updateConnection(input: HermesConnectionInput, id = "primary") {
    return this.serialize(async () => {
      // A different destination is a new trust boundary; never carry relay consent across it.
      const current = await this.getConnection(id);
      if (normalizeHermesUrl(input.baseUrl) !== current.baseUrl) {
        if (id !== "primary" || this.registry.gateways.length > 0) throw new Error("Add a new gateway to change its address without mixing Bot histories.");
        if ((await this.listGateways()).some((row) => row.id !== id && row.baseUrl === normalizeHermesUrl(input.baseUrl))) throw new Error("This gateway is already configured");
        await this.applyRelay(id, false);
      }
      return this.entry(id).manager.updateConnection(input);
    });
  }
  resetConnection() {
    return this.serialize(async () => {
      const current = await this.getConnection();
      if (this.registry.gateways.length && current.baseUrl !== current.defaultBaseUrl) throw new Error("Add local Hermes as another gateway to preserve existing Bot histories.");
      await this.applyRelay("primary", false);
      return this.primary.resetConnection();
    });
  }
  probeAuth(baseUrl: string) { return this.primary.probeAuth(baseUrl); }
  startOAuth(baseUrl: string, redirectUri: string, id = "primary") {
    return this.serialize(async () => {
      const normalized = normalizeHermesUrl(baseUrl);
      if ((await this.getConnection(id)).baseUrl !== normalized && (id !== "primary" || this.registry.gateways.length)) throw new Error("Add a new gateway to change its address without mixing Bot histories.");
      if ((await this.listGateways()).some((row) => row.id !== id && row.baseUrl === normalized)) throw new Error("This gateway is already configured");
      if ((await this.getConnection(id)).baseUrl !== normalized) await this.applyRelay(id, false);
      const result = await this.entry(id).manager.startOAuth(baseUrl, redirectUri);
      for (const [state, owner] of this.oauthOwners) if (Date.now() - owner.at > 600_000) this.oauthOwners.delete(state);
      this.oauthOwners.set(new URL(result.authorizationUrl).searchParams.get("state")!, { id, baseUrl: normalized, at: Date.now() });
      return result;
    });
  }
  completeOAuth(input: { code: string; state: string }) {
    return this.serialize(async () => {
      const owner = this.oauthOwners.get(input.state);
      this.oauthOwners.delete(input.state);
      if (!owner || Date.now() - owner.at > 600_000) throw new Error("Hermes OAuth authorization expired or is invalid");
      if ((await this.getConnection(owner.id)).baseUrl !== owner.baseUrl && (owner.id !== "primary" || this.registry.gateways.length)) throw new Error("Add a new gateway to change its address without mixing Bot histories.");
      return this.entry(owner.id).manager.completeOAuth(input);
    });
  }
  close() { this.relay.close(); for (const entry of this.entries.values()) entry.manager.close(); }
}
