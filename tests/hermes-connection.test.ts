import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FileHermesConnectionStore, HermesConnectionManager, normalizeHermesUrl, type HermesConnectionCredentials, type HermesConnectionStore } from "../server/hermes-connection";
import { HermesGateway } from "../server/hermes-gateway";

function memoryStore(saved?: HermesConnectionCredentials): HermesConnectionStore & { save: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> } {
  return {
    load: vi.fn().mockResolvedValue(saved),
    save: vi.fn().mockImplementation(async (connection) => { saved = connection; }),
    clear: vi.fn().mockImplementation(async () => { saved = undefined; })
  };
}

function runtimeFactory(created: string[], closed: string[]) {
  return (connection: HermesConnectionCredentials) => {
    created.push(connection.baseUrl);
    return {
      hermes: {
        listBots: vi.fn().mockResolvedValue([{ name: connection.baseUrl, system: false }]),
        createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn()
      },
      chat: { getConversation: vi.fn(), sendMessage: vi.fn() },
      groups: { listGroups: vi.fn().mockResolvedValue([]), createGroup: vi.fn(), sendMessage: vi.fn() },
      close: () => closed.push(connection.baseUrl)
    };
  };
}

describe("Hermes connection management", () => {
  it("allows slow initial health and gateway checks without an eight-second outer cutoff", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      setTimeout(() => resolve(new Response(JSON.stringify({ ok: true, version: "fixture" }))), 9_000);
    })));
    const request = vi.spyOn(HermesGateway.prototype, "request").mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve({ profiles: [] }), 9_000);
    }));
    const manager = new HermesConnectionManager({
      defaultConnection: { baseUrl: "http://127.0.0.1:9120", token: "fixture-token" },
      store: memoryStore(), createRuntime: runtimeFactory([], [])
    });
    try {
      const pending = expect(manager.testConnection({ baseUrl: "http://127.0.0.1:9120" })).resolves.toMatchObject({ version: "fixture" });
      await vi.advanceTimersByTimeAsync(18_000);
      await pending;
      expect(request).toHaveBeenCalledWith("profiles.list", {}, 15_000);
    } finally {
      manager.close();
      request.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("normalizes supported gateway URLs and rejects embedded credentials", () => {
    expect(normalizeHermesUrl(" https://hermes.example.test/base/ ")).toBe("https://hermes.example.test/base");
    expect(() => normalizeHermesUrl("ftp://hermes.example.test")).toThrow("HTTP or HTTPS");
    expect(() => normalizeHermesUrl("https://user:pass@hermes.example.test")).toThrow("Do not include credentials");
    expect(() => normalizeHermesUrl("https://hermes.example.test?token=hidden")).toThrow("query or fragment");
  });

  it("tests before atomically switching the live Hermes services", async () => {
    const created: string[] = [];
    const closed: string[] = [];
    const store = memoryStore();
    const probe = vi.fn().mockResolvedValue({ version: "0.21.7" });
    const manager = new HermesConnectionManager({
      defaultConnection: { baseUrl: "http://127.0.0.1:9120", token: "development-session" },
      store,
      probe,
      createRuntime: runtimeFactory(created, closed)
    });

    const next = await manager.updateConnection({ baseUrl: "https://hermes.example.test", token: "remote-session" });

    expect(probe).toHaveBeenCalledWith({ baseUrl: "https://hermes.example.test", token: "remote-session" });
    expect(probe.mock.invocationCallOrder[0]).toBeLessThan(store.save.mock.invocationCallOrder[0]);
    expect(next).toMatchObject({ baseUrl: "https://hermes.example.test", source: "saved", secure: true, version: "0.21.7", hasToken: true });
    expect(created).toEqual(["http://127.0.0.1:9120", "https://hermes.example.test"]);
    expect(closed).toEqual(["http://127.0.0.1:9120"]);
    expect(await manager.hermes.listBots()).toEqual([{ name: "https://hermes.example.test", system: false }]);
    manager.close();
  });

  it("preserves the current token only for the same URL and restores the environment default", async () => {
    const store = memoryStore({ baseUrl: "https://saved.example.test", token: "saved-session" });
    const probe = vi.fn().mockResolvedValue({ version: "0.21.0" });
    const manager = new HermesConnectionManager({
      defaultConnection: { baseUrl: "http://127.0.0.1:9120", token: "default-session" },
      store,
      probe,
      createRuntime: runtimeFactory([], [])
    });
    await manager.initialize();

    await manager.testConnection({ baseUrl: "https://saved.example.test" });
    await expect(manager.testConnection({ baseUrl: "https://other.example.test" })).rejects.toThrow("token is required");
    const reset = await manager.resetConnection();

    expect(probe).toHaveBeenNthCalledWith(1, { baseUrl: "https://saved.example.test", token: "saved-session" });
    expect(probe).toHaveBeenNthCalledWith(2, { baseUrl: "http://127.0.0.1:9120", token: "default-session" });
    expect(store.clear).toHaveBeenCalledOnce();
    expect(reset).toMatchObject({ baseUrl: "http://127.0.0.1:9120", source: "environment" });
    manager.close();
  });

  it("refreshes the local token when Hermes starts or restarts after ByBots", async () => {
    const store = memoryStore({ baseUrl: "https://saved.example.test", token: "saved-session" });
    const probe = vi.fn().mockResolvedValue({ version: "0.21.0" });
    const resolveLocalToken = vi.fn().mockResolvedValue("fresh-local-session");
    const manager = new HermesConnectionManager({
      defaultConnection: { baseUrl: "http://127.0.0.1:9120", token: "" },
      store,
      probe,
      resolveLocalToken,
      createRuntime: runtimeFactory([], [])
    });
    await manager.initialize();

    await expect(manager.testConnection({ baseUrl: "http://127.0.0.1:9120" })).resolves.toMatchObject({ version: "0.21.0" });
    await expect(manager.resetConnection()).resolves.toMatchObject({ baseUrl: "http://127.0.0.1:9120", hasToken: true, source: "environment" });
    expect(resolveLocalToken).toHaveBeenCalledWith("http://127.0.0.1:9120", "");
    expect(probe).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:9120", token: "fresh-local-session" });
    manager.close();
  });

  it("allows first-time gateway setup when the default Bridge has no session token", async () => {
    const store = memoryStore();
    const manager = new HermesConnectionManager({
      defaultConnection: { baseUrl: "http://127.0.0.1:9120", token: "" },
      store,
      probe: vi.fn().mockResolvedValue({ version: "0.21.0" }),
      createRuntime: runtimeFactory([], [])
    });

    expect(await manager.getConnection()).toMatchObject({ hasToken: false, source: "environment" });
    await expect(manager.testConnection({ baseUrl: "https://hermes.example.test" })).rejects.toThrow("token is required");
    await expect(manager.updateConnection({ baseUrl: "https://hermes.example.test", token: "first-session" })).resolves.toMatchObject({ hasToken: true, source: "saved" });
    manager.close();
  });

  it("persists the gateway credential in the private Bridge configuration file", async () => {
    const folder = await mkdtemp(join(tmpdir(), "byfinity-connection-test-"));
    const path = join(folder, "connection.json");
    const store = new FileHermesConnectionStore(path);
    try {
      await store.save({ baseUrl: "https://hermes.example.test", token: "stored-session" });
      expect(await store.load()).toEqual({ baseUrl: "https://hermes.example.test", token: "stored-session" });
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 2 });
      await store.save({ baseUrl: "https://second.example.test", token: "second-session" });
      expect(await store.load()).toEqual({ baseUrl: "https://second.example.test", token: "second-session" });
      await store.save({ baseUrl: "https://oauth.example.test", token: "access", authMode: "oauth", refreshToken: "refresh", provider: "nous", expiresAt: 2_000_000_000 });
      expect(await store.load()).toEqual({ baseUrl: "https://oauth.example.test", token: "access", authMode: "oauth", refreshToken: "refresh", provider: "nous", expiresAt: 2_000_000_000 });
      await store.clear();
      expect(await store.load()).toBeUndefined();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("completes a PKCE OAuth flow before saving and switching gateways", async () => {
    const store = memoryStore();
    const probe = vi.fn().mockResolvedValue({ version: "0.21.4" });
    const fetcher = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/status")) return new Response(JSON.stringify({ auth_required: true, auth_flows: ["native_pkce"], version: "0.21.4" }), { status: 200 });
      if (url.endsWith("/api/auth/providers")) return new Response(JSON.stringify({ providers: [{ name: "nous", display_name: "Nous Research", supports_password: false }] }), { status: 200 });
      return new Response(JSON.stringify({ access_token: "oauth-access", refresh_token: "oauth-refresh", provider: "nous", expires_at: 2_000_000_000 }), { status: 200 });
    });
    const manager = new HermesConnectionManager({
      defaultConnection: { baseUrl: "http://127.0.0.1:9120", token: "local-session" },
      store, probe, fetcher, createRuntime: runtimeFactory([], [])
    });

    const auth = await manager.probeAuth("https://hermes.example.test");
    expect(auth).toMatchObject({ reachable: true, authMode: "oauth", nativePkce: true, providers: [{ name: "nous", displayName: "Nous Research" }] });

    const started = await manager.startOAuth("https://hermes.example.test", "http://127.0.0.1:5188/api/hermes/connection/oauth/callback");
    const authorization = new URL(started.authorizationUrl);
    expect(authorization.pathname).toBe("/auth/native/authorize");
    expect(authorization.searchParams.has("provider")).toBe(false);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const state = authorization.searchParams.get("state")!;
    const completed = await manager.completeOAuth({ code: "one-time-code", state });

    expect(fetcher).toHaveBeenCalledWith("https://hermes.example.test/auth/native/token", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"code":"one-time-code"')
    }));
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "https://hermes.example.test", token: "oauth-access", authMode: "oauth", refreshToken: "oauth-refresh", expiresAt: 2_000_000_000 }));
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ authMode: "oauth", token: "oauth-access" }));
    expect(completed).toMatchObject({ connection: { baseUrl: "https://hermes.example.test", authMode: "oauth", source: "saved" }, redirectUri: "http://127.0.0.1:5188/api/hermes/connection/oauth/callback" });
    await expect(manager.completeOAuth({ code: "replay", state })).rejects.toThrow("expired or is invalid");
    manager.close();
  });

  it("refreshes an expired saved OAuth session before restoring the remote runtime", async () => {
    const created: string[] = [];
    const closed: string[] = [];
    const store = memoryStore({ baseUrl: "https://hermes.example.test", token: "expired-access", authMode: "oauth", refreshToken: "refresh-one", provider: "nous", expiresAt: 1 });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "fresh-access", refresh_token: "refresh-two", provider: "nous", expires_at: 2_000_000_000 }), { status: 200 }));
    const manager = new HermesConnectionManager({
      defaultConnection: { baseUrl: "http://127.0.0.1:9120", token: "local-session" },
      store, fetcher, createRuntime: runtimeFactory(created, closed)
    });

    await manager.initialize();

    expect(fetcher).toHaveBeenCalledWith("https://hermes.example.test/auth/native/refresh", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ refresh_token: "refresh-one", provider: "nous" })
    }));
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ token: "fresh-access", refreshToken: "refresh-two", expiresAt: 2_000_000_000 }));
    expect(await manager.getConnection()).toMatchObject({ baseUrl: "https://hermes.example.test", authMode: "oauth", hasToken: true, source: "saved" });
    expect(created).toEqual(["http://127.0.0.1:9120", "https://hermes.example.test"]);
    manager.close();
  });

  it("marks a rejected OAuth refresh for an explicit sign-in instead of retrying a dead session", async () => {
    const store = memoryStore({ baseUrl: "https://hermes.example.test", token: "expired-access", authMode: "oauth", refreshToken: "dead-refresh", provider: "nous", expiresAt: 1 });
    const manager = new HermesConnectionManager({
      defaultConnection: { baseUrl: "http://127.0.0.1:9120", token: "local-session" },
      store,
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "session_expired", detail: "Refresh token expired or invalid; start a new sign-in." }), { status: 401 })),
      createRuntime: runtimeFactory([], [])
    });

    await manager.initialize();

    expect(await manager.getConnection()).toMatchObject({ baseUrl: "https://hermes.example.test", authMode: "oauth", hasToken: false, requiresReauthentication: true });
    expect(store.save).not.toHaveBeenCalled();
    manager.close();
  });

  it("rotates OAuth credentials in the background before the access token expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T12:00:00.000Z"));
    const store = memoryStore({ baseUrl: "https://hermes.example.test", token: "access-one", authMode: "oauth", refreshToken: "refresh-one", provider: "nous", expiresAt: Math.floor(Date.now() / 1_000) + 62 });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "access-two", refresh_token: "refresh-two", provider: "nous", expires_at: Math.floor(Date.now() / 1_000) + 3_600 }), { status: 200 }));
    const manager = new HermesConnectionManager({
      defaultConnection: { baseUrl: "http://127.0.0.1:9120", token: "local-session" },
      store, fetcher, createRuntime: runtimeFactory([], [])
    });
    try {
      await manager.initialize();
      expect(fetcher).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_100);

      expect(fetcher).toHaveBeenCalledOnce();
      expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ token: "access-two", refreshToken: "refresh-two" }));
      expect(await manager.getConnection()).toMatchObject({ hasToken: true, authMode: "oauth" });
    } finally {
      manager.close();
      vi.useRealTimers();
    }
  });
});
