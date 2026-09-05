import { createServer } from "node:http";
import { WebSocketServer } from "ws";

/** Isolated protocol fixture: no model calls, user credentials or real Hermes writes. */
export async function relayGateway(label: string) {
  const state = { roster: [] as unknown[], outbox: [] as unknown[], replies: [] as Record<string, unknown>[], deliveries: [] as Record<string, unknown>[], online: true, disconnectAfterDelivery: false, dropReplies: 0, connections: 0 };
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/health") return response.end(JSON.stringify({ ok: true, version: "0.21.7" }));
    if (request.url === "/api/status") return response.end(JSON.stringify({ auth_required: false, version: "0.21.7" }));
    response.end(JSON.stringify({ sessions: [], jobs: [], usage: {} }));
  });
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket, request) => {
    if (!state.online) { socket.terminate(); return; }
    state.connections += 1;
    if (new URL(request.url!, "http://localhost").searchParams.get("token") !== "fixture-session") { socket.close(); return; }
    socket.on("message", (raw) => {
      const { id, method, params = {} } = JSON.parse(String(raw));
      let result: unknown = {};
      if (method === "profiles.list") result = { profiles: [{ name: "default", ui_meta: {} }, { name: "writer", display_name: "Writer", description: `${label} Bot`, ui_meta: {} }] };
      if (method === "bot_relay.roster.sync") { state.roster = params.agents; result = { count: state.roster.length }; }
      if (method === "bot_relay.outbox.drain") result = { envelopes: state.outbox.splice(0) };
      if (method === "bot_relay.deliver") {
        state.deliveries.push(params);
        if (state.disconnectAfterDelivery) { socket.terminate(); return; }
        result = { reply: `${label} reviewed the request.` };
      }
      if (method === "bot_relay.reply") {
        if (state.dropReplies > 0) { state.dropReplies -= 1; socket.terminate(); return; }
        state.replies.push(params); result = { ok: true };
      }
      if (method === "session.list") result = { sessions: [] };
      if (method === "session.create") result = { session_id: `${params.profile}-runtime`, stored_session_id: `${params.profile}-stored` };
      if (method === "model.options") result = { providers: [] };
      if (method === "cli.exec") result = { code: 0, stdout: "" };
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`, state,
    emitSession(type: string, sessionId: string, payload: Record<string, unknown>) {
      for (const socket of sockets.clients) socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: { type, session_id: sessionId, payload } }));
    },
    setOnline(online: boolean) {
      state.online = online;
      if (!online) for (const socket of sockets.clients) socket.terminate();
    },
    enqueue(envelope: unknown) {
      state.outbox.push(envelope);
      for (const socket of sockets.clients) socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: { type: "bot_relay.outbox.pending", payload: {} } }));
    },
    async close() {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => server.close(() => resolve())));
    }
  };
}
