import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";

describe("Byfinity Bridge API", () => {
  it("rejects DNS-rebinding hosts and cross-site origins in tokenless local mode", async () => {
    const hermes = {
      listBots: vi.fn().mockResolvedValue([]),
      createBot: vi.fn().mockResolvedValue({ name: "analyst", system: false }),
      deleteBot: vi.fn(),
      getBotUsage: vi.fn()
    };
    const app = createApp({ hermes });

    const reboundRead = await app.inject({ method: "GET", url: "/api/access", headers: { host: "attacker.invalid:4179", origin: "http://attacker.invalid:4179" } });
    const crossSiteMutation = await app.inject({ method: "POST", url: "/api/bots", headers: { host: "127.0.0.1:4179", origin: "https://attacker.invalid" }, payload: { name: "analyst" } });
    const localCli = await app.inject({ method: "GET", url: "/api/access", headers: { host: "127.0.0.1:4179", "x-forwarded-host": "attacker.invalid" } });
    const localBrowser = await app.inject({ method: "GET", url: "/api/access", headers: { host: "127.0.0.1:4179", origin: "http://127.0.0.1:5188" } });
    const ipv6Browser = await app.inject({ method: "GET", url: "/api/access", headers: { host: "[::1]:4179", origin: "http://[::1]:5188" } });

    expect(reboundRead.statusCode).toBe(421);
    expect(crossSiteMutation.statusCode).toBe(403);
    expect(hermes.createBot).not.toHaveBeenCalled();
    expect(localCli.statusCode).toBe(200);
    expect(localBrowser.statusCode).toBe(200);
    expect(ipv6Browser.statusCode).toBe(200);
    expect(localBrowser.json()).toEqual({ role: "admin" });
    await app.close();
  });

  it("exposes the dynamic fleet and per-bot usage", async () => {
    const hermes = {
      listBots: vi.fn().mockResolvedValue([{ name: "default", system: true }, { name: "finance", system: false }]),
      createBot: vi.fn(),
      deleteBot: vi.fn(),
      getBotUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 900, estimatedCostUsd: 0.12 })
    };
    const app = createApp({ hermes });

    const fleet = await app.inject({ method: "GET", url: "/api/bots" });
    const usage = await app.inject({ method: "GET", url: "/api/bots/finance/usage?days=7" });

    expect(fleet.statusCode).toBe(200);
    expect(fleet.json()).toEqual({ bots: [{ name: "default", system: true }, { name: "finance", system: false }] });
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toMatchObject({ bot: "finance", totalTokens: 900, estimatedCostUsd: 0.12 });
    expect(hermes.getBotUsage).toHaveBeenCalledWith("finance", 7);
    await app.close();
  });

  it("creates and deletes non-system bots through narrow routes", async () => {
    const hermes = {
      listBots: vi.fn(),
      createBot: vi.fn().mockResolvedValue({ name: "analyst", system: false }),
      deleteBot: vi.fn().mockResolvedValue(undefined),
      getBotUsage: vi.fn()
    };
    const app = createApp({ hermes });

    const created = await app.inject({
      method: "POST",
      url: "/api/bots",
      payload: { name: "analyst" }
    });
    const deleted = await app.inject({ method: "DELETE", url: "/api/bots/analyst" });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ bot: { name: "analyst", system: false } });
    expect(deleted.statusCode).toBe(204);
    expect(hermes.createBot).toHaveBeenCalledWith({ name: "analyst" });
    expect(hermes.deleteBot).toHaveBeenCalledWith("analyst");
    await app.close();
  });

  it("downloads and uploads bounded Hermes Bot archives", async () => {
    const hermes = {
      listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn(),
      exportBot: vi.fn().mockResolvedValue({ data: new Uint8Array([0x1f, 0x8b, 1]), filename: "finance.tar.gz" }),
      importBot: vi.fn().mockResolvedValue({ name: "research-copy", title: "Research", system: false })
    };
    const app = createApp({ hermes });

    const exported = await app.inject({ method: "POST", url: "/api/bots/finance/export" });
    const imported = await app.inject({
      method: "POST",
      url: "/api/bots/import?name=research-copy",
      headers: { "content-type": "application/gzip" },
      payload: Buffer.from([0x1f, 0x8b, 1])
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/api/bots/import",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("not a gzip archive")
    });

    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-disposition"]).toBe("attachment; filename=\"finance.tar.gz\"");
    expect(exported.rawPayload).toEqual(Buffer.from([0x1f, 0x8b, 1]));
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toEqual({ bot: { name: "research-copy", title: "Research", system: false } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { reason: "invalid_request", retryable: false } });
    expect(hermes.importBot).toHaveBeenCalledWith(new Uint8Array([0x1f, 0x8b, 1]), "research-copy");
    await app.close();
  });

  it("tests, switches, and resets the Hermes gateway without exposing its token", async () => {
    const hermes = { listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn() };
    const connection = {
      getConnection: vi.fn().mockResolvedValue({ baseUrl: "http://127.0.0.1:9120", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, secure: true, source: "environment" }),
      testConnection: vi.fn().mockResolvedValue({ baseUrl: "https://hermes.example.test", secure: true, version: "0.21.4" }),
      updateConnection: vi.fn().mockResolvedValue({ baseUrl: "https://hermes.example.test", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, secure: true, source: "saved", version: "0.21.4" }),
      resetConnection: vi.fn().mockResolvedValue({ baseUrl: "http://127.0.0.1:9120", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, secure: true, source: "environment", version: "0.21.4" })
    };
    const app = createApp({ hermes, connection });

    const current = await app.inject({ method: "GET", url: "/api/hermes/connection" });
    const tested = await app.inject({ method: "POST", url: "/api/hermes/connection/test", payload: { baseUrl: "https://hermes.example.test", token: "candidate-session" } });
    const updated = await app.inject({ method: "PUT", url: "/api/hermes/connection", payload: { baseUrl: "https://hermes.example.test", token: "candidate-session" } });
    const reset = await app.inject({ method: "DELETE", url: "/api/hermes/connection" });

    expect(current.json()).not.toHaveProperty("connection.token");
    expect(tested.json()).toMatchObject({ probe: { version: "0.21.4" } });
    expect(updated.json()).toMatchObject({ connection: { source: "saved" } });
    expect(reset.json()).toMatchObject({ connection: { source: "environment" } });
    expect(connection.testConnection).toHaveBeenCalledWith({ baseUrl: "https://hermes.example.test", token: "candidate-session" });
    await app.close();
  });

  it("starts and completes remote Hermes OAuth without exposing the authorization code", async () => {
    const hermes = { listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn() };
    const connection = {
      getConnection: vi.fn(), testConnection: vi.fn(), updateConnection: vi.fn(), resetConnection: vi.fn(),
      probeAuth: vi.fn().mockResolvedValue({ baseUrl: "https://hermes.example.test", reachable: true, authMode: "oauth", nativePkce: true, providers: [{ name: "nous", displayName: "Nous Research", supportsPassword: false }] }),
      startOAuth: vi.fn().mockResolvedValue({ authorizationUrl: "https://hermes.example.test/auth/native/authorize?state=opaque" }),
      completeOAuth: vi.fn().mockResolvedValue({ connection: { baseUrl: "https://hermes.example.test", authMode: "oauth" }, redirectUri: "http://127.0.0.1:5188/api/hermes/connection/oauth/callback" })
    };
    const app = createApp({ hermes, connection, accessTokens: { admin: "admin-token" } });

    const denied = await app.inject({ method: "POST", url: "/api/hermes/connection/oauth/start", payload: { baseUrl: "https://hermes.example.test" } });
    const detected = await app.inject({ method: "POST", url: "/api/hermes/connection/auth", headers: { authorization: "Bearer admin-token" }, payload: { baseUrl: "https://hermes.example.test" } });
    const started = await app.inject({ method: "POST", url: "/api/hermes/connection/oauth/start", headers: { authorization: "Bearer admin-token" }, payload: { baseUrl: "https://hermes.example.test", appOrigin: "http://127.0.0.1:5188" } });
    const completed = await app.inject({ method: "GET", url: "/api/hermes/connection/oauth/callback?code=secret-code&state=opaque-state" });

    expect(denied.statusCode).toBe(401);
    expect(detected.json()).toMatchObject({ auth: { authMode: "oauth", providers: [{ displayName: "Nous Research" }] } });
    expect(connection.probeAuth).toHaveBeenCalledWith("https://hermes.example.test");
    expect(started.json()).toEqual({ authorizationUrl: "https://hermes.example.test/auth/native/authorize?state=opaque" });
    expect(connection.startOAuth).toHaveBeenCalledWith("https://hermes.example.test", "http://127.0.0.1:5188/api/hermes/connection/oauth/callback");
    expect(connection.completeOAuth).toHaveBeenCalledWith({ code: "secret-code", state: "opaque-state" });
    expect(completed.statusCode).toBe(302);
    expect(completed.headers.location).toBe("http://127.0.0.1:5188/?hermesOauth=success");
    expect(completed.body).not.toContain("secret-code");
    await app.close();
  });

  it("reports Bridge, Hermes, authentication, and version compatibility without exposing credentials", async () => {
    const hermes = { listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn() };
    const connection = {
      getConnection: vi.fn().mockResolvedValue({ baseUrl: "https://hermes.example.test", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, secure: true, source: "saved" }),
      testConnection: vi.fn().mockResolvedValue({ baseUrl: "https://hermes.example.test", secure: true, version: "0.21.4" }),
      updateConnection: vi.fn(), resetConnection: vi.fn()
    };
    const app = createApp({ hermes, connection, bridgeVersion: "0.2.0" });

    const response = await app.inject({ method: "GET", url: "/api/diagnostics" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      supportedHermes: "0.21.x",
      bridge: { status: "ready", version: "0.2.0" },
      hermes: { status: "ready", version: "0.21.4", compatible: true },
      authentication: { status: "ready" }
    });
    expect(response.body).not.toContain("token");
    await app.close();
  });

  it("builds diagnostics exports from a strict privacy-safe allowlist", async () => {
    const hermes = { listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn() };
    const connection = {
      getConnection: vi.fn().mockResolvedValue({ baseUrl: "https://private.example.test:9443/hermes", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, secure: true, source: "saved" }),
      testConnection: vi.fn().mockResolvedValue({ baseUrl: "https://private.example.test:9443/hermes", secure: true, version: "0.21.4" }),
      updateConnection: vi.fn(), resetConnection: vi.fn()
    };
    const app = createApp({ hermes, connection, bridgeVersion: "0.2.0" });

    const response = await app.inject({ method: "GET", url: "/api/diagnostics/report" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 1,
      application: { name: "ByBots", version: "0.2.0" },
      connection: { target: "remote", transport: "https", secure: true },
      support: { hermes: "0.21.x" },
      checks: {
        bridge: { status: "ready", version: "0.2.0" },
        hermes: { status: "ready", version: "0.21.4", compatible: true },
        authentication: { status: "ready" }
      }
    });
    expect(response.body).not.toContain("private.example.test");
    expect(response.body).not.toContain("9443");
    expect(response.body).not.toContain("baseUrl");
    expect(response.body).not.toContain("hasToken");
    await app.close();
  });

  it("turns a missing Hermes session into a first-run diagnostic instead of an API error", async () => {
    const hermes = { listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn() };
    const connection = {
      getConnection: vi.fn().mockResolvedValue({ baseUrl: "http://127.0.0.1:9120", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: false, secure: true, source: "environment" }),
      testConnection: vi.fn(), updateConnection: vi.fn(), resetConnection: vi.fn()
    };
    const app = createApp({ hermes, connection });

    const response = await app.inject({ method: "GET", url: "/api/diagnostics" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      hermes: { status: "warning" },
      authentication: { status: "error", detail: "Hermes session token is required" }
    });
    expect(connection.testConnection).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns Hermes profile validation failures as actionable 400 responses", async () => {
    const hermes = {
      listBots: vi.fn(),
      createBot: vi.fn().mockRejectedValue(new Error("Profile 'analyst' already exists")),
      deleteBot: vi.fn(),
      getBotUsage: vi.fn()
    };
    const app = createApp({ hermes });

    const response = await app.inject({
      method: "POST",
      url: "/api/bots",
      payload: { name: "analyst", description: "Analyse les données." }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { reason: "invalid_request", retryable: false, detail: "Profile 'analyst' already exists" } });
    await app.close();
  });

  it("updates a Bot avatar through Hermes metadata", async () => {
    const hermes = {
      listBots: vi.fn(),
      createBot: vi.fn(),
      deleteBot: vi.fn(),
      updateBotAvatar: vi.fn().mockResolvedValue(undefined),
      getBotUsage: vi.fn()
    };
    const app = createApp({ hermes });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/bots/analyst/avatar",
      payload: { shape: "blobatar:seed:round", color: "#7170ff" }
    });

    expect(response.statusCode).toBe(204);
    expect(hermes.updateBotAvatar).toHaveBeenCalledWith("analyst", {
      shape: "blobatar:seed:round",
      color: "#7170ff"
    });
    await app.close();
  });

  it("exposes Hermes Petdex entries for avatar selection", async () => {
    const pets = [{ slug: "pixel-fox", displayName: "Pixel Fox", spritesheetUrl: "https://pets.test/fox.webp" }];
    const hermes = {
      listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn(),
      listAvatarPets: vi.fn().mockResolvedValue(pets)
    };
    const app = createApp({ hermes });

    const response = await app.inject({ method: "GET", url: "/api/avatar-pets" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ pets: [{ ...pets[0], spritesheetUrl: "/api/avatar-pets/pixel-fox/sprite" }] });
    await app.close();
  });

  it("proxies trusted Hermes pet sprites through the local Bridge", async () => {
    const hermes = {
      listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn(),
      getAvatarPetSprite: vi.fn().mockResolvedValue({ data: new Uint8Array([1, 2, 3]), contentType: "image/webp" })
    };
    const app = createApp({ hermes });

    const response = await app.inject({ method: "GET", url: "/api/avatar-pets/pixel-fox/sprite" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/webp");
    expect(response.rawPayload).toEqual(Buffer.from([1, 2, 3]));
    await app.close();
  });

  it("reads and updates the complete Bot configuration through narrow routes", async () => {
    const configuration = { bot: "finance", provider: "openai-codex", model: "gpt-5.6-terra", soul: "", skills: [], toolsets: [], mcpServers: [], providers: [] };
    const hermes = {
      listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn(),
      getBotConfiguration: vi.fn().mockResolvedValue(configuration),
      updateBot: vi.fn().mockResolvedValue({ applied: { skills: true }, confirmRequired: false })
    };
    const app = createApp({ hermes });

    const loaded = await app.inject({ method: "GET", url: "/api/bots/finance/config" });
    const updated = await app.inject({
      method: "PATCH",
      url: "/api/bots/finance",
      payload: { title: "Finance", disabledSkills: ["email"], enabledToolsets: ["file"], enabledMcpServers: ["neon"] }
    });

    expect(loaded.json()).toEqual(configuration);
    expect(updated.statusCode).toBe(200);
    expect(hermes.updateBot).toHaveBeenCalledWith("finance", {
      title: "Finance", disabledSkills: ["email"], enabledToolsets: ["file"], enabledMcpServers: ["neon"]
    });
    await app.close();
  });

  it("tests an installed MCP server through a bounded Bridge response", async () => {
    const test = { server: "filesystem", toolCount: 2, tools: ["read_file", "write_file"] };
    const hermes = {
      listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn(),
      testMcpServer: vi.fn().mockResolvedValue(test)
    };
    const app = createApp({ hermes });

    const response = await app.inject({ method: "POST", url: "/api/bots/finance/mcp/filesystem/test" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ test });
    expect(hermes.testMcpServer).toHaveBeenCalledWith("finance", "filesystem");
    await app.close();
  });

  it("requires a bearer token when remote access is enabled", async () => {
    const hermes = {
      listBots: vi.fn().mockResolvedValue([]),
      createBot: vi.fn(),
      deleteBot: vi.fn(),
      getBotUsage: vi.fn()
    };
    const app = createApp({ hermes, remoteToken: "secret-device-token" });

    const denied = await app.inject({ method: "GET", url: "/api/bots" });
    const allowed = await app.inject({
      method: "GET",
      url: "/api/bots",
      headers: { authorization: "Bearer secret-device-token" }
    });

    expect(denied.statusCode).toBe(401);
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it("enforces viewer and operator permissions at the Bridge boundary", async () => {
    const hermes = { listBots: vi.fn().mockResolvedValue([]), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn(), exportBot: vi.fn(), importBot: vi.fn(), testMcpServer: vi.fn().mockResolvedValue({ server: "filesystem", toolCount: 1, tools: ["read_file"] }) };
    const chat = { getConversation: vi.fn(), sendMessage: vi.fn().mockResolvedValue({ bot: "finance", messages: [] }) };
    const connection = { getConnection: vi.fn().mockResolvedValue({ baseUrl: "https://private.example.test" }), testConnection: vi.fn(), updateConnection: vi.fn(), resetConnection: vi.fn() };
    const app = createApp({ hermes, chat, connection, accessTokens: { admin: "admin-token", operator: "operator-token", viewer: "viewer-token" } });
    const viewerHeaders = { authorization: "Bearer viewer-token" };
    const operatorHeaders = { authorization: "Bearer operator-token" };
    const adminHeaders = { authorization: "Bearer admin-token" };

    expect((await app.inject({ method: "GET", url: "/api/access", headers: viewerHeaders })).json()).toEqual({ role: "viewer" });
    const viewerWrite = await app.inject({ method: "POST", url: "/api/bots", headers: viewerHeaders, payload: { name: "new-bot", description: "Test" } });
    expect(viewerWrite.statusCode).toBe(403);
    expect(viewerWrite.json()).toMatchObject({ error: { reason: "access_denied" } });

    expect((await app.inject({ method: "GET", url: "/api/access", headers: operatorHeaders })).json()).toEqual({ role: "operator" });
    expect((await app.inject({ method: "POST", url: "/api/bots/finance/messages", headers: operatorHeaders, payload: { text: "Bonjour" } })).statusCode).toBe(202);
    expect((await app.inject({ method: "POST", url: "/api/bots", headers: operatorHeaders, payload: { name: "new-bot", description: "Test" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/bots/finance/export", headers: operatorHeaders })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/bots/finance/mcp/filesystem/test", headers: operatorHeaders })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/bots/finance/mcp/filesystem/test", headers: adminHeaders })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/bots/import", headers: { ...viewerHeaders, "content-type": "application/gzip" }, payload: Buffer.from([0x1f, 0x8b]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/hermes/connection", headers: viewerHeaders })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/hermes/connection", headers: operatorHeaders })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/hermes/connection", headers: adminHeaders })).statusCode).toBe(200);
    await app.close();
  });

  it("returns a stable typed Hermes failure contract", async () => {
    const failure = Object.assign(new Error("429 too many requests"), { data: { reason: "provider_rate_limit", retryable: true } });
    const hermes = {
      listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      getBotUsage: vi.fn().mockRejectedValue(failure)
    };
    const app = createApp({ hermes });

    const response = await app.inject({ method: "GET", url: "/api/bots/finance/usage" });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      error: {
        reason: "provider_rate_limit",
        title: "Too many requests",
        retryable: true,
        action: "wait"
      }
    });
    await app.close();
  });

  it("exposes native Hermes routines and their durable run history", async () => {
    const routine = { id: "job-1", bot: "finance", name: "Rapport", prompt: "Prépare le rapport", schedule: "0 9 * * *", scheduleDisplay: "Tous les jours", enabled: true, state: "scheduled" };
    const hermes = {
      listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn(),
      listBotRoutines: vi.fn().mockResolvedValue([routine]),
      createBotRoutine: vi.fn().mockResolvedValue(routine),
      setBotRoutineEnabled: vi.fn().mockResolvedValue({ ...routine, enabled: false }),
      runBotRoutine: vi.fn().mockResolvedValue(routine),
      deleteBotRoutine: vi.fn().mockResolvedValue(undefined),
      listBotRoutineRuns: vi.fn().mockResolvedValue([{ id: "run-1", startedAt: 1, status: "success", output: "Terminé" }])
    };
    const app = createApp({ hermes });

    expect((await app.inject({ method: "GET", url: "/api/bots/finance/routines" })).json()).toMatchObject({ routines: [{ id: "job-1" }] });
    expect((await app.inject({ method: "POST", url: "/api/bots/finance/routines", payload: { name: "Rapport", prompt: "Prépare le rapport", schedule: "0 9 * * *" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "PATCH", url: "/api/bots/finance/routines/job-1", payload: { enabled: false } })).json()).toMatchObject({ routine: { enabled: false } });
    expect((await app.inject({ method: "POST", url: "/api/bots/finance/routines/job-1/run" })).statusCode).toBe(202);
    expect((await app.inject({ method: "GET", url: "/api/bots/finance/routines/job-1/runs" })).json()).toMatchObject({ runs: [{ output: "Terminé" }] });
    expect((await app.inject({ method: "DELETE", url: "/api/bots/finance/routines/job-1" })).statusCode).toBe(204);
    expect(hermes.createBotRoutine).toHaveBeenCalledWith("finance", { name: "Rapport", prompt: "Prépare le rapport", schedule: "0 9 * * *" });
    await app.close();
  });

  it("exposes the canonical bot conversation and accepts a message", async () => {
    const hermes = { listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn() };
    const chat = {
      getConversation: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: false, messages: [] }),
      sendMessage: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: true, messages: [{ role: "user", text: "Bonjour" }] })
    };
    const app = createApp({ hermes, chat });

    const loaded = await app.inject({ method: "GET", url: "/api/bots/finance/conversation" });
    const sent = await app.inject({ method: "POST", url: "/api/bots/finance/messages", payload: { text: "Bonjour" } });

    expect(loaded.json()).toMatchObject({ bot: "finance", sessionId: "s1" });
    expect(sent.statusCode).toBe(202);
    expect(chat.sendMessage).toHaveBeenCalledWith("finance", "Bonjour");
    await app.close();
  });

  it("exposes native Hermes thread lifecycle routes", async () => {
    const hermes = { listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn() };
    const conversation = { bot: "finance", sessionId: "thread-1", running: false, messages: [] };
    const thread = { id: "thread-1", bot: "finance", title: "Budget", preview: "", startedAt: 1, messageCount: 0, running: false };
    const chat = {
      getConversation: vi.fn(), sendMessage: vi.fn(),
      listThreads: vi.fn().mockResolvedValue([thread]),
      createThread: vi.fn().mockResolvedValue(conversation),
      getThread: vi.fn().mockResolvedValue(conversation),
      sendThreadMessage: vi.fn().mockResolvedValue({ ...conversation, running: true }),
      renameThread: vi.fn().mockResolvedValue({ ...thread, title: "Forecast" }),
      archiveThread: vi.fn().mockResolvedValue(undefined)
    };
    const app = createApp({ hermes, chat });

    expect((await app.inject({ method: "GET", url: "/api/bots/finance/threads" })).json()).toEqual({ threads: [thread] });
    expect((await app.inject({ method: "POST", url: "/api/bots/finance/threads", payload: { title: "Budget" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/api/bots/finance/threads/thread-1" })).json()).toEqual(conversation);
    expect((await app.inject({ method: "POST", url: "/api/bots/finance/threads/thread-1/messages", payload: { text: "Update" } })).statusCode).toBe(202);
    expect((await app.inject({ method: "PATCH", url: "/api/bots/finance/threads/thread-1", payload: { title: "Forecast" } })).json()).toMatchObject({ thread: { title: "Forecast" } });
    expect((await app.inject({ method: "DELETE", url: "/api/bots/finance/threads/thread-1" })).statusCode).toBe(204);
    expect(chat.sendThreadMessage).toHaveBeenCalledWith("finance", "thread-1", "Update");
    expect(chat.archiveThread).toHaveBeenCalledWith("finance", "thread-1");
    await app.close();
  });

  it("streams thread snapshots as server-sent events and releases closed clients", async () => {
    const hermes = { listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn() };
    const stop = vi.fn();
    const chat = {
      getConversation: vi.fn(), sendMessage: vi.fn(), listThreads: vi.fn(), createThread: vi.fn(), getThread: vi.fn(),
      sendThreadMessage: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(),
      watchThread: vi.fn(async (_bot: string, _threadId: string, listener: (event: unknown) => void) => {
        listener({ type: "conversation", conversation: { bot: "finance", sessionId: "s1", running: true, messages: [] } });
        return stop;
      })
    };
    const app = createApp({ hermes, chat, accessTokens: { viewer: "viewer-token" }, sseLimits: { global: 2, perPrincipal: 1, lifetimeMs: 60_000 } });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const denied = await fetch(`${address}/api/bots/finance/threads/s1/events`);
    expect(denied.status).toBe(401);
    const controller = new AbortController();
    const response = await fetch(`${address}/api/bots/finance/threads/s1/events`, {
      headers: { authorization: "Bearer viewer-token" },
      signal: controller.signal
    });
    const reader = response.body!.getReader();
    const first = await reader.read();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(new TextDecoder().decode(first.value)).toContain("event: conversation");
    expect(chat.watchThread).toHaveBeenCalledWith("finance", "s1", expect.any(Function));
    expect(stop).not.toHaveBeenCalled();
    const limited = await fetch(`${address}/api/bots/finance/threads/s1/events`, {
      headers: { authorization: "Bearer viewer-token" }
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("5");
    controller.abort();
    await reader.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stop).toHaveBeenCalledOnce();
    const replacementController = new AbortController();
    const replacement = await fetch(`${address}/api/bots/finance/threads/s1/events`, {
      headers: { authorization: "Bearer viewer-token" },
      signal: replacementController.signal
    });
    expect(replacement.status).toBe(200);
    replacementController.abort();
    await replacement.body?.cancel().catch(() => undefined);
    app.server.closeAllConnections();
    await app.close();
  });

  it("closes a slow SSE client on backpressure before releasing its quota", async () => {
    const hermes = { listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn() };
    const stop = vi.fn();
    let watches = 0;
    const chat = {
      getConversation: vi.fn(), sendMessage: vi.fn(), listThreads: vi.fn(), createThread: vi.fn(), getThread: vi.fn(),
      sendThreadMessage: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(),
      watchThread: vi.fn(async (_bot: string, _threadId: string, listener: (event: unknown) => void) => {
        watches += 1;
        listener({ type: "conversation", conversation: { bot: "finance", sessionId: "s1", running: true, messages: [{ text: watches === 1 ? "x".repeat(1_000_000) : "ok" }] } });
        return stop;
      })
    };
    const app = createApp({ hermes, chat, accessTokens: { viewer: "viewer-token" }, sseLimits: { global: 1, perPrincipal: 1, lifetimeMs: 60_000 } });
    const address = new URL(await app.listen({ host: "127.0.0.1", port: 0 }));
    const socket = createConnection({ host: "127.0.0.1", port: Number(address.port) });
    socket.pause();
    socket.once("connect", () => {
      socket.write([
        "GET /api/bots/finance/threads/s1/events HTTP/1.1",
        `Host: 127.0.0.1:${address.port}`,
        "Authorization: Bearer viewer-token",
        "Connection: keep-alive",
        "",
        ""
      ].join("\r\n"));
    });

    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce(), { timeout: 2_000 });
    socket.destroy();
    const replacementController = new AbortController();
    const replacement = await fetch(`${address.origin}/api/bots/finance/threads/s1/events`, {
      headers: { authorization: "Bearer viewer-token" },
      signal: replacementController.signal
    });
    expect(replacement.status).toBe(200);
    replacementController.abort();
    await replacement.body?.cancel().catch(() => undefined);
    app.server.closeAllConnections();
    await app.close();
  });

  it("exposes group creation, listing and message routes", async () => {
    const hermes = { listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn() };
    const groups = {
      listGroups: vi.fn().mockResolvedValue([{ id: "room-1", name: "Direction", members: ["finance", "ops"], messages: [], running: false }]),
      createGroup: vi.fn().mockResolvedValue({ id: "room-2", name: "Projet", members: ["finance", "ops"], messages: [], running: false }),
      sendMessage: vi.fn().mockResolvedValue({ id: "room-1", name: "Direction", members: ["finance", "ops"], messages: [{ author: "user", text: "Décidez" }], running: true }),
      stop: vi.fn().mockResolvedValue({ id: "room-1", name: "Direction", members: ["finance", "ops"], messages: [], running: false, protocol: { status: "stopped" } })
    };
    const app = createApp({ hermes, groups });

    const listed = await app.inject({ method: "GET", url: "/api/groups" });
    const created = await app.inject({ method: "POST", url: "/api/groups", payload: { name: "Projet", members: ["finance", "ops"] } });
    const sent = await app.inject({ method: "POST", url: "/api/groups/room-1/messages", payload: { text: "Décidez" } });
    const stopped = await app.inject({ method: "POST", url: "/api/groups/room-1/stop" });

    expect(listed.json()).toMatchObject({ groups: [{ id: "room-1" }] });
    expect(created.statusCode).toBe(201);
    expect(sent.statusCode).toBe(202);
    expect(stopped.json()).toMatchObject({ protocol: { status: "stopped" } });
    expect(groups.createGroup).toHaveBeenCalledWith("Projet", ["finance", "ops"]);
    expect(groups.sendMessage).toHaveBeenCalledWith("room-1", "Décidez");
    expect(groups.stop).toHaveBeenCalledWith("room-1");
    await app.close();
  });

  it("serves the built web app from the bridge", async () => {
    const root = mkdtempSync(join(tmpdir(), "byfinity-static-"));
    writeFileSync(join(root, "index.html"), "<h1>Byfinity PWA</h1>");
    const hermes = { listBots: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotUsage: vi.fn() };
    const app = createApp({ hermes, staticDir: root });

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Byfinity PWA");
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
});
