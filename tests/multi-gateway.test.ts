import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiGateway } from "../server/multi-gateway";
import { HermesConnectionManager, type HermesRuntime } from "../server/hermes-connection";
import { createApp } from "../server/app";
import type { GatewayRegistry } from "../server/gateway-registry";

const closes: Array<() => void> = [];
afterEach(() => { closes.splice(0).forEach((close) => close()); });
function fixture() {
  const runtimes = new Map<string, HermesRuntime>();
  const managers = new Map<string, HermesConnectionManager>();
  const createManager = (id: string, baseUrl: string) => {
    const runtime: HermesRuntime = {
      hermes: { listBots: vi.fn().mockResolvedValue([{ name: "writer", system: false }]), createBot: vi.fn().mockResolvedValue({ name: "new", system: false }), deleteBot: vi.fn(), getBotUsage: vi.fn().mockResolvedValue({ bot: "writer", totalTokens: 4 }), getBotConfiguration: vi.fn().mockResolvedValue({ bot: "writer" }) },
      chat: { getConversation: vi.fn().mockResolvedValue({ bot: "writer", sessionId: "same", messages: [] }), sendMessage: vi.fn(), listThreads: vi.fn().mockResolvedValue([{ bot: "writer", id: "same" }]), watchThread: vi.fn().mockImplementation(async (_bot, _id, listener) => { listener({ type: "conversation", conversation: { bot: "writer", sessionId: "same" } }); return () => {}; }) },
      groups: { listGroups: vi.fn().mockResolvedValue([{ id: "same", name: "Team", members: ["writer"], messages: [{ authorKind: "bot", author: "writer" }], running: false }]), createGroup: vi.fn(), sendMessage: vi.fn() }, close: vi.fn()
    };
    runtimes.set(id, runtime);
    const manager = new HermesConnectionManager({ defaultConnection: { baseUrl, token: `secret-${id}` }, store: { load: async () => undefined, save: vi.fn(), clear: vi.fn() }, probe: async () => ({ version: "0.21.7" }), createRuntime: () => runtime });
    managers.set(id, manager);
    return manager;
  };
  let saved: GatewayRegistry = { version: 1, primaryRelay: false, gateways: [] };
  const store = { load: async () => saved, save: vi.fn().mockImplementation(async (value) => { saved = value; }) };
  const hub = new MultiGateway(createManager("primary", "http://127.0.0.1:9120"), store, "unused-test-connection", createManager);
  closes.push(() => hub.close());
  return { hub, runtimes, store, managers };
}

