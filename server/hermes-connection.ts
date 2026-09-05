import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ChatService, GroupService, HermesService } from "./app";
import { BotChatService } from "./bot-chat-service";
import { GroupChatService } from "./group-chat-service";
import { HermesClient } from "./hermes-client";
import { HermesGateway } from "./hermes-gateway";

type LocalTokenResolver = (baseUrl: string, configuredToken: string) => Promise<string>;

const CONNECTION_FILE_VERSION = 2;
const DEFAULT_PROBE_TIMEOUT_MS = 15_000;
const OAUTH_FLOW_TTL_MS = 10 * 60_000;
const OAUTH_REFRESH_SKEW_MS = 60_000;
const OAUTH_REFRESH_RETRY_MS = 60_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

export interface HermesConnectionCredentials {
  baseUrl: string;
  token: string;
  authMode?: "session" | "oauth";
  refreshToken?: string;
  provider?: string;
  expiresAt?: number;
}

export interface HermesConnectionInput {
  baseUrl: string;
  token?: string;
}

export interface HermesConnectionView {
  baseUrl: string;
  defaultBaseUrl: string;
  hasToken: boolean;
  authMode: "session" | "oauth";
  secure: boolean;
  source: "environment" | "saved";
  version?: string;
  requiresReauthentication?: boolean;
}

export interface HermesConnectionProbe {
  baseUrl: string;
  secure: boolean;
  version: string;
}

export interface HermesAuthProbe {
  baseUrl: string;
  reachable: boolean;
  authMode: "oauth" | "token" | "unknown";
  nativePkce: boolean;
  providers: Array<{ name: string; displayName: string; supportsPassword: boolean }>;
  version?: string;
  error?: string;
}

export interface HermesConnectionService {
  getConnection(): Promise<HermesConnectionView>;
  testConnection(input: HermesConnectionInput): Promise<HermesConnectionProbe>;
  updateConnection(input: HermesConnectionInput): Promise<HermesConnectionView>;
  resetConnection(): Promise<HermesConnectionView>;
  probeAuth?(baseUrl: string): Promise<HermesAuthProbe>;
  startOAuth?(baseUrl: string, redirectUri: string): Promise<{ authorizationUrl: string }>;
  completeOAuth?(input: { code: string; state: string }): Promise<{ connection: HermesConnectionView; redirectUri: string }>;
}

export interface HermesConnectionStore {
  load(): Promise<HermesConnectionCredentials | undefined>;
  save(connection: HermesConnectionCredentials): Promise<void>;
  clear(): Promise<void>;
}

export interface HermesRuntime {
  gateway?: HermesGateway;
  hermes: HermesService;
  chat: ChatService;
  groups: GroupService;
  close(): void;
}

interface HermesConnectionManagerOptions {
  defaultConnection: HermesConnectionCredentials;
  store: HermesConnectionStore;
  createRuntime?: (connection: HermesConnectionCredentials) => HermesRuntime;
  probe?: (connection: HermesConnectionCredentials) => Promise<{ version: string }>;
  fetcher?: typeof fetch;
  resolveLocalToken?: LocalTokenResolver;
}

export function defaultConfigFile() {
  if (process.env.BYFINITY_CONFIG_FILE?.trim()) return process.env.BYFINITY_CONFIG_FILE.trim();
  const root = process.platform === "win32" && process.env.APPDATA
    ? join(process.env.APPDATA, "Byfinity Bots")
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "byfinity-bots");
  return join(root, "connection.json");
}

export class FileHermesConnectionStore implements HermesConnectionStore {
  constructor(private readonly path = defaultConfigFile()) {}

