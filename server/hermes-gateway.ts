import NodeWebSocket from "ws";

interface GatewayOptions {
  baseUrl: string;
  token: string;
  authMode?: "session" | "oauth";
  socketFactory?: (url: string) => globalThis.WebSocket;
  fetcher?: typeof fetch;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
  maxPendingRequests?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_PENDING_REQUESTS = 128;
const MAX_GATEWAY_FRAME_CHARS = 2_000_000;

export interface GatewayEvent {
  type: string;
  sessionId?: string;
  payload: Record<string, unknown>;
}

export class HermesGatewayError extends Error {
  constructor(message: string, readonly data?: Record<string, unknown>, readonly code?: number) {
    super(message);
    this.name = "HermesGatewayError";
  }
}

export class HermesGateway {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly authMode: "session" | "oauth";
  private readonly fetcher: typeof fetch;
  private readonly socketFactory: (url: string) => globalThis.WebSocket;
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly maxPendingRequests: number;
  private socket: globalThis.WebSocket | null = null;
  private opening: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly subscribers = new Set<(event: GatewayEvent) => void>();

  constructor({
    baseUrl,
    token,
    authMode = "session",
    socketFactory = (url) => new NodeWebSocket(url) as unknown as globalThis.WebSocket,
    fetcher = fetch,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    maxPendingRequests = DEFAULT_MAX_PENDING_REQUESTS
  }: GatewayOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.authMode = authMode;
    this.fetcher = fetcher;
    this.socketFactory = socketFactory;
    this.requestTimeoutMs = Math.max(1, requestTimeoutMs);
    this.connectTimeoutMs = Math.max(1, connectTimeoutMs);
    this.maxPendingRequests = Math.max(1, maxPendingRequests);
  }

  async patchSession(profile: string, sessionId: string, fields: Record<string, unknown>): Promise<unknown> {
    const path = `/api/sessions/${encodeURIComponent(sessionId)}`;
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(this.authMode === "oauth" ? { Authorization: `Bearer ${this.token}` } : { "X-Hermes-Session-Token": this.token })
      },
      body: JSON.stringify({ ...fields, profile })
    });
    if (!response.ok) {
      const raw = await response.text();
      let detail = raw.trim();
      try {
        const payload = JSON.parse(raw) as { detail?: unknown; error?: unknown; message?: unknown };
        detail = String(payload.detail || payload.error || payload.message || detail);
      } catch { /* Preserve non-JSON Hermes responses. */ }
      throw new HermesGatewayError(detail || `Hermes PATCH ${path} failed (${response.status})`);
    }
    return response.json();
  }

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.connect();
    if (this.pending.size >= this.maxPendingRequests) {
      throw new HermesGatewayError("Hermes gateway has too many pending requests", { reason: "target_busy", retryable: true });
    }
    const id = this.nextId++;
    const response = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new HermesGatewayError(`Hermes request timed out after ${this.requestTimeoutMs} ms`, { reason: "delivery_timeout", retryable: true }));
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        this.socket!.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (cause) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
    return response;
  }

  subscribe(listener: (event: GatewayEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  close(): void {
    const closed = new Error("Hermes gateway closed");
    this.rejectPending(closed);
    this.subscribers.clear();
    if (this.socket && this.socket.readyState < 2) this.socket.close();
    this.socket = null;
    this.opening = null;
  }

  private connect(): Promise<void> {
    if (this.socket?.readyState === 1) return Promise.resolve();
    if (this.opening) return this.opening;

    this.opening = this.openSocket().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async openSocket(): Promise<void> {
    const socketUrl = this.authMode === "session" ? this.socketUrl("token", this.token) : await this.oauthSocketUrl();
    const socket = this.socketFactory(socketUrl);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (this.socket === socket) this.onMessage(event);
    });
    socket.addEventListener("close", () => {
      this.onSocketUnavailable(socket, new HermesGatewayError("Hermes gateway connection closed", { reason: "runtime_offline", retryable: true }));
    });
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const failure = new HermesGatewayError(`Hermes gateway connection timed out after ${this.connectTimeoutMs} ms`, { reason: "runtime_offline", retryable: true });
        reject(failure);
        this.onSocketUnavailable(socket, failure);
      }, this.connectTimeoutMs);
      timer.unref?.();
      const settle = (callback: () => void) => {
        clearTimeout(timer);
        callback();
      };
      socket.addEventListener("open", () => settle(resolve), { once: true });
      socket.addEventListener("error", () => settle(() => {
        const failure = new HermesGatewayError("Unable to connect to the Hermes WebSocket", { reason: "runtime_offline", retryable: true });
        reject(failure);
        this.onSocketUnavailable(socket, failure);
      }), { once: true });
      socket.addEventListener("close", () => settle(() => reject(new HermesGatewayError("Hermes gateway connection closed before opening", { reason: "runtime_offline", retryable: true }))), { once: true });
    });
  }

  private socketUrl(parameter: "token" | "ticket", credential: string) {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/api/ws`;
    url.searchParams.set(parameter, credential);
    return url.toString();
  }

  private async oauthSocketUrl() {
    const response = await this.fetcher(`${this.baseUrl}/api/auth/ws-ticket`, {
      method: "POST",
      headers: { accept: "application/json", Authorization: `Bearer ${this.token}` }
    });
    if (!response.ok) throw new HermesGatewayError(`Hermes OAuth ticket request failed (${response.status})`);
    const payload = await response.json() as { ticket?: unknown };
    if (typeof payload.ticket !== "string" || !payload.ticket) throw new HermesGatewayError("Hermes did not return a WebSocket ticket");
    return this.socketUrl("ticket", payload.ticket);
  }

  private onMessage(event: MessageEvent) {
    const raw = String(event.data);
    if (raw.length > MAX_GATEWAY_FRAME_CHARS) {
      this.failProtocol("Hermes gateway frame exceeds the supported size");
      return;
    }
    let message: {
      id?: number;
      method?: string;
      params?: { type?: string; session_id?: string; payload?: Record<string, unknown> };
      result?: unknown;
      error?: { message?: string; code?: number; data?: Record<string, unknown> };
    };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid gateway message");
      message = parsed;
    } catch {
      this.failProtocol("Hermes gateway sent an invalid JSON message");
      return;
    }
    if (message.method === "event" && message.params?.type) {
      const normalized: GatewayEvent = {
        type: message.params.type,
        ...(message.params.session_id ? { sessionId: message.params.session_id } : {}),
        payload: message.params.payload ?? {}
      };
      for (const subscriber of this.subscribers) {
        try {
          subscriber(normalized);
        } catch {
          // A faulty consumer must not break the gateway event boundary.
        }
      }
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new HermesGatewayError(message.error.message ?? "Hermes error", message.error.data, message.error.code));
    else pending.resolve(message.result);
  }

  private rejectPending(reason: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }

  private onSocketUnavailable(socket: globalThis.WebSocket, reason: Error): void {
    if (this.socket !== socket) return;
    this.socket = null;
    if (socket.readyState < 2) {
      try {
        socket.close();
      } catch {
        // The transport is already unusable; pending work is still rejected.
      }
    }
    this.rejectPending(reason);
  }

  private failProtocol(message: string): void {
    const socket = this.socket;
    const failure = new HermesGatewayError(message);
    this.rejectPending(failure);
    this.socket = null;
    if (socket && socket.readyState < 2) socket.close();
  }
}