describe("Multi-gateway isolation", () => {
  it("binds concurrent OAuth callbacks to their gateway and consumes each state once", async () => {
    const { hub, managers } = fixture();
    const remote = await hub.addGateway({ label: "Work", baseUrl: "https://work.example.test" });
    const primary = managers.get("primary")!;
    const other = managers.get(remote.id)!;
    const callback = "http://127.0.0.1:4179/api/hermes/connection/oauth/callback";
    vi.spyOn(primary, "startOAuth").mockResolvedValue({ authorizationUrl: "http://127.0.0.1:9120/auth/native/authorize?state=primary-state" });
    vi.spyOn(other, "startOAuth").mockResolvedValue({ authorizationUrl: "https://work.example.test/auth/native/authorize?state=remote-state" });
    const primaryComplete = vi.spyOn(primary, "completeOAuth").mockResolvedValue({ connection: await primary.getConnection(), redirectUri: callback });
    const remoteComplete = vi.spyOn(other, "completeOAuth").mockResolvedValue({ connection: await other.getConnection(), redirectUri: callback });
    await hub.startOAuth("http://127.0.0.1:9120", callback);
    await hub.startOAuth("https://work.example.test", callback, remote.id);
    await hub.completeOAuth({ code: "code-b", state: "remote-state" });
    expect(remoteComplete).toHaveBeenCalledWith({ code: "code-b", state: "remote-state" });
    expect(primaryComplete).not.toHaveBeenCalled();
    await hub.completeOAuth({ code: "code-a", state: "primary-state" });
    await expect(hub.completeOAuth({ code: "code-b", state: "remote-state" })).rejects.toThrow("invalid");
    expect(primaryComplete).toHaveBeenCalledOnce();
    expect(remoteComplete).toHaveBeenCalledOnce();
  });
  it("keeps existing Bot IDs and scopes duplicate remote profiles, config, usage and stream events", async () => {
    const { hub, runtimes } = fixture();
    const remote = await hub.addGateway({ label: "Work", baseUrl: "https://work.example.test" });
    expect(await hub.hermes.listBots()).toEqual([expect.objectContaining({ name: "writer", gatewayId: "primary" }), expect.objectContaining({ name: `${remote.id}::writer`, gatewayLabel: "Work" })]);
    expect(await hub.hermes.getBotConfiguration!(`${remote.id}::writer`)).toMatchObject({ bot: `${remote.id}::writer` });
    expect(await hub.hermes.getBotUsage(`${remote.id}::writer`)).toMatchObject({ bot: `${remote.id}::writer`, totalTokens: 4 });
    expect(await hub.chat.listThreads!(`${remote.id}::writer`)).toEqual([{ bot: `${remote.id}::writer`, id: "same" }]);
    const listener = vi.fn();
    await hub.chat.watchThread!(`${remote.id}::writer`, "same", listener);
    expect(listener).toHaveBeenCalledWith({ type: "conversation", conversation: { bot: `${remote.id}::writer`, sessionId: "same" } });
    await hub.hermes.deleteBot(`${remote.id}::writer`);
    expect(runtimes.get(remote.id)!.hermes.deleteBot).toHaveBeenCalledWith("writer");
    expect(runtimes.get("primary")!.hermes.deleteBot).not.toHaveBeenCalled();
    expect(await hub.groups.listGroups()).toEqual([expect.objectContaining({ id: "same" }), expect.objectContaining({ id: `${remote.id}::same`, members: [`${remote.id}::writer`], messages: [expect.objectContaining({ author: `${remote.id}::writer` })] })]);
  });
  it("does not hide healthy Bots when another gateway fails and never falls back to primary for an unknown ID", async () => {
    const { hub, runtimes } = fixture();
    const remote = await hub.addGateway({ label: "Work", baseUrl: "https://work.example.test" });
    vi.mocked(runtimes.get("primary")!.hermes.listBots).mockRejectedValue(new Error("offline"));
    expect(await hub.hermes.listBots()).toHaveLength(1);
    await expect(hub.hermes.deleteBot("gw-000000000000::writer")).rejects.toThrow("Unknown gateway");
    await expect(hub.groups.createGroup("Mixed", ["writer", `${remote.id}::writer`])).rejects.toThrow("same gateway");
  });
  it("saves consent separately, rejects duplicates and address changes that could mix histories", async () => {
    const { hub, store } = fixture();
    const remote = await hub.addGateway({ label: "Work", baseUrl: "https://work.example.test/" });
    expect((await hub.listGateways()).every((row) => !row.relay)).toBe(true);
    await hub.setRelay(remote.id, true);
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({ gateways: [expect.objectContaining({ relay: true })] }));
    await expect(hub.addGateway({ label: "Duplicate", baseUrl: "https://work.example.test" })).rejects.toThrow("already configured");
    await expect(hub.updateConnection({ baseUrl: "https://elsewhere.example.test", token: "secret" }, remote.id)).rejects.toThrow("histories");
    expect(JSON.stringify(await hub.listGateways())).not.toContain("secret-");
  });
  it("protects management even for GET and routes creation to the selected gateway", async () => {
    const { hub, runtimes } = fixture();
    const remote = await hub.addGateway({ label: "Work", baseUrl: "https://work.example.test" });
    const app = createApp({ hermes: hub.hermes, chat: hub.chat, groups: hub.groups, connection: hub, gateways: hub, accessTokens: { admin: "admin-secret", operator: "operator-secret", viewer: "viewer-secret" } });
    for (const role of ["operator", "viewer"]) {
      const response = await app.inject({ method: "GET", url: "/api/hermes/connection/gateways", headers: { authorization: `Bearer ${role}-secret` } });
      expect(response.statusCode).toBe(403);
    }
    const response = await app.inject({ method: "POST", url: "/api/bots", headers: { authorization: "Bearer admin-secret" }, payload: { name: "new", gatewayId: remote.id } });
    expect(response.statusCode).toBe(201);
    expect(response.json().bot.name).toBe(`${remote.id}::new`);
    expect(runtimes.get(remote.id)!.hermes.createBot).toHaveBeenCalledWith({ name: "new" });
    expect(runtimes.get("primary")!.hermes.createBot).not.toHaveBeenCalled();
    await app.close();
  });
});
