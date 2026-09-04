import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startBridge, type BridgeRuntime } from "../server/runtime";
import { relayGateway } from "./fixtures/relay-gateway";

it("persists two authenticated WebSockets and relays a native Bot exchange through the real Bridge", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bybots-multi-gateway-test-"));
  const primary = await relayGateway("Primary");
  const remote = await relayGateway("Remote");
  const options = { port: 0, hermesUrl: primary.url, hermesSessionToken: "fixture-session", configFile: join(directory, "connection.json"), accessTokens: { admin: "fixture-admin" } };
  let bridge: BridgeRuntime | undefined;
  try {
    bridge = await startBridge(options);
    const call = async (method: "GET" | "POST" | "PUT" | "PATCH", path: string, payload?: object) => {
      const response = await bridge!.app.inject({ method, url: `/api/hermes/connection${path}`, headers: { authorization: "Bearer fixture-admin" }, ...(payload ? { payload } : {}) });
      expect(response.statusCode, response.body).toBeLessThan(300);
      return response.json();
    };
    const { id } = await call("POST", "/gateways", { label: "Remote", baseUrl: remote.url });
    await call("PUT", `/gateways/${id}`, { baseUrl: remote.url, token: "fixture-session" });
    await call("PATCH", "/gateways/primary", { relay: true });
    await call("PATCH", `/gateways/${id}`, { relay: true });
    primary.enqueue({ id: "a".repeat(32), target_connection: id, target_profile: "writer", message: "Please review the launch." });
    await expect.poll(() => primary.state.replies.length, { timeout: 10_000 }).toBe(1);
    expect(remote.state.deliveries).toEqual([{ profile: "writer", message: "Please review the launch." }]);
    expect(primary.state.replies[0]).toEqual({ id: "a".repeat(32), reply: "Remote reviewed the request." });
    const botResponse = await bridge.app.inject({ method: "GET", url: "/api/bots", headers: { authorization: "Bearer fixture-admin" } });
    expect(botResponse.json().bots.map((bot: { name: string }) => bot.name)).toEqual(["default", "writer", `${id}::default`, `${id}::writer`]);
    expect(JSON.stringify(await call("GET", "/gateways"))).not.toContain("fixture-session");
    expect(await readFile(`${options.configFile}.gateways.json`, "utf8")).not.toContain("fixture-session");
    await call("PUT", `/gateways/${id}/default`);
    await bridge.close(); bridge = await startBridge(options);
    expect((await call("GET", "/gateways")).gateways).toEqual([expect.objectContaining({ id: "primary", relay: true, isDefault: false }), expect.objectContaining({ id, relay: true, hasToken: true, isDefault: true })]);
    await call("PATCH", `/gateways/${id}`, { relay: false });
    expect(remote.state.roster).toEqual([]);
  } finally {
    await bridge?.close(); await primary.close(); await remote.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 25_000);