  async load(): Promise<HermesConnectionCredentials | undefined> {
    let raw: string;
    try {
      const info = await lstat(this.path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("The saved Hermes connection must be a regular file");
      raw = await readFile(this.path, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw cause;
    }
    const value = JSON.parse(raw) as Partial<HermesConnectionCredentials> & { version?: unknown };
    if (![1, CONNECTION_FILE_VERSION].includes(Number(value.version)) || typeof value.baseUrl !== "string" || typeof value.token !== "string") {
      throw new Error("The saved Hermes connection is invalid");
    }
    if (value.authMode !== undefined && value.authMode !== "session" && value.authMode !== "oauth") throw new Error("The saved Hermes connection is invalid");
    return {
      baseUrl: value.baseUrl,
      token: value.token,
      ...(value.authMode === "oauth" ? { authMode: "oauth" as const } : {}),
      ...(typeof value.refreshToken === "string" && value.refreshToken ? { refreshToken: value.refreshToken } : {}),
      ...(typeof value.provider === "string" && value.provider ? { provider: value.provider } : {}),
      ...(typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt) && value.expiresAt > 0 ? { expiresAt: value.expiresAt } : {})
    };
  }

  async save(connection: HermesConnectionCredentials): Promise<void> {
    const folder = dirname(this.path);
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await mkdir(folder, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, `${JSON.stringify({ version: CONNECTION_FILE_VERSION, ...connection }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      try {
        await rename(temporary, this.path);
      } catch (cause) {
        if (!["EEXIST", "EPERM"].includes((cause as NodeJS.ErrnoException).code || "")) throw cause;
        await rm(this.path, { force: true });
        await rename(temporary, this.path);
      }
      await chmod(this.path, 0o600).catch(() => undefined);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

export function normalizeHermesUrl(value: string) {
  const input = value.trim();
  if (!input) throw new Error("Hermes gateway URL is required");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid Hermes gateway URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Hermes gateway URL must use HTTP or HTTPS");
  if (url.username || url.password) throw new Error("Do not include credentials in the Hermes gateway URL");
  if (url.search || url.hash) throw new Error("Hermes gateway URL cannot include a query or fragment");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function isSecureHermesUrl(value: string) {
  const url = new URL(value);
  return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "::1" || url.hostname.startsWith("127.");
}

function createDefaultRuntime(connection: HermesConnectionCredentials): HermesRuntime {
  const authMode = connection.authMode ?? "session";
  const gateway = connection.token ? new HermesGateway({ baseUrl: connection.baseUrl, token: connection.token, authMode }) : undefined;
  const chat = gateway ? new BotChatService(gateway) : undefined;
  const unavailable = async (..._args: unknown[]): Promise<never> => { throw new Error("Hermes session token is required"); };
  return {
    gateway,
    hermes: new HermesClient({ baseUrl: connection.baseUrl, authMode, ...(connection.token ? { sessionToken: connection.token } : {}), ...(gateway ? { gateway } : {}) }),
    chat: chat ?? {
      getConversation: unavailable, sendMessage: unavailable, listThreads: unavailable, createThread: unavailable,
      getThread: unavailable, sendThreadMessage: unavailable, renameThread: unavailable, archiveThread: unavailable,
      watchThread: unavailable
    },
    groups: gateway ? new GroupChatService(gateway) : { listGroups: unavailable, createGroup: unavailable, sendMessage: unavailable, stop: unavailable },
    close: () => { chat?.close(); gateway?.close(); }
  };
}

async function defaultProbe(connection: HermesConnectionCredentials) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${connection.baseUrl}/api/health`, {
      headers: { accept: "application/json", ...(connection.authMode === "oauth" ? { Authorization: `Bearer ${connection.token}` } : { "X-Hermes-Session-Token": connection.token }) },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Hermes health check failed (${response.status})`);
    const health = await response.json() as { ok?: unknown; version?: unknown };
    if (health.ok !== true) throw new Error("Hermes health check did not report ready");
    const version = typeof health.version === "string" && health.version.trim() ? health.version.trim() : "unknown";
    clearTimeout(timer);
    const gateway = new HermesGateway({ baseUrl: connection.baseUrl, token: connection.token, authMode: connection.authMode });
    try {
      await gateway.request("profiles.list", {}, DEFAULT_PROBE_TIMEOUT_MS);
    } finally {
      gateway.close();
    }
    return { version };
  } catch (cause) {
    if ((cause as Error).name === "AbortError") throw new Error("Hermes health check timed out");
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

function forwardingProxy<T extends object>(current: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const target = current();
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

class OAuthRefreshError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "OAuthRefreshError";
  }
}

export class HermesConnectionManager implements HermesConnectionService {
  readonly hermes: HermesService;
  readonly chat: ChatService;
  readonly groups: GroupService;
  private defaultConnection: HermesConnectionCredentials;
  private readonly createRuntime: (connection: HermesConnectionCredentials) => HermesRuntime;
  private readonly probe: (connection: HermesConnectionCredentials) => Promise<{ version: string }>;
  private currentConnection: HermesConnectionCredentials;
  private currentRuntime: HermesRuntime;
  private source: HermesConnectionView["source"] = "environment";
  private version?: string;
  private readonly fetcher: typeof fetch;
  private readonly resolveLocalToken: LocalTokenResolver;
  private readonly pendingOAuth = new Map<string, { baseUrl: string; redirectUri: string; verifier: string; expiresAt: number }>();
  private oauthRefreshTimer?: ReturnType<typeof setTimeout>;
  private oauthRefreshInFlight: Promise<void> | null = null;
  private requiresReauthentication = false;
  private closed = false;

  constructor(private readonly options: HermesConnectionManagerOptions) {
    this.defaultConnection = this.validateCredentials(options.defaultConnection, false);
    this.createRuntime = options.createRuntime ?? createDefaultRuntime;
    this.probe = options.probe ?? defaultProbe;
    this.fetcher = options.fetcher ?? fetch;
    this.resolveLocalToken = options.resolveLocalToken ?? (async (_baseUrl, token) => token);
    this.currentConnection = this.defaultConnection;
    this.currentRuntime = this.createRuntime(this.currentConnection);
    this.hermes = forwardingProxy(() => this.currentRuntime.hermes);
    this.chat = forwardingProxy(() => this.currentRuntime.chat);
    this.groups = forwardingProxy(() => this.currentRuntime.groups);
  }

  async initialize() {
    const saved = await this.options.store.load();
    if (!saved) return;
    const connection = this.validateCredentials(saved);
    if (this.oauthNeedsRefresh(connection)) {
      if (!connection.refreshToken) {
        this.activateConnection(connection, "saved", true);
        return;
      }
      try {
        const refreshed = await this.refreshOAuthCredentials(connection);
        await this.options.store.save(refreshed);
        this.activateConnection(refreshed, "saved");
        return;
      } catch (cause) {
        const terminal = cause instanceof OAuthRefreshError && cause.status === 401;
        this.activateConnection(connection, "saved", terminal, terminal ? undefined : OAUTH_REFRESH_RETRY_MS);
        return;
      }
    }
    this.activateConnection(connection, "saved");
  }

  async getConnection() {
    return this.view();
  }

  get relayGateway() {
    return this.closed || this.requiresReauthentication ? undefined : this.currentRuntime.gateway;
  }

  async testConnection(input: HermesConnectionInput): Promise<HermesConnectionProbe> {
    const connection = await this.resolveInput(input);
    const result = await this.probe(connection);
    return { baseUrl: connection.baseUrl, secure: isSecureHermesUrl(connection.baseUrl), version: result.version };
  }

  async updateConnection(input: HermesConnectionInput) {
    const connection = await this.resolveInput(input);
    const result = await this.probe(connection);
    await this.options.store.save(connection);
    this.version = result.version;
    this.activateConnection(connection, "saved");
    return this.view();
  }

  async resetConnection() {
    const connection = await this.refreshDefaultConnection();
    const result = await this.probe(connection);
    await this.options.store.clear();
    this.version = result.version;
    this.activateConnection(connection, "environment");
    return this.view();
  }

  async probeAuth(baseUrlInput: string): Promise<HermesAuthProbe> {
    const baseUrl = normalizeHermesUrl(baseUrlInput);
    try {
      const response = await this.fetcher(`${baseUrl}/api/status`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(DEFAULT_PROBE_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`Hermes status check failed (${response.status})`);
      const status = await response.json() as { auth_required?: unknown; auth_flows?: unknown; version?: unknown };
      const authMode = status.auth_required === true ? "oauth" as const : status.auth_required === false ? "token" as const : "unknown" as const;
      const nativePkce = Array.isArray(status.auth_flows) && status.auth_flows.includes("native_pkce");
      let providers: HermesAuthProbe["providers"] = [];
      if (authMode === "oauth") {
        try {
          const providerResponse = await this.fetcher(`${baseUrl}/api/auth/providers`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(DEFAULT_PROBE_TIMEOUT_MS) });
          if (providerResponse.ok) {
            const body = await providerResponse.json() as { providers?: unknown };
            if (Array.isArray(body.providers)) providers = body.providers.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object").map((value) => ({ name: String(value.name || ""), displayName: String(value.display_name || value.name || ""), supportsPassword: value.supports_password === true })).filter((value) => Boolean(value.name));
          }
        } catch { /* Provider labels are optional; auth mode comes from /api/status. */ }
      }
      return { baseUrl, reachable: true, authMode, nativePkce, providers, ...(typeof status.version === "string" ? { version: status.version } : {}) };
    } catch (cause) {
      return { baseUrl, reachable: false, authMode: "unknown", nativePkce: false, providers: [], error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  async startOAuth(baseUrlInput: string, redirectUriInput: string) {
    const baseUrl = normalizeHermesUrl(baseUrlInput);
    if (!isSecureHermesUrl(baseUrl)) throw new Error("Hermes OAuth requires HTTPS or a loopback gateway");
    const auth = await this.probeAuth(baseUrl);
    if (!auth.reachable) throw new Error(auth.error || "Hermes gateway is unavailable");
    if (auth.authMode !== "oauth") throw new Error("This Hermes gateway uses session-token authentication");
    if (!auth.nativePkce) throw new Error("This Hermes gateway does not support native OAuth login");
    const redirectUri = new URL(redirectUriInput);
    if (redirectUri.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(redirectUri.hostname)) {
      throw new Error("Hermes OAuth callback must use the local ByBots Bridge");
    }
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorizationUrl = new URL(`${baseUrl}/auth/native/authorize`);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("redirect_uri", redirectUri.toString());
    authorizationUrl.searchParams.set("state", state);
    this.pruneOAuthFlows();
    this.pendingOAuth.set(state, { baseUrl, redirectUri: redirectUri.toString(), verifier, expiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
    return { authorizationUrl: authorizationUrl.toString() };
  }

  async completeOAuth({ code, state }: { code: string; state: string }) {
    const pending = this.pendingOAuth.get(state);
    this.pendingOAuth.delete(state);
    if (!pending || pending.expiresAt < Date.now()) throw new Error("Hermes OAuth authorization expired or is invalid");
    const response = await this.fetcher(`${pending.baseUrl}/auth/native/token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: pending.verifier }),
      signal: AbortSignal.timeout(DEFAULT_PROBE_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`Hermes OAuth token exchange failed (${response.status})`);
    const payload = await response.json() as { access_token?: unknown; refresh_token?: unknown; provider?: unknown; expires_at?: unknown };
    if (typeof payload.access_token !== "string" || !payload.access_token) throw new Error("Hermes OAuth did not return an access token");
    const connection = this.validateCredentials({
      baseUrl: pending.baseUrl,
      token: payload.access_token,
      authMode: "oauth",
      ...(typeof payload.refresh_token === "string" && payload.refresh_token ? { refreshToken: payload.refresh_token } : {}),
      ...(typeof payload.provider === "string" && payload.provider ? { provider: payload.provider } : {}),
      ...this.tokenExpiry(payload.expires_at)
    });
    const result = await this.probe(connection);
    await this.options.store.save(connection);
    this.version = result.version;
    this.activateConnection(connection, "saved");
    return { connection: this.view(), redirectUri: pending.redirectUri };
  }

  close() {
    this.closed = true;
    this.clearOAuthRefreshTimer();
    this.currentRuntime.close();
  }

  private async resolveInput(input: HermesConnectionInput) {
    const baseUrl = normalizeHermesUrl(input.baseUrl);
    const suppliedToken = input.token?.trim();
    let retained = baseUrl === this.currentConnection.baseUrl
      ? this.currentConnection
      : baseUrl === this.defaultConnection.baseUrl ? this.defaultConnection : undefined;
    if (!suppliedToken && baseUrl === this.defaultConnection.baseUrl) retained = await this.refreshDefaultConnection();
    const token = suppliedToken || retained?.token;
    if (!token) throw new Error("Hermes session token is required for a new gateway");
    return this.validateCredentials(suppliedToken ? { baseUrl, token } : { ...retained!, baseUrl, token });
  }

  private async refreshDefaultConnection() {
    const token = await this.resolveLocalToken(this.defaultConnection.baseUrl, this.defaultConnection.token);
    if (token === this.defaultConnection.token) return this.defaultConnection;
    this.defaultConnection = this.validateCredentials({ ...this.defaultConnection, token }, false);
    return this.defaultConnection;
  }

  private validateCredentials(connection: HermesConnectionCredentials, requireToken = true) {
    const baseUrl = normalizeHermesUrl(connection.baseUrl);
    const token = connection.token.trim();
    if (requireToken && !token) throw new Error("Hermes session token is required");
    if (token.length > 16_384) throw new Error("Hermes session token is too long");
    if ((connection.refreshToken?.length ?? 0) > 16_384 || (connection.provider?.length ?? 0) > 200) throw new Error("The saved Hermes OAuth session is invalid");
    if (connection.expiresAt !== undefined && (!Number.isFinite(connection.expiresAt) || connection.expiresAt <= 0)) throw new Error("The saved Hermes OAuth session is invalid");
    return {
      baseUrl,
      token,
      ...(connection.authMode === "oauth" ? { authMode: "oauth" as const } : {}),
      ...(connection.refreshToken ? { refreshToken: connection.refreshToken } : {}),
      ...(connection.provider ? { provider: connection.provider } : {}),
      ...(connection.expiresAt ? { expiresAt: Math.floor(connection.expiresAt) } : {})
    };
  }

  private activateConnection(connection: HermesConnectionCredentials, source: HermesConnectionView["source"], requiresReauthentication = false, refreshDelayOverride?: number) {
    this.clearOAuthRefreshTimer();
    const previous = this.currentRuntime;
    const next = this.createRuntime(connection);
    this.currentConnection = connection;
    this.currentRuntime = next;
    this.source = source;
    this.requiresReauthentication = requiresReauthentication;
    previous.close();
    if (!requiresReauthentication) this.scheduleOAuthRefresh(connection, refreshDelayOverride);
  }

  private view(): HermesConnectionView {
    return {
      baseUrl: this.currentConnection.baseUrl,
      defaultBaseUrl: this.defaultConnection.baseUrl,
      hasToken: Boolean(this.currentConnection.token) && !this.requiresReauthentication,
      authMode: this.currentConnection.authMode ?? "session",
      secure: isSecureHermesUrl(this.currentConnection.baseUrl),
      source: this.source,
      ...(this.version ? { version: this.version } : {}),
      ...(this.requiresReauthentication ? { requiresReauthentication: true } : {})
    };
  }

  private tokenExpiry(value: unknown) {
    const expiresAt = Number(value);
    return Number.isFinite(expiresAt) && expiresAt > 0 ? { expiresAt: Math.floor(expiresAt) } : {};
  }

  private oauthNeedsRefresh(connection: HermesConnectionCredentials) {
    return connection.authMode === "oauth" && (!connection.expiresAt || Date.now() >= connection.expiresAt * 1_000 - OAUTH_REFRESH_SKEW_MS);
  }

  private async refreshOAuthCredentials(connection: HermesConnectionCredentials) {
    if (connection.authMode !== "oauth" || !connection.refreshToken) throw new OAuthRefreshError("Hermes OAuth session must be connected again", 401);
    let response: Response;
    try {
      response = await this.fetcher(`${connection.baseUrl}/auth/native/refresh`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: connection.refreshToken, provider: connection.provider || "" }),
        signal: AbortSignal.timeout(DEFAULT_PROBE_TIMEOUT_MS)
      });
    } catch (cause) {
      throw new OAuthRefreshError(cause instanceof Error ? cause.message : String(cause));
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
      throw new OAuthRefreshError(String(payload?.detail || `Hermes OAuth refresh failed (${response.status})`), response.status);
    }
    const payload = await response.json() as { access_token?: unknown; refresh_token?: unknown; provider?: unknown; expires_at?: unknown };
    if (typeof payload.access_token !== "string" || !payload.access_token) throw new OAuthRefreshError("Hermes OAuth refresh did not return an access token");
    return this.validateCredentials({
      baseUrl: connection.baseUrl,
      token: payload.access_token,
      authMode: "oauth",
      refreshToken: typeof payload.refresh_token === "string" && payload.refresh_token ? payload.refresh_token : connection.refreshToken,
      provider: typeof payload.provider === "string" && payload.provider ? payload.provider : connection.provider,
      ...this.tokenExpiry(payload.expires_at)
    });
  }

  private scheduleOAuthRefresh(connection: HermesConnectionCredentials, delayOverride?: number) {
    if (this.closed || connection.authMode !== "oauth" || (delayOverride === undefined && !connection.expiresAt)) return;
    const delay = delayOverride ?? Math.max(0, connection.expiresAt! * 1_000 - Date.now() - OAUTH_REFRESH_SKEW_MS);
    this.oauthRefreshTimer = setTimeout(() => { void this.refreshCurrentOAuth(); }, Math.min(delay, MAX_TIMER_DELAY_MS));
    this.oauthRefreshTimer.unref?.();
  }

  private async refreshCurrentOAuth() {
    if (this.closed || this.oauthRefreshInFlight) return this.oauthRefreshInFlight;
    const expected = this.currentConnection;
    this.oauthRefreshInFlight = (async () => {
      if (expected.authMode !== "oauth") return;
      if (!this.oauthNeedsRefresh(expected)) {
        this.scheduleOAuthRefresh(expected);
        return;
      }
      if (!expected.refreshToken) {
        if (this.currentConnection === expected) this.requiresReauthentication = true;
        return;
      }
      try {
        const refreshed = await this.refreshOAuthCredentials(expected);
        if (this.currentConnection !== expected || this.closed) return;
        await this.options.store.save(refreshed);
        if (this.currentConnection === expected && !this.closed) this.activateConnection(refreshed, "saved");
      } catch (cause) {
        if (this.currentConnection !== expected || this.closed) return;
        if (cause instanceof OAuthRefreshError && cause.status === 401) {
          this.requiresReauthentication = true;
          this.clearOAuthRefreshTimer();
        } else {
          this.scheduleOAuthRefresh(expected, OAUTH_REFRESH_RETRY_MS);
        }
      }
    })().finally(() => { this.oauthRefreshInFlight = null; });
    return this.oauthRefreshInFlight;
  }

  private clearOAuthRefreshTimer() {
    if (this.oauthRefreshTimer) clearTimeout(this.oauthRefreshTimer);
    this.oauthRefreshTimer = undefined;
  }

  private pruneOAuthFlows() {
    const now = Date.now();
    for (const [state, pending] of this.pendingOAuth) if (pending.expiresAt < now) this.pendingOAuth.delete(state);
  }
}
