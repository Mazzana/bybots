import type { AccessRole, AvatarPet, Bot, BotRoutine, BotRoutineInput, BotRoutineRun, BotThread, BotThreadStreamEvent, BotsApi, Conversation, GroupRoom, HermesMachine, Usage } from "./App";

export function parseEventStreamChunk(buffer: string, chunk: string): { buffer: string; events: BotThreadStreamEvent[] } {
  const combined = buffer + chunk;
  const frames = combined.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? "";
  const events: BotThreadStreamEvent[] = [];
  for (const frame of frames) {
    const data = frame.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const event = JSON.parse(data) as BotThreadStreamEvent;
      if (event?.type === "conversation" || event?.type === "delta" || event?.type === "archived") events.push(event);
    } catch { /* Ignore malformed frames and keep the stream alive. */ }
  }
  return { buffer: rest, events };
}

async function requestResponse(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const raw = await response.text();
    let payload: any = null;
    try { payload = JSON.parse(raw); } catch { /* legacy plain-text response */ }
    const structured = payload?.error && typeof payload.error === "object" ? payload.error : null;
    const cause = new Error(structured?.detail || payload?.message || raw || `Error ${response.status}`) as Error & { failure?: unknown };
    if (structured) cause.failure = structured;
    throw cause;
  }
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await requestResponse(path, init);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function attachmentFilename(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* Fall back to the regular filename. */ }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
}

