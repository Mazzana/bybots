import { afterEach, describe, expect, it, vi } from "vitest";
import { api, parseEventStreamChunk } from "../src/api";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("web API client", () => {
  it("reports missing multi-gateway support instead of returning an invalid list to React", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await expect(api.listGateways!()).rejects.toThrow("Gateway management is unavailable");
  });
  it("does not send a JSON content type when deleting a Bot without a body", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);

    await api.deleteBot("analyst");

    expect(fetcher).toHaveBeenCalledWith("/api/bots/analyst", {
      method: "DELETE",
      headers: {}
    });
  });

  it("downloads and uploads Hermes Bot archives without JSON encoding", async () => {
    const archive = new File([new Uint8Array([0x1f, 0x8b, 1])], "research.tar.gz", { type: "application/gzip" });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([0x1f, 0x8b, 1]), {
        status: 200,
        headers: { "content-type": "application/gzip", "content-disposition": "attachment; filename=\"finance.tar.gz\"" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ bot: { name: "research-copy", system: false } }), { status: 201 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(api.exportBot!("finance")).resolves.toMatchObject({ filename: "finance.tar.gz", blob: expect.any(Blob) });
    await expect(api.importBot!(archive, "research-copy")).resolves.toEqual({ name: "research-copy", system: false });
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/bots/finance/export", { method: "POST", headers: {} });
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/bots/import?name=research-copy", {
      method: "POST",
      headers: { "content-type": "application/gzip" },
      body: archive
    });
  });

  it("manages Hermes gateway selection through the Bridge", async () => {
    const current = { baseUrl: "http://127.0.0.1:9120", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, secure: true, source: "environment" };
    const remote = { ...current, baseUrl: "https://hermes.example.test", source: "saved", version: "0.21.4" };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ connection: current }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ probe: { baseUrl: remote.baseUrl, secure: true, version: "0.21.4" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ connection: remote }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ connection: current }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await api.getHermesConnection!();
    await api.testHermesConnection!({ baseUrl: remote.baseUrl, token: "remote-session" });
    await api.updateHermesConnection!({ baseUrl: remote.baseUrl, token: "remote-session" });
    await api.resetHermesConnection!();

    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/hermes/connection", { headers: {} });
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/hermes/connection/test", expect.objectContaining({ method: "POST", body: JSON.stringify({ baseUrl: remote.baseUrl, token: "remote-session" }) }));
    expect(fetcher).toHaveBeenNthCalledWith(3, "/api/hermes/connection", expect.objectContaining({ method: "PUT" }));
    expect(fetcher).toHaveBeenNthCalledWith(4, "/api/hermes/connection", { method: "DELETE", headers: {} });
  });

  it("loads the sanitized diagnostics report through the Bridge", async () => {
    const report = {
      schemaVersion: 1,
      generatedAt: "2026-09-03T12:00:00.000Z",
      application: { name: "ByBots", version: "0.2.0" },
      runtime: { platform: "linux", architecture: "x64" },
      connection: { target: "remote", transport: "https", secure: true },
      support: { hermes: "0.21.x" },
      checks: { bridge: { status: "ready" }, hermes: { status: "ready", compatible: true }, authentication: { status: "ready" } },
      privacy: { excluded: ["authentication credentials and headers"] }
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(report), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(api.getDiagnosticsReport!()).resolves.toEqual(report);
    expect(fetcher).toHaveBeenCalledWith("/api/diagnostics/report", { headers: {} });
  });

  it("tests an MCP server through the narrow Bridge route", async () => {
    const test = { server: "local files", toolCount: 3, tools: ["read", "write", "search"] };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ test }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(api.testMcpServer!("research bot", "local files")).resolves.toEqual(test);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/bots/research%20bot/mcp/local%20files/test",
      { method: "POST", headers: {} }
    );
  });

  it("parses SSE frames split across network chunks", () => {
    const first = parseEventStreamChunk("", "event: conversation\ndata: {\"type\":\"conver");
    const second = parseEventStreamChunk(first.buffer, "sation\",\"conversation\":{\"bot\":\"finance\",\"sessionId\":\"s1\",\"running\":false,\"messages\":[]}}\n\n: heartbeat\n\n");

    expect(first.events).toEqual([]);
    expect(second.events).toEqual([{ type: "conversation", conversation: { bot: "finance", sessionId: "s1", running: false, messages: [] } }]);
    expect(second.buffer).toBe("");
  });

  it("streams live thread snapshots and aborts cleanly", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(encoder.encode("event: conversation\ndata: {\"type\":\"conversation\",\"conversation\":{\"bot\":\"finance\",\"sessionId\":\"s1\",\"running\":false,\"messages\":[]}}\n\n"));
      }
    });
    const fetcher = vi.fn().mockImplementation((_path: string, init: RequestInit) => {
      init.signal?.addEventListener("abort", () => streamController.close(), { once: true });
      return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
    });
    vi.stubGlobal("fetch", fetcher);
    let received: unknown;
    let connected = false;
    let release!: () => void;
    const delivered = new Promise<void>((resolve) => { release = resolve; });

    const stop = api.watchThread!("finance", "s1", (event) => { received = event; release(); }, (status) => { connected = status === "connected"; });
    await delivered;
    stop();

    expect(connected).toBe(true);
    expect(received).toMatchObject({ type: "conversation", conversation: { sessionId: "s1" } });
    expect(fetcher).toHaveBeenCalledWith("/api/bots/finance/threads/s1/events", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("reconnects a dropped thread stream with bounded backoff", async () => {
    vi.useFakeTimers();
    let liveController!: ReadableStreamDefaultController<Uint8Array>;
    const liveBody = new ReadableStream<Uint8Array>({ start(controller) { liveController = controller; } });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockImplementationOnce((_path: string, init: RequestInit) => {
        init.signal?.addEventListener("abort", () => liveController.close(), { once: true });
        return Promise.resolve(new Response(liveBody, { status: 200 }));
      });
    vi.stubGlobal("fetch", fetcher);
    let releaseDisconnected!: () => void;
    let releaseReconnected!: () => void;
    const disconnected = new Promise<void>((resolve) => { releaseDisconnected = resolve; });
    const reconnected = new Promise<void>((resolve) => { releaseReconnected = resolve; });
    let connectedCount = 0;

    const stop = api.watchThread!("finance", "s1", () => undefined, (status) => {
      if (status === "disconnected") releaseDisconnected();
      if (status === "connected" && ++connectedCount === 2) releaseReconnected();
    });
    await disconnected;
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await reconnected;

    expect(fetcher).toHaveBeenCalledTimes(2);
    stop();
  });

  it("loads the canonical conversation for one bot", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      bot: "finance",
      sessionId: "s1",
      running: false,
      messages: []
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);

    await expect(api.getConversation!("finance")).resolves.toMatchObject({ bot: "finance", sessionId: "s1" });
    expect(fetcher).toHaveBeenCalledWith("/api/bots/finance/conversation", expect.any(Object));
  });

  it("submits a message to one bot", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      bot: "finance",
      sessionId: "s1",
      running: true,
      messages: [{ role: "user", text: "Bonjour" }]
    }), { status: 202, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);

    await api.sendMessage!("finance", "Bonjour");

    expect(fetcher).toHaveBeenCalledWith("/api/bots/finance/messages", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ text: "Bonjour" })
    }));
  });

  it("persists avatar metadata for a Bot", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);

    await api.updateBotAvatar!("analyst", { shape: "blobatar::cloud" });

    expect(fetcher).toHaveBeenCalledWith("/api/bots/analyst/avatar", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ shape: "blobatar::cloud" })
    }));
  });

  it("loads and updates a Bot capability configuration", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ bot: "finance", skills: [] }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: { skills: true }, confirmRequired: false }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);

    await api.getBotConfiguration!("finance");
    await api.updateBot!("finance", { disabledSkills: ["email"] });

    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/bots/finance/config", expect.any(Object));
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/bots/finance", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ disabledSkills: ["email"] })
    }));
  });

  it("loads groups from the Bridge", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      groups: [{ id: "room-1", name: "Direction", members: ["finance", "ops"], messages: [], running: false }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);

    await expect(api.listGroups!()).resolves.toMatchObject([{ id: "room-1", name: "Direction" }]);
    expect(fetcher).toHaveBeenCalledWith("/api/groups", expect.any(Object));
  });

  it("creates a group and submits its message through the Bridge", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ group: { id: "room-1" } }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "room-1", running: true }), { status: 202, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);

    await api.createGroup!("Direction", ["finance", "ops"]);
    await api.sendGroupMessage!("room-1", "Décidez");

    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/groups", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Direction", members: ["finance", "ops"] })
    }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/groups/room-1/messages", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ text: "Décidez" })
    }));
  });
});
