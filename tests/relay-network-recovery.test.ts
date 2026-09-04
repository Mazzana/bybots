import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startBridge } from "../server/runtime";
import { relayGateway } from "./fixtures/relay-gateway";

async function scenario(run: (context: {
  source: Awaited<ReturnType<typeof relayGateway>>;
  target: Awaited<ReturnType<typeof relayGateway>>;
  targetId: string;
  journalPath: string;
  call(method: "GET" | "PUT" | "PATCH", path: string, payload?: object): Promise<any>;
  read(path: string): Promise<any>;
  restart(): Promise<void>;
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "bybots-network-qa-"));
  const source = await relayGateway("Source"), target = await relayGateway("Target");
  const configFile = join(dir, "connection.json");
  const options = { port: 0, hermesUrl: source.url, hermesSessionToken: "fixture-session", configFile, accessTokens: { admin: "fixture-admin" } };
  let bridge = await startBridge(options);
  const call = async (method: "GET" | "POST" | "PUT" | "PATCH", path: string, payload?: object) => {
    const response = await bridge.app.inject({ method, url: `/api/hermes/connection${path}`, headers: { authorization: "Bearer fixture-admin" }, ...(payload ? { payload } : {}) });
    expect(response.statusCode, response.body).toBeLessThan(300);
    return response.json();
  };
  try {
    const { id: targetId } = await call("POST", "/gateways", { label: "Target", baseUrl: target.url });
    await call("PUT", `/gateways/${targetId}`, { baseUrl: target.url, token: "fixture-session" });
    await call("PATCH", "/gateways/primary", { relay: true });
    await call("PATCH", `/gateways/${targetId}`, { relay: true });
    await run({ source, target, targetId, journalPath: `${configFile}.relay.json`, call,
      read: async (path) => {
        const response = await bridge.app.inject({ method: "GET", url: path, headers: { authorization: "Bearer fixture-admin" } });
        expect(response.statusCode).toBe(200);
        return response.json();
      },
      restart: async () => { await bridge.close(); bridge = await startBridge(options); }
    });
  } finally {
    await bridge.close(); await source.close(); await target.close();
    await rm(dir, { recursive: true, force: true });
  }
}

it("keeps a disconnect after target acceptance uncertain across restart and never redelivers", async () => {
  await scenario(async ({ source, target, targetId, journalPath, call, restart }) => {
    const envelope = { id: "b".repeat(32), target_connection: targetId, target_profile: "writer", message: "Network acceptance QA" };
    target.state.disconnectAfterDelivery = true;
    source.enqueue(envelope);
    await expect.poll(async () => (await call("GET", "/gateways")).activity[0]?.status, { timeout: 10_000 }).toBe("uncertain");
    expect(target.state.deliveries).toHaveLength(1);
    expect(source.state.replies[0]).toHaveProperty("error");
    await expect.poll(async () => JSON.parse(await readFile(journalPath, "utf8")).records[0]?.status).toBe("uncertain");
    await restart();
    target.state.disconnectAfterDelivery = false;
    source.enqueue(envelope);
    source.enqueue({ ...envelope, id: "c".repeat(32) });
    await expect.poll(() => target.state.deliveries.length, { timeout: 10_000 }).toBe(2);
    await expect.poll(() => source.state.replies.length, { timeout: 10_000 }).toBe(2);
    expect((await call("GET", "/gateways")).activity.find((row: { id: string }) => row.id === envelope.id).status).toBe("uncertain");
  });
}, 25_000);

it("reconnects to return a known reply without rerunning the target Bot", async () => {
  await scenario(async ({ source, target, targetId, call }) => {
    source.state.dropReplies = 1;
    source.enqueue({ id: "d".repeat(32), target_connection: targetId, target_profile: "writer", message: "Reply reconnect QA" });
    await expect.poll(async () => (await call("GET", "/gateways")).activity[0]?.status, { timeout: 8_000 }).toBe("reply-pending");
    await expect.poll(() => source.state.replies.length, { timeout: 10_000 }).toBe(1);
    expect(source.state.connections).toBeGreaterThan(1);
    expect(target.state.deliveries).toHaveLength(1);
    expect(source.state.replies[0].reply).toBe("Target reviewed the request.");
    expect((await call("GET", "/gateways")).activity[0].status).toBe("replied");
  });
}, 20_000);

it("preserves a global pause across restart and resumes queued work only after consent", async () => {
  await scenario(async ({ source, target, targetId, call, restart }) => {
    await call("PUT", "/relay/pause", { paused: true });
    await restart();
    source.enqueue({ id: "e".repeat(32), target_connection: targetId, target_profile: "writer", message: "Paused queue QA" });
    expect((await call("GET", "/gateways")).safety.paused).toBe(true);
    expect(source.state.outbox).toHaveLength(1);
    expect(target.state.deliveries).toHaveLength(0);
    await call("PUT", "/relay/pause", { paused: false });
    await expect.poll(() => source.state.replies.length, { timeout: 10_000 }).toBe(1);
    expect(target.state.deliveries).toHaveLength(1);
  });
}, 20_000);

it("keeps healthy Bots available during a gateway socket outage and reconnects without reconfiguration", async () => {
  await scenario(async ({ source, target, targetId, read }) => {
    target.setOnline(false);
    const outage = await read("/api/gateways/status");
    expect(outage.gateways.find((row: { id: string }) => row.id === targetId).status).toBe("unavailable");
    expect(outage.gateways.find((row: { id: string }) => row.id === "primary").status).toBe("connected");
    const available = await read("/api/bots");
    expect(available.bots.length).toBeGreaterThan(0);
    expect(available.bots.every((bot: { gatewayId: string }) => bot.gatewayId === "primary")).toBe(true);
    target.setOnline(true);
    source.enqueue({ id: "f".repeat(32), target_connection: targetId, target_profile: "writer", message: "Recovered socket QA" });
    await expect.poll(() => source.state.replies.length, { timeout: 10_000 }).toBe(1);
    expect(target.state.deliveries).toHaveLength(1);
    await expect.poll(async () => (await read("/api/gateways/status")).gateways.find((row: { id: string }) => row.id === targetId).status, { timeout: 15_000 }).toBe("connected");
    expect((await read("/api/bots")).bots.some((bot: { gatewayId: string }) => bot.gatewayId === targetId)).toBe(true);
  });
}, 25_000);
