import { describe, expect, it, vi } from "vitest";
import { BotRelay, RELAY_DELIVER_TIMEOUT_MS, type RelayConnection } from "../server/bot-relay";
import type { HermesGateway } from "../server/hermes-gateway";

const envelope = { id: "a".repeat(32), target_connection: "remote", target_profile: "writer", message: "Message from 🤖 planner (@planner): Please review this." };
function fixture() {
  const request = (id: string) => vi.fn().mockImplementation(async (method: string) => {
    if (method === "profiles.list") return { profiles: [{ name: "writer", handle: "editor" }] };
    if (method === "bot_relay.outbox.drain") return { envelopes: id === "local" ? [envelope] : [] };
    if (method === "bot_relay.deliver") return { reply: "Reviewed." };
    return { ok: true };
  });
  const localRequest = request("local"), remoteRequest = request("remote");
  const rows: RelayConnection[] = [
    { id: "local", label: "Local", gateway: { request: localRequest, subscribe: () => () => {} } as unknown as HermesGateway },
    { id: "remote", label: "Work", gateway: { request: remoteRequest, subscribe: () => () => {} } as unknown as HermesGateway }
  ];
  let connections = rows;
  const relay = new BotRelay(() => connections);
  return { relay, localRequest, remoteRequest, setConnections: (next: RelayConnection[]) => { connections = next; }, rows };
}

describe("Native Hermes Bot relay", () => {
  it("syncs other gateways, forwards the envelope, then returns the reply without duplicate delivery", async () => {
    const { relay, localRequest, remoteRequest } = fixture();
    await relay.tick(true); await relay.settle();
    expect(localRequest).toHaveBeenCalledWith("bot_relay.roster.sync", { agents: [expect.objectContaining({ profile: "writer", handle: "editor", connection_id: "remote", connection_label: "Work" })] });
    expect(remoteRequest).toHaveBeenCalledWith("bot_relay.deliver", { profile: "writer", message: envelope.message }, RELAY_DELIVER_TIMEOUT_MS);
    expect(localRequest).toHaveBeenCalledWith("bot_relay.reply", { id: envelope.id, reply: "Reviewed." });
    expect(relay.activity[0].status).toBe("replied");
    await relay.tick(); await relay.settle();
    expect(remoteRequest.mock.calls.filter(([method]) => method === "bot_relay.deliver")).toHaveLength(1);
    expect(JSON.stringify(relay.activity)).not.toContain(envelope.message);
    relay.close();
  });
  it("never delivers to a removed gateway and clears the previously shared roster", async () => {
    const { relay, remoteRequest, localRequest, setConnections, rows } = fixture();
    setConnections([rows[0]]);
    await relay.tick(true); await relay.settle();
    expect(remoteRequest).not.toHaveBeenCalled();
    expect(localRequest).toHaveBeenCalledWith("bot_relay.reply", expect.objectContaining({ error: expect.any(String) }));
    await relay.revoke(rows[1]);
    expect(remoteRequest).toHaveBeenCalledWith("bot_relay.roster.sync", { agents: [] });
    relay.close();
  });
  it("retries returning a reply, never the target Bot turn", async () => {
    const { relay, localRequest, remoteRequest } = fixture();
    const original = localRequest.getMockImplementation()!;
    let failReply = true;
    localRequest.mockImplementation(async (method, ...args) => {
      if (method === "bot_relay.reply" && failReply) throw new Error("offline");
      return original(method, ...args);
    });
    await relay.tick(true); await relay.settle();
    expect(relay.activity[0].status).toBe("reply-pending");
    failReply = false;
    await relay.tick(); await relay.settle();
    expect(relay.activity[0].status).toBe("replied");
    expect(remoteRequest.mock.calls.filter(([method]) => method === "bot_relay.deliver")).toHaveLength(1);
    relay.close();
  });
  it("keeps draining while a long turn is running, allowing nested messages", async () => {
    const { relay, remoteRequest, localRequest } = fixture();
    let finish!: (value: unknown) => void;
    const original = remoteRequest.getMockImplementation()!;
    remoteRequest.mockImplementation((method, ...args) => method === "bot_relay.deliver" ? new Promise((resolve) => { finish = resolve; }) : original(method, ...args));
    await relay.tick(true);
    expect(relay.activity[0].status).toBe("delivering");
    await relay.tick();
    expect(localRequest.mock.calls.filter(([method]) => method === "bot_relay.outbox.drain")).toHaveLength(2);
    finish({ reply: "done" }); await relay.settle(); relay.close();
  });
  it("forwards typed failure reasons without leaking raw errors", async () => {
    const { relay, localRequest, remoteRequest } = fixture();
    const original = remoteRequest.getMockImplementation()!;
    remoteRequest.mockImplementation(async (method, ...args) => {
      if (method === "bot_relay.deliver") throw Object.assign(new Error("token=secret"), { data: { reason: "target_busy" } });
      return original(method, ...args);
    });
    await relay.tick(true); await relay.settle();
    expect(localRequest).toHaveBeenCalledWith("bot_relay.reply", expect.objectContaining({ reason: "target_busy" }));
    expect(JSON.stringify(localRequest.mock.calls)).not.toContain("secret");
    relay.close();
  });
});
