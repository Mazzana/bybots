import { describe, expect, it, vi } from "vitest";
import { HermesGateway } from "../server/hermes-gateway";

class FakeSocket extends EventTarget {
  readyState = 0;
  sent: string[] = [];
  closed = false;

  send(data: string) {
    this.sent.push(data);
  }

  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  receive(payload: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }

  receiveRaw(payload: string) {
    this.dispatchEvent(new MessageEvent("message", { data: payload }));
  }

  disconnect() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

describe("HermesGateway", () => {
  it("archives a profile session through Hermes metadata without deleting it", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ session: { id: "s1", archived: true } }), { status: 200 }));
    const gateway = new HermesGateway({
      baseUrl: "http://127.0.0.1:9120",
      token: "session-secret",
      fetcher,
      socketFactory: () => new FakeSocket() as unknown as WebSocket
    });

    await gateway.patchSession("inbox triage", "s/1", { archived: true });

    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:9120/api/sessions/s%2F1", expect.objectContaining({
      method: "PATCH",
      headers: expect.objectContaining({ "X-Hermes-Session-Token": "session-secret" }),
      body: JSON.stringify({ archived: true, profile: "inbox triage" })
    }));
  });

  it("uses bearer OAuth to mint a single-use WebSocket ticket", async () => {
    const socket = new FakeSocket();
    let socketUrl = "";
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ticket: "single-use-ticket" }), { status: 200 }));
    const gateway = new HermesGateway({
      baseUrl: "https://hermes.example.test",
      token: "oauth-access",
      authMode: "oauth",
      fetcher,
      socketFactory: (url) => { socketUrl = url; return socket as unknown as WebSocket; }
    });

    const pending = gateway.request("profiles.list");
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = JSON.parse(socket.sent[0]);
    socket.receive({ jsonrpc: "2.0", id: request.id, result: { profiles: [] } });

    await expect(pending).resolves.toEqual({ profiles: [] });
    expect(fetcher).toHaveBeenCalledWith("https://hermes.example.test/api/auth/ws-ticket", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer oauth-access" }) }));
    expect(socketUrl).toBe("wss://hermes.example.test/api/ws?ticket=single-use-ticket");
  });

  it.each(["headers", "body"])("bounds a stalled OAuth ticket %s and cancels the transport", async (phase) => {
    let signal: AbortSignal | undefined;
    const cancel = vi.fn();
    const socketFactory = vi.fn();
    const gateway = new HermesGateway({
      baseUrl: "https://hermes.example.test", token: "oauth-secret", authMode: "oauth", connectTimeoutMs: 10,
      socketFactory,
      fetcher: vi.fn().mockImplementation((_url, init) => {
        signal = init.signal;
        return phase === "headers" ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream({ cancel })));
      })
    });
    try {
      await expect(gateway.request("profiles.list")).rejects.toThrow("OAuth ticket request timed out");
      expect(signal?.aborted).toBe(true);
      expect(socketFactory).not.toHaveBeenCalled();
      if (phase === "body") expect(cancel).toHaveBeenCalledOnce();
    } finally { gateway.close(); }
  });

  it("cancels shared OAuth connection work on close and ignores late tickets", async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const socketFactory = vi.fn();
    const gateway = new HermesGateway({ baseUrl: "https://hermes.example.test", token: "oauth-secret", authMode: "oauth", fetcher, socketFactory });
    const first = expect(gateway.request("profiles.list")).rejects.toThrow("Hermes gateway closed");
    const second = expect(gateway.request("session.list")).rejects.toThrow("Hermes gateway closed");
    expect(fetcher).toHaveBeenCalledOnce();
    gateway.close();
    complete(new Response(JSON.stringify({ ticket: "late-ticket" })));
    await Promise.all([first, second]);
    await expect(gateway.request("profiles.list")).rejects.toThrow("Hermes gateway closed");
    expect(socketFactory).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([401, 403, 503])("preserves OAuth ticket HTTP %s without exposing the response body", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("private-provider-detail", { status }));
    const gateway = new HermesGateway({ baseUrl: "https://hermes.example.test", token: "oauth-secret", authMode: "oauth", fetcher });
    await expect(gateway.request("profiles.list")).rejects.toMatchObject({
      message: `Hermes OAuth ticket request failed (${status})`, code: status,
      data: { phase: "oauth-ticket" }
    });
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
    gateway.close();
  });

  it.each(["{private-invalid-json", "null", JSON.stringify({ ticket: "x".repeat(17_000) }), JSON.stringify({ ticket: "" })])("rejects invalid OAuth ticket bodies without echoing their contents", async (body) => {
    const socketFactory = vi.fn();
    const gateway = new HermesGateway({ baseUrl: "https://hermes.example.test", token: "oauth-secret", authMode: "oauth", socketFactory,
      fetcher: vi.fn().mockResolvedValue(new Response(body)) });
    await expect(gateway.request("profiles.list")).rejects.toThrow("Hermes returned an invalid WebSocket ticket");
    expect(socketFactory).not.toHaveBeenCalled();
    gateway.close();
  });

  it("matches JSON-RPC responses to requests", async () => {
    const socket = new FakeSocket();
    const gateway = new HermesGateway({
      baseUrl: "http://127.0.0.1:9120",
      token: "session-secret",
      socketFactory: () => socket as unknown as WebSocket
    });

    const resultPromise = gateway.request<{ sessions: unknown[] }>("session.list", { profile: "finance" });
    socket.open();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(socket.sent).toHaveLength(1);
    const request = JSON.parse(socket.sent[0]);
    expect(request).toMatchObject({ jsonrpc: "2.0", method: "session.list", params: { profile: "finance" } });

    socket.receive({ jsonrpc: "2.0", id: request.id, result: { sessions: [] } });
    await expect(resultPromise).resolves.toEqual({ sessions: [] });
  });

  it("publishes gateway events to subscribers", async () => {
    const socket = new FakeSocket();
    const gateway = new HermesGateway({
      baseUrl: "http://127.0.0.1:9120",
      token: "session-secret",
      socketFactory: () => socket as unknown as WebSocket
    });
    const events: unknown[] = [];
    gateway.subscribe((event) => events.push(event));
    const pending = gateway.request("session.list");
    socket.open();

    socket.receive({ jsonrpc: "2.0", method: "event", params: { type: "message.delta", session_id: "abc", payload: { text: "Bon" } } });

    expect(events).toEqual([{ type: "message.delta", sessionId: "abc", payload: { text: "Bon" } }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket.receive({ jsonrpc: "2.0", id: JSON.parse(socket.sent[0]).id, result: {} });
    await pending;
    gateway.close();
  });

  it("preserves Hermes structured failure data on rejected requests", async () => {
    const socket = new FakeSocket();
    const gateway = new HermesGateway({
      baseUrl: "http://127.0.0.1:9120",
      token: "session-secret",
      socketFactory: () => socket as unknown as WebSocket
    });

    const resultPromise = gateway.request("prompt.submit", { session_id: "s1", text: "Bonjour" });
    socket.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = JSON.parse(socket.sent[0]);
    socket.receive({ jsonrpc: "2.0", id: request.id, error: { code: 429, message: "Rate limit exceeded", data: { reason: "provider_rate_limit", retryable: true } } });

    await expect(resultPromise).rejects.toMatchObject({
      message: "Rate limit exceeded",
      code: 429,
      data: { reason: "provider_rate_limit", retryable: true }
    });
  });

  it("closes the socket and rejects pending requests", async () => {
    const socket = new FakeSocket();
    const gateway = new HermesGateway({
      baseUrl: "http://127.0.0.1:9120",
      token: "session-secret",
      socketFactory: () => socket as unknown as WebSocket
    });

    const resultPromise = gateway.request("session.list");
    socket.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    gateway.close();

    await expect(resultPromise).rejects.toThrow("Hermes gateway closed");
    expect(socket.closed).toBe(true);
  });

  it("bounds pending request lifetimes and capacity", async () => {
    const socket = new FakeSocket();
    const gateway = new HermesGateway({
      baseUrl: "http://127.0.0.1:9120",
      token: "session-secret",
      requestTimeoutMs: 10,
      maxPendingRequests: 1,
      socketFactory: () => socket as unknown as WebSocket
    });

    const first = gateway.request("session.list");
    socket.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(gateway.request("profiles.list")).rejects.toThrow("too many pending requests");
    await expect(first).rejects.toThrow("timed out");
  });

  it("closes a socket that misses the connection deadline", async () => {
    const socket = new FakeSocket();
    const gateway = new HermesGateway({
      baseUrl: "http://127.0.0.1:9120",
      token: "session-secret",
      connectTimeoutMs: 10,
      socketFactory: () => socket as unknown as WebSocket
    });

    await expect(gateway.request("session.list")).rejects.toThrow("connection timed out");
    expect(socket.closed).toBe(true);
  });

  it("rejects pending work on an unexpected close and reconnects", async () => {
    const sockets: FakeSocket[] = [];
    const gateway = new HermesGateway({
      baseUrl: "http://127.0.0.1:9120",
      token: "session-secret",
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      }
    });

    const interrupted = gateway.request("session.list");
    const connected = sockets[0];
    connected.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    connected.disconnect();
    await expect(interrupted).rejects.toThrow("connection closed");

    const resumed = gateway.request("profiles.list");
    const replacement = sockets[1];
    replacement.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = JSON.parse(replacement.sent[0]);
    replacement.receive({ jsonrpc: "2.0", id: request.id, result: { profiles: [] } });
    await expect(resumed).resolves.toEqual({ profiles: [] });
  });

  it("contains malformed frames and subscriber failures", async () => {
    const socket = new FakeSocket();
    const gateway = new HermesGateway({
      baseUrl: "http://127.0.0.1:9120",
      token: "session-secret",
      socketFactory: () => socket as unknown as WebSocket
    });
    const delivered: unknown[] = [];
    gateway.subscribe(() => { throw new Error("broken consumer"); });
    gateway.subscribe((event) => delivered.push(event));

    const pending = gateway.request("session.list");
    socket.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket.receive({ jsonrpc: "2.0", method: "event", params: { type: "message.delta", payload: { text: "ok" } } });
    expect(delivered).toHaveLength(1);

    socket.receiveRaw("{not-json");
    await expect(pending).rejects.toThrow("invalid JSON");
    expect(socket.closed).toBe(true);
  });
});
