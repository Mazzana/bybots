import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startBridge, type BridgeRuntime } from "../server/runtime";
import { relayGateway } from "./fixtures/relay-gateway";

it("forwards each real WebSocket fragment through HTTP SSE before the Bot finishes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bybots-stream-test-"));
  const gateway = await relayGateway("Fixture");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let bridge: BridgeRuntime | undefined;
  try {
    bridge = await startBridge({ port: 0, hermesUrl: gateway.url, hermesSessionToken: "fixture-session", configFile: join(directory, "connection.json"), accessTokens: { admin: "fixture-admin" } });
    const headers = { authorization: "Bearer fixture-admin" };
    const created = await bridge.app.inject({ method: "POST", url: "/api/bots/writer/threads", headers, payload: { title: "Streaming fixture" } });
    expect(created.statusCode).toBe(201);
    const path = "/api/bots/writer/threads/writer-stored";
    const response = await fetch(`${bridge.url}${path}/events`, { headers, signal: controller.signal });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    async function until(text: string) {
      while (!received.includes(text)) {
        const next = await reader.read();
        expect(next.done).toBe(false);
        received += decoder.decode(next.value, { stream: true });
      }
    }
    await until("event: conversation");
    await bridge.app.inject({ method: "POST", url: `${path}/messages`, headers, payload: { text: "Fixture question" } });
    gateway.emitSession("message.delta", "writer-runtime", { text: "First fragment" });
    await until('"text":"First fragment"');
    expect(received).toContain("event: delta");
    expect(received).not.toContain("Final answer");
    gateway.emitSession("message.delta", "writer-runtime", { text: " second fragment" });
    await until('"text":" second fragment"');
    gateway.emitSession("message.complete", "writer-runtime", { text: "Final answer" });
    await until('"text":"Final answer"');
    await reader.cancel();
  } finally {
    clearTimeout(timeout); controller.abort();
    await bridge?.close(); await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
