import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { describe, expect, it } from "vitest";
import { HermesGateway } from "../server/hermes-gateway";

// Actual loopback HTTP/WebSocket transport; fixture credentials only, no provider calls.
async function fixture() {
  const state = { status: 200, issued: 0, accepted: [] as string[], redirected: 0 };
  const unused = new Set<string>();
  const server = createServer((request, response) => {
    if (request.url === "/redirected") {
      state.redirected += 1;
      response.end("unexpected");
      return;
    }
    if (request.url !== "/api/auth/ws-ticket" || request.method !== "POST"
      || request.headers.authorization !== "Bearer fixture-access") {
      response.writeHead(401).end();
      return;
    }
    if (state.status !== 200) {
      response.writeHead(state.status, state.status === 302 ? { location: "/redirected" } : {}).end("private-detail");
      return;
    }
    const ticket = `fixture-ticket-${++state.issued}`;
    unused.add(ticket);
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ticket }));
  });
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket, request) => {
    const url = new URL(request.url!, "http://localhost");
    const ticket = url.searchParams.get("ticket") ?? "";
    if (url.searchParams.has("token") || !unused.delete(ticket)) { socket.terminate(); return; }
    state.accepted.push(ticket);
    socket.on("message", (raw) => {
      const { id } = JSON.parse(String(raw));
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, result: { profiles: [] } }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  const gateway = new HermesGateway({ baseUrl: `http://127.0.0.1:${port}`, token: "fixture-access", authMode: "oauth", connectTimeoutMs: 1_000 });
  return {
    gateway, state,
    async disconnect() {
      const clients = [...sockets.clients];
      const closed = clients.map((socket) => once(socket, "close"));
      for (const socket of clients) socket.close();
      await Promise.all(closed);
    },
    async close() {
      gateway.close();
      for (const socket of sockets.clients) socket.terminate();
      server.closeAllConnections();
      await new Promise<void>((resolve) => sockets.close(() => server.close(() => resolve())));
    }
  };
}

describe("OAuth gateway network recovery", () => {
  it("recovers from a ticket rejection and mints a new single-use ticket after a socket drop", async () => {
    const test = await fixture();
    try {
      test.state.status = 401;
      await expect(test.gateway.request("profiles.list")).rejects.toMatchObject({ code: 401, data: { phase: "oauth-ticket" } });
      test.state.status = 200;
      await expect(test.gateway.request("profiles.list")).resolves.toEqual({ profiles: [] });
      await test.disconnect();
      await expect(test.gateway.request("profiles.list")).resolves.toEqual({ profiles: [] });
      expect(test.state.accepted).toEqual(["fixture-ticket-1", "fixture-ticket-2"]);
    } finally { await test.close(); }
  });

  it("does not follow ticket endpoint redirects and can retry a restored endpoint", async () => {
    const test = await fixture();
    try {
      test.state.status = 302;
      await expect(test.gateway.request("profiles.list")).rejects.toThrow("Unable to obtain a Hermes WebSocket ticket");
      expect(test.state.redirected).toBe(0);
      expect(test.state.accepted).toEqual([]);
      test.state.status = 200;
      await expect(test.gateway.request("profiles.list")).resolves.toEqual({ profiles: [] });
    } finally { await test.close(); }
  });
});