export const api: BotsApi = {
  getGatewayStatuses() { return request("/api/gateways/status"); },
  setRelayPaused(paused) { return request("/api/hermes/connection/relay/pause", { method: "PUT", body: JSON.stringify({ paused }) }); },
  async listGateways() {
    const result = await request<import("./gateways").GatewayList>("/api/hermes/connection/gateways");
    if (!Array.isArray(result?.gateways) || !Array.isArray(result?.activity)) throw new Error("Gateway management is unavailable on this Bridge.");
    return result;
  },
  addGateway(input) { return request("/api/hermes/connection/gateways", { method: "POST", body: JSON.stringify(input) }); },
  removeGateway(id) { return request(`/api/hermes/connection/gateways/${encodeURIComponent(id)}`, { method: "DELETE" }); },
  setDefaultGateway(id) { return request(`/api/hermes/connection/gateways/${encodeURIComponent(id)}/default`, { method: "PUT" }); },
  setGatewayRelay(id, relay) { return request(`/api/hermes/connection/gateways/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ relay }) }); },
  forGateway(id) {
    const path = `/api/hermes/connection/gateways/${encodeURIComponent(id)}`;
    return { ...api,
      async getHermesConnection() { return (await request<{ connection: import("./App").HermesConnection }>(path)).connection; },
      async updateHermesConnection(input) { return (await request<{ connection: import("./App").HermesConnection }>(path, { method: "PUT", body: JSON.stringify(input) })).connection; },
      async testHermesConnection(input) { return (await request<{ probe: import("./App").HermesConnectionProbe }>(`${path}/test`, { method: "POST", body: JSON.stringify(input) })).probe; },
      startHermesOAuth(input) { return request(`${path}/oauth/start`, { method: "POST", body: JSON.stringify({ ...input, appOrigin: window.location.origin }) }); }
    };
  },
  getAccess() { return request<{ role: AccessRole }>("/api/access"); },
  getDiagnostics() { return request<import("./App").AppDiagnostics>("/api/diagnostics"); },
  getDiagnosticsReport() { return request<import("./App").DiagnosticsReport>("/api/diagnostics/report"); },
  async getHermesConnection() { return (await request<{ connection: import("./App").HermesConnection }>("/api/hermes/connection")).connection; },
  async testHermesConnection(input) { return (await request<{ probe: import("./App").HermesConnectionProbe }>("/api/hermes/connection/test", { method: "POST", body: JSON.stringify(input) })).probe; },
  async updateHermesConnection(input) { return (await request<{ connection: import("./App").HermesConnection }>("/api/hermes/connection", { method: "PUT", body: JSON.stringify(input) })).connection; },
  async resetHermesConnection() { return (await request<{ connection: import("./App").HermesConnection }>("/api/hermes/connection", { method: "DELETE" })).connection; },
  async probeHermesAuth(input) { return (await request<{ auth: import("./App").HermesAuthProbe }>("/api/hermes/connection/auth", { method: "POST", body: JSON.stringify(input) })).auth; },
  startHermesOAuth(input) { return request<{ authorizationUrl: string }>("/api/hermes/connection/oauth/start", { method: "POST", body: JSON.stringify({ ...input, appOrigin: window.location.origin }) }); },
  async listMachines() { return (await request<{ machines: HermesMachine[] }>("/api/machines")).machines; },
  async listBots() { return (await request<{ bots: Bot[] }>("/api/bots")).bots; },
  getUsage(name: string, days: number) { return request<Usage>(`/api/bots/${encodeURIComponent(name)}/usage?days=${days}`); },
  async createBot(input) { return (await request<{ bot: Bot }>("/api/bots", { method: "POST", body: JSON.stringify(input) })).bot; },
  deleteBot(name: string) { return request<void>(`/api/bots/${encodeURIComponent(name)}`, { method: "DELETE" }); },
  async exportBot(name: string) {
    const response = await requestResponse(`/api/bots/${encodeURIComponent(name)}/export`, { method: "POST" });
    return { blob: await response.blob(), filename: attachmentFilename(response, `${name}.tar.gz`) };
  },
  async importBot(archive: File, name?: string, gatewayId?: string) {
    const params = new URLSearchParams();
    if (name?.trim()) params.set("name", name.trim());
    if (gatewayId) params.set("gatewayId", gatewayId);
    const query = params.size ? `?${params}` : "";
    return (await request<{ bot: Bot }>(`/api/bots/import${query}`, {
      method: "POST",
      headers: { "content-type": archive.type || "application/gzip" },
      body: archive
    })).bot;
  },
  updateBotAvatar(name: string, avatar: { shape?: string; color?: string; image?: string }) {
    return request<void>(`/api/bots/${encodeURIComponent(name)}/avatar`, { method: "PATCH", body: JSON.stringify(avatar) });
  },
  async listAvatarPets() { return (await request<{ pets: AvatarPet[] }>("/api/avatar-pets")).pets; },
  getBotConfiguration(name: string) {
    return request(`/api/bots/${encodeURIComponent(name)}/config`);
  },
  async testMcpServer(name: string, server: string) {
    return (await request<{ test: import("./App").McpServerTest }>(`/api/bots/${encodeURIComponent(name)}/mcp/${encodeURIComponent(server)}/test`, { method: "POST" })).test;
  },
  updateBot(name: string, input) {
    return request(`/api/bots/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify(input) });
  },
  async listRoutines(name: string) { return (await request<{ routines: BotRoutine[] }>(`/api/bots/${encodeURIComponent(name)}/routines`)).routines; },
  async createRoutine(name: string, input: BotRoutineInput) {
    return (await request<{ routine: BotRoutine }>(`/api/bots/${encodeURIComponent(name)}/routines`, { method: "POST", body: JSON.stringify(input) })).routine;
  },
  async setRoutineEnabled(name: string, routineId: string, enabled: boolean) {
    return (await request<{ routine: BotRoutine }>(`/api/bots/${encodeURIComponent(name)}/routines/${encodeURIComponent(routineId)}`, { method: "PATCH", body: JSON.stringify({ enabled }) })).routine;
  },
  async runRoutine(name: string, routineId: string) {
    return (await request<{ routine: BotRoutine }>(`/api/bots/${encodeURIComponent(name)}/routines/${encodeURIComponent(routineId)}/run`, { method: "POST" })).routine;
  },
  deleteRoutine(name: string, routineId: string) { return request<void>(`/api/bots/${encodeURIComponent(name)}/routines/${encodeURIComponent(routineId)}`, { method: "DELETE" }); },
  async listRoutineRuns(name: string, routineId: string) {
    return (await request<{ runs: BotRoutineRun[] }>(`/api/bots/${encodeURIComponent(name)}/routines/${encodeURIComponent(routineId)}/runs`)).runs;
  },
  getConversation(name: string) { return request<Conversation>(`/api/bots/${encodeURIComponent(name)}/conversation`); },
  sendMessage(name: string, text: string) {
    return request<Conversation>(`/api/bots/${encodeURIComponent(name)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text })
    });
  },
  async listThreads(name: string) {
    return (await request<{ threads: BotThread[] }>(`/api/bots/${encodeURIComponent(name)}/threads`)).threads;
  },
  async createThread(name: string, title?: string) {
    return (await request<{ conversation: Conversation }>(`/api/bots/${encodeURIComponent(name)}/threads`, {
      method: "POST",
      body: JSON.stringify(title ? { title } : {})
    })).conversation;
  },
  getThread(name: string, threadId: string) {
    return request<Conversation>(`/api/bots/${encodeURIComponent(name)}/threads/${encodeURIComponent(threadId)}`);
  },
  sendThreadMessage(name: string, threadId: string, text: string) {
    return request<Conversation>(`/api/bots/${encodeURIComponent(name)}/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text })
    });
  },
  async renameThread(name: string, threadId: string, title: string) {
    return (await request<{ thread: BotThread }>(`/api/bots/${encodeURIComponent(name)}/threads/${encodeURIComponent(threadId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title })
    })).thread;
  },
  archiveThread(name: string, threadId: string) {
    return request<void>(`/api/bots/${encodeURIComponent(name)}/threads/${encodeURIComponent(threadId)}`, { method: "DELETE" });
  },
  watchThread(name, threadId, listener, onStatus) {
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1_000;
    let terminal = false;
    const reconnect = (cause?: unknown) => {
      if (controller.signal.aborted || terminal) return;
      onStatus("disconnected", cause);
      retryTimer = setTimeout(() => {
        onStatus("connecting");
        void connect();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15_000);
    };
    const connect = async () => {
      try {
        const response = await fetch(`/api/bots/${encodeURIComponent(name)}/threads/${encodeURIComponent(threadId)}/events`, {
          headers: { accept: "text/event-stream" },
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Thread stream failed (${response.status})`);
        if (!response.body) throw new Error("Thread stream is unavailable");
        retryDelay = 1_000;
        onStatus("connected");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          const parsed = parseEventStreamChunk(buffer, decoder.decode(result.value, { stream: true }));
          buffer = parsed.buffer;
          for (const event of parsed.events) {
            listener(event);
            if (event.type === "archived") terminal = true;
          }
        }
        reconnect();
      } catch (cause) {
        reconnect(cause);
      }
    };
    void connect();
    return () => {
      terminal = true;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  },
  async listGroups() { return (await request<{ groups: GroupRoom[] }>("/api/groups")).groups; },
  async createGroup(name: string, members: string[]) {
    return (await request<{ group: GroupRoom }>("/api/groups", { method: "POST", body: JSON.stringify({ name, members }) })).group;
  },
  sendGroupMessage(roomId: string, text: string, thread?: string) {
    return request<GroupRoom>(`/api/groups/${encodeURIComponent(roomId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, ...(thread ? { thread } : {}) })
    });
  },
  stopGroup(roomId: string) {
    return request<GroupRoom>(`/api/groups/${encodeURIComponent(roomId)}/stop`, { method: "POST" });
  }
};
