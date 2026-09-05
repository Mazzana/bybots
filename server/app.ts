import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";
import type { AvatarPet, AvatarPetSprite, BotArchive, BotConfiguration, BotCreateInput, BotRoutine, BotRoutineInput, BotRoutineRun, BotSummary, BotUpdateInput, BotUpdateResult, BotUsage, HermesMachine, McpServerTest } from "./hermes-client";
import { isSecureHermesUrl, type HermesConnectionService } from "./hermes-connection";
import type { MultiGateway } from "./multi-gateway";
import { failureHttpStatus, hermesFailureFromUnknown } from "./hermes-failure";

const MAX_BOT_ARCHIVE_BYTES = 25 * 1024 * 1024;
const SUPPORTED_HERMES_VERSION = "0.21.x";
const BRIDGE_API_VERSION = "1";
const DEFAULT_TRUSTED_LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "::1"];
const DEFAULT_SSE_LIMITS = { global: 64, perPrincipal: 4, lifetimeMs: 30 * 60_000 };

interface SseLimits {
  global?: number;
  perPrincipal?: number;
  lifetimeMs?: number;
}

function normalizeHostname(value: string): string {
  const hostname = value.toLowerCase().replace(/\.$/, "");
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function normalizedHostname(value: string): string | undefined {
  try {
    return normalizeHostname(new URL(`http://${value}`).hostname);
  } catch {
    return undefined;
  }
}

function requestOriginHostname(value: string): string | undefined {
  try {
    const origin = new URL(value);
    if (origin.protocol !== "http:" && origin.protocol !== "https:") return undefined;
    return normalizeHostname(origin.hostname);
  } catch {
    return undefined;
  }
}

function diagnosticsConnection(baseUrl: string) {
  const url = new URL(baseUrl);
  const hostname = normalizeHostname(url.hostname);
  const local = hostname === "localhost" || hostname === "::1" || (isIP(hostname) === 4 && Number(hostname.split(".")[0]) === 127);
  return {
    target: local ? "local" as const : "remote" as const,
    transport: url.protocol === "https:" ? "https" as const : "http" as const,
    secure: isSecureHermesUrl(baseUrl)
  };
}

export interface HermesService {
  listBots(): Promise<BotSummary[]>;
  createBot(input: BotCreateInput): Promise<BotSummary>;
  deleteBot(name: string): Promise<void>;
  exportBot?(name: string): Promise<BotArchive>;
  importBot?(data: Uint8Array, name?: string, gatewayId?: string): Promise<BotSummary>;
  updateBotAvatar?(name: string, avatar: { shape?: string; color?: string; image?: string }): Promise<void>;
  listAvatarPets?(): Promise<AvatarPet[]>;
  getAvatarPetSprite?(slug: string): Promise<AvatarPetSprite>;
  getBotConfiguration?(name: string): Promise<BotConfiguration>;
  testMcpServer?(profile: string, server: string): Promise<McpServerTest>;
  updateBot?(name: string, input: BotUpdateInput): Promise<BotUpdateResult>;
  getBotUsage(name: string, days?: number): Promise<BotUsage>;
  listBotRoutines?(name: string): Promise<BotRoutine[]>;
  createBotRoutine?(name: string, input: BotRoutineInput): Promise<BotRoutine>;
  setBotRoutineEnabled?(name: string, routineId: string, enabled: boolean): Promise<BotRoutine>;
  runBotRoutine?(name: string, routineId: string): Promise<BotRoutine>;
  deleteBotRoutine?(name: string, routineId: string): Promise<void>;
  listBotRoutineRuns?(name: string, routineId: string, limit?: number): Promise<BotRoutineRun[]>;
  listMachines?(): Promise<HermesMachine[]>;
}

export interface ChatService {
  getConversation(bot: string): Promise<unknown>;
  sendMessage(bot: string, text: string): Promise<unknown>;
  listThreads?(bot: string): Promise<unknown[]>;
  createThread?(bot: string, title?: string): Promise<unknown>;
  getThread?(bot: string, threadId: string): Promise<unknown>;
  sendThreadMessage?(bot: string, threadId: string, text: string): Promise<unknown>;
  renameThread?(bot: string, threadId: string, title: string): Promise<unknown>;
  archiveThread?(bot: string, threadId: string): Promise<void>;
  watchThread?(bot: string, threadId: string, listener: (event: unknown) => void): Promise<() => void>;
}

export interface GroupService {
  listGroups(): Promise<unknown[]>;
  createGroup(name: string, members: string[]): Promise<unknown>;
  sendMessage(roomId: string, text: string, thread?: string): Promise<unknown>;
  stop?(roomId: string): Promise<unknown>;
}

export type AccessRole = "admin" | "operator" | "viewer";

export function createApp({ hermes, chat, groups, connection, gateways, remoteToken, accessTokens, staticDir, bridgeVersion = "development", trustedLocalHostnames = DEFAULT_TRUSTED_LOCAL_HOSTNAMES, sseLimits }: { hermes: HermesService; chat?: ChatService; groups?: GroupService; connection?: HermesConnectionService; gateways?: MultiGateway; remoteToken?: string; accessTokens?: Partial<Record<AccessRole, string>>; staticDir?: string; bridgeVersion?: string; trustedLocalHostnames?: string[]; sseLimits?: SseLimits }) {
  const app = Fastify({ logger: false });
  const requestRoles = new WeakMap<object, AccessRole>();
  const trustedHosts = new Set(trustedLocalHostnames.map(normalizeHostname));
  const activeStreamsByPrincipal = new Map<string, number>();
  let activeStreams = 0;
  const streamLimits = {
    global: Math.max(1, sseLimits?.global ?? DEFAULT_SSE_LIMITS.global),
    perPrincipal: Math.max(1, sseLimits?.perPrincipal ?? DEFAULT_SSE_LIMITS.perPrincipal),
    lifetimeMs: Math.max(1_000, sseLimits?.lifetimeMs ?? DEFAULT_SSE_LIMITS.lifetimeMs)
  };

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-byfinity-bridge-api-version", BRIDGE_API_VERSION);
    const contentType = String(reply.getHeader("content-type") || "");
    if (contentType.includes("text/html")) reply.header("content-security-policy", "frame-ancestors 'none'");
    return payload;
  });

  app.addContentTypeParser(
    ["application/gzip", "application/x-gzip", "application/octet-stream"],
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body)
  );

  app.setErrorHandler((cause, _request, reply) => {
    if (cause instanceof z.ZodError) {
      return reply.code(400).send({ error: { reason: "invalid_request", title: "Invalid request", detail: cause.issues[0]?.message || "Invalid request", hint: "Correct the fields, then try again.", retryable: false, action: "none" } });
    }
    const failure = hermesFailureFromUnknown(cause);
    return reply.code(failureHttpStatus(failure.reason)).send({ error: failure });
  });

  const tokens = ([
    ["admin", accessTokens?.admin || remoteToken],
    ["operator", accessTokens?.operator],
    ["viewer", accessTokens?.viewer]
  ] as Array<[AccessRole, string | undefined]>).filter((entry): entry is [AccessRole, string] => Boolean(entry[1]));

  if (!tokens.length) {
    app.addHook("onRequest", async (request, reply) => {
      const host = normalizedHostname(request.headers.host ?? "");
      if (!host || !trustedHosts.has(host)) {
        return reply.code(421).send({ error: { reason: "access_denied", title: "Untrusted local host", detail: "This Bridge only accepts requests for an explicitly trusted local hostname.", hint: "Use the local application URL or configure Bridge role tokens for remote access.", retryable: false, action: "none" } });
      }
      const originHeader = request.headers.origin;
      if (originHeader) {
        const originHost = requestOriginHostname(originHeader);
        if (!originHost || !trustedHosts.has(originHost)) {
          return reply.code(403).send({ error: { reason: "access_denied", title: "Untrusted browser origin", detail: "Cross-site browser requests are not allowed by the local Bridge.", hint: "Open ByBots from its trusted local application URL.", retryable: false, action: "none" } });
        }
      }
    });
  }

  if (tokens.length) {
    app.addHook("onRequest", async (request, reply) => {
      if (request.url === "/api/health" || request.url.split("?")[0] === "/api/hermes/connection/oauth/callback") return;
      const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      const suppliedBytes = Buffer.from(supplied);
      const match = tokens.find(([, token]) => {
        const expectedBytes = Buffer.from(token);
        return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
      });
      if (!match) {
        return reply.code(401).send({ error: "Authentication required" });
      }
      requestRoles.set(request, match[0]);
    });
    app.addHook("preHandler", async (request, reply) => {
      if (request.url === "/api/health") return;
      const role = requestRoles.get(request) || "viewer";
      const path = request.url.split("?")[0];
      if (path === "/api/hermes/connection/oauth/callback") return;
      if (path.startsWith("/api/hermes/connection") && role !== "admin") {
        return reply.code(403).send({ error: { reason: "access_denied", title: "Action not allowed", detail: `The ${role} role cannot perform this action.`, hint: "Ask an administrator for a higher access level.", retryable: false, action: "none" } });
      }
      if (role === "admin" || request.method === "GET" || request.method === "HEAD") return;
      const operatorAction = role === "operator" && request.method === "POST" && (
        /^\/api\/bots\/[^/]+\/messages$/.test(path) ||
        /^\/api\/bots\/[^/]+\/threads(?:\/[^/]+\/messages)?$/.test(path) ||
        /^\/api\/groups\/[^/]+\/(?:messages|stop)$/.test(path) ||
        /^\/api\/bots\/[^/]+\/routines\/[^/]+\/run$/.test(path)
      );
      if (!operatorAction) return reply.code(403).send({ error: { reason: "access_denied", title: "Action not allowed", detail: `The ${role} role cannot perform this action.`, hint: "Ask an administrator for a higher access level.", retryable: false, action: "none" } });
    });
  }

  if (staticDir) {
    void app.register(fastifyStatic, { root: staticDir });
  }

  app.get("/api/health", async () => ({ ok: true, apiVersion: BRIDGE_API_VERSION }));
  app.get("/api/access", async (request) => ({ role: requestRoles.get(request) || "admin" }));
  if (gateways) {
    app.get("/api/gateways/status", async () => ({ gateways: await gateways.connectionStatuses() }));
    const gatewayId = (params: unknown) => z.object({ id: z.string().regex(/^(primary|gw-[a-f0-9]{12})$/) }).parse(params).id;
    const credentials = z.object({ baseUrl: z.string().trim().min(1).max(2048), token: z.string().max(4096).optional() }).strict();
    // All management routes intentionally share the existing administrator-only prefix.
    app.get("/api/hermes/connection/gateways", async () => ({ gateways: await gateways.listGateways(), activity: gateways.relay.activity, safety: gateways.relaySafety }));
    app.put("/api/hermes/connection/relay/pause", async (request) => { await gateways.setRelayPaused(z.object({ paused: z.boolean() }).strict().parse(request.body).paused); return { ok: true }; });
    app.post("/api/hermes/connection/gateways", async (request, reply) => reply.code(201).send(await gateways.addGateway(z.object({ label: z.string().trim().min(1).max(48), baseUrl: z.string().trim().min(1).max(2048) }).strict().parse(request.body))));
    app.get("/api/hermes/connection/gateways/:id", async (request) => ({ connection: await gateways.getConnection(gatewayId(request.params)) }));
    app.put("/api/hermes/connection/gateways/:id", async (request) => ({ connection: await gateways.updateConnection(credentials.parse(request.body), gatewayId(request.params)) }));
    app.post("/api/hermes/connection/gateways/:id/test", async (request) => ({ probe: await gateways.testConnection(credentials.parse(request.body), gatewayId(request.params)) }));
    app.patch("/api/hermes/connection/gateways/:id", async (request) => { await gateways.setRelay(gatewayId(request.params), z.object({ relay: z.boolean() }).strict().parse(request.body).relay); return { ok: true }; });
    app.put("/api/hermes/connection/gateways/:id/default", async (request) => { await gateways.setDefaultGateway(gatewayId(request.params)); return { ok: true }; });
    app.delete("/api/hermes/connection/gateways/:id", async (request) => { await gateways.removeGateway(gatewayId(request.params)); return { ok: true }; });
    app.post("/api/hermes/connection/gateways/:id/oauth/start", async (request) => {
      const input = z.object({ baseUrl: z.string().trim().min(1).max(2048), appOrigin: z.string().url().max(2048).optional() }).strict().parse(request.body);
      const origin = input.appOrigin || (typeof request.headers.origin === "string" ? request.headers.origin : `${request.protocol}://${request.headers.host || "127.0.0.1"}`);
      return gateways.startOAuth(input.baseUrl, new URL("/api/hermes/connection/oauth/callback", origin).toString(), gatewayId(request.params));
    });
  }
  if (connection) {
    const connectionInput = z.object({
      baseUrl: z.string().trim().min(1).max(2_048),
      token: z.string().max(4_096).optional()
    }).strict();
    const readDiagnostics = async () => {
      const current = await connection.getConnection();
      const checkedAt = new Date().toISOString();
      if (!current.hasToken) {
        return {
          checkedAt,
          supportedHermes: SUPPORTED_HERMES_VERSION,
          bridge: { status: "ready", version: bridgeVersion },
          hermes: { status: "warning", baseUrl: current.baseUrl, version: current.version },
          authentication: { status: "error", detail: "Hermes session token is required" }
        };
      }
      try {
        const probe = await connection.testConnection({ baseUrl: current.baseUrl });
        const compatible = probe.version === "unknown" ? undefined : /^0\.21(?:\.|$)/.test(probe.version);
        return {
          checkedAt,
          supportedHermes: SUPPORTED_HERMES_VERSION,
          bridge: { status: "ready", version: bridgeVersion },
          hermes: {
            status: compatible === false ? "warning" : "ready",
            baseUrl: probe.baseUrl,
            version: probe.version,
            compatible
          },
          authentication: { status: "ready" }
        };
      } catch (cause) {
        const failure = hermesFailureFromUnknown(cause);
        return {
          checkedAt,
          supportedHermes: SUPPORTED_HERMES_VERSION,
          bridge: { status: "ready", version: bridgeVersion },
          hermes: { status: "error", baseUrl: current.baseUrl, version: current.version },
          authentication: { status: "warning" },
          failure
        };
      }
    };
    app.get("/api/hermes/connection", async () => ({ connection: await connection.getConnection() }));
    if (connection.probeAuth) app.post("/api/hermes/connection/auth", async (request) => {
      const input = z.object({ baseUrl: z.string().trim().min(1).max(2_048) }).strict().parse(request.body);
      return { auth: await connection.probeAuth!(input.baseUrl) };
    });
    if (connection.startOAuth && connection.completeOAuth) {
      app.post("/api/hermes/connection/oauth/start", async (request) => {
        const input = z.object({ baseUrl: z.string().trim().min(1).max(2_048), appOrigin: z.string().url().max(2_048).optional() }).strict().parse(request.body);
        const host = request.headers.host || "127.0.0.1";
        const browserOrigin = input.appOrigin || (typeof request.headers.origin === "string" ? request.headers.origin : `${request.protocol}://${host}`);
        const redirectUri = new URL("/api/hermes/connection/oauth/callback", browserOrigin).toString();
        return connection.startOAuth!(input.baseUrl, redirectUri);
      });
      app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>("/api/hermes/connection/oauth/callback", async (request, reply) => {
        const requestHost = request.headers.host || "127.0.0.1";
        const safeHost = normalizedHostname(requestHost);
        let returnUrl = new URL("/", safeHost && trustedHosts.has(safeHost) ? `${request.protocol}://${requestHost}` : "http://127.0.0.1");
        try {
          if (request.query.error) throw new Error(request.query.error_description || request.query.error);
          const input = z.object({ code: z.string().min(1).max(8_192), state: z.string().min(1).max(512) }).parse(request.query);
          const completed = await connection.completeOAuth!(input);
          returnUrl = new URL("/", completed.redirectUri);
          returnUrl.searchParams.set("hermesOauth", "success");
        } catch (cause) {
          returnUrl.searchParams.set("hermesOauth", "error");
          returnUrl.searchParams.set("message", hermesFailureFromUnknown(cause).detail.slice(0, 300));
        }
        return reply.redirect(returnUrl.toString());
      });
    }
    app.get("/api/diagnostics", readDiagnostics);
    app.get("/api/diagnostics/report", async () => {
      const diagnostics = await readDiagnostics();
      return {
        schemaVersion: 1,
        generatedAt: diagnostics.checkedAt,
        application: { name: "ByBots", version: bridgeVersion },
        runtime: { platform: process.platform, architecture: process.arch },
        connection: diagnosticsConnection(diagnostics.hermes.baseUrl),
        support: { hermes: SUPPORTED_HERMES_VERSION },
        checks: {
          bridge: { status: diagnostics.bridge.status, version: diagnostics.bridge.version },
          hermes: {
            status: diagnostics.hermes.status,
            version: diagnostics.hermes.version,
            compatible: diagnostics.hermes.compatible
          },
          authentication: { status: diagnostics.authentication.status }
        },
        ...(diagnostics.failure ? {
          failure: {
            reason: diagnostics.failure.reason,
            retryable: diagnostics.failure.retryable,
            action: diagnostics.failure.action
          }
        } : {}),
        privacy: {
          excluded: [
            "authentication credentials and headers",
            "gateway host, port, path, query, and fragment",
            "Bot names, conversations, files, and user content"
          ]
        }
      };
    });
    app.post("/api/hermes/connection/test", async (request) => ({ probe: await connection.testConnection(connectionInput.parse(request.body)) }));
    app.put("/api/hermes/connection", async (request) => ({ connection: await connection.updateConnection(connectionInput.parse(request.body)) }));
    app.delete("/api/hermes/connection", async () => ({ connection: await connection.resetConnection() }));
  }
  if (hermes.listMachines) app.get("/api/machines", async () => ({ machines: await hermes.listMachines!() }));
  app.get("/api/bots", async () => ({ bots: await hermes.listBots() }));
  if (hermes.listAvatarPets) app.get("/api/avatar-pets", async () => ({ pets: (await hermes.listAvatarPets!()).map((pet) => ({ ...pet, ...(pet.spritesheetUrl ? { spritesheetUrl: `/api/avatar-pets/${encodeURIComponent(pet.slug)}/sprite` } : {}) })) }));
  if (hermes.getAvatarPetSprite) app.get<{ Params: { slug: string } }>("/api/avatar-pets/:slug/sprite", async (request, reply) => {
    const sprite = await hermes.getAvatarPetSprite!(request.params.slug);
    return reply.header("content-type", sprite.contentType).header("cache-control", "public, max-age=31536000, immutable").send(Buffer.from(sprite.data));
  });
  app.post("/api/bots", async (request, reply) => {
    const input = z.object({
      name: z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*$/i),
      gatewayId: z.string().regex(/^(primary|gw-[a-f0-9]{12})$/).optional(),
      title: z.string().trim().max(120).optional(),
      description: z.string().trim().max(10_000).optional(),
      avatar: z.object({
        shape: z.string().trim().min(1).max(100).optional(),
        color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
        image: z.string().max(2_000_000).optional()
      }).optional()
    }).parse(request.body);
    const bot = await hermes.createBot(input);
    return reply.code(201).send({ bot });
  });
  app.delete<{ Params: { name: string } }>("/api/bots/:name", async (request, reply) => {
    await hermes.deleteBot(request.params.name);
    return reply.code(204).send();
  });
  if (hermes.exportBot) {
    app.post<{ Params: { name: string } }>("/api/bots/:name/export", async (request, reply) => {
      const archive = await hermes.exportBot!(request.params.name);
      const filename = archive.filename.replace(/[^a-zA-Z0-9._-]/g, "-");
      return reply
        .header("content-type", "application/gzip")
        .header("content-disposition", `attachment; filename="${filename}"`)
        .send(Buffer.from(archive.data));
    });
  }
  if (hermes.importBot) {
    app.post<{ Body: Buffer; Querystring: { name?: string } }>("/api/bots/import", { bodyLimit: MAX_BOT_ARCHIVE_BYTES }, async (request, reply) => {
      const { name, gatewayId } = z.object({
        gatewayId: z.string().regex(/^(primary|gw-[a-f0-9]{12})$/).optional(),
        name: z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*$/i).optional()
      }).parse(request.query);
      const archive = z.instanceof(Buffer)
        .refine((value) => value.length > 1 && value[0] === 0x1f && value[1] === 0x8b, "A gzip Hermes profile archive is required")
        .parse(request.body);
      const bot = gatewayId ? await hermes.importBot!(new Uint8Array(archive), name, gatewayId) : await hermes.importBot!(new Uint8Array(archive), name);
      return reply.code(201).send({ bot });
    });
  }
  if (hermes.updateBotAvatar) {
    app.patch<{ Params: { name: string } }>("/api/bots/:name/avatar", async (request, reply) => {
      const avatar = z.object({
        shape: z.string().trim().min(1).max(100).optional(),
        color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
        image: z.string().max(2_000_000).optional()
      }).refine((value) => value.shape || value.color || "image" in value, "avatar change required").parse(request.body);
      await hermes.updateBotAvatar!(request.params.name, avatar);
      return reply.code(204).send();
    });
  }
  app.get<{ Params: { name: string }; Querystring: { days?: string } }>("/api/bots/:name/usage", async (request) => {
    const days = Number.parseInt(request.query.days ?? "30", 10);
    return hermes.getBotUsage(request.params.name, Number.isFinite(days) ? days : 30);
  });
  if (hermes.getBotConfiguration && hermes.updateBot) {
    app.get<{ Params: { name: string } }>("/api/bots/:name/config", async (request) => {
      return hermes.getBotConfiguration!(request.params.name);
    });
    app.patch<{ Params: { name: string } }>("/api/bots/:name", async (request) => {
      const input = z.object({
        title: z.string().max(120).optional(),
        description: z.string().max(10_000).optional(),
        provider: z.string().max(120).optional(),
        model: z.string().max(300).optional(),
        soul: z.string().max(100_000).optional(),
        disabledSkills: z.array(z.string().min(1).max(200)).max(500).optional(),
        enabledToolsets: z.array(z.string().min(1).max(200)).max(200).optional(),
        enabledMcpServers: z.array(z.string().min(1).max(200)).max(200).optional(),
        confirmExpensiveModel: z.boolean().optional()
      }).strict().parse(request.body);
      return hermes.updateBot!(request.params.name, input);
    });
  }
  if (hermes.testMcpServer) {
    app.post<{ Params: { name: string; server: string } }>("/api/bots/:name/mcp/:server/test", async (request) => {
      const params = z.object({
        name: z.string().trim().min(1).max(64),
        server: z.string().trim().min(1).max(200)
      }).parse(request.params);
      return { test: await hermes.testMcpServer!(params.name, params.server) };
    });
  }

  if (hermes.listBotRoutines && hermes.createBotRoutine && hermes.setBotRoutineEnabled && hermes.runBotRoutine && hermes.deleteBotRoutine && hermes.listBotRoutineRuns) {
    app.get<{ Params: { name: string } }>("/api/bots/:name/routines", async (request) => ({ routines: await hermes.listBotRoutines!(request.params.name) }));
    app.post<{ Params: { name: string } }>("/api/bots/:name/routines", async (request, reply) => {
      const input = z.object({
        name: z.string().trim().min(2).max(120),
        prompt: z.string().trim().min(1).max(100_000),
        schedule: z.string().trim().min(1).max(200)
      }).parse(request.body);
      return reply.code(201).send({ routine: await hermes.createBotRoutine!(request.params.name, input) });
    });
    app.patch<{ Params: { name: string; routineId: string } }>("/api/bots/:name/routines/:routineId", async (request) => {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
      return { routine: await hermes.setBotRoutineEnabled!(request.params.name, request.params.routineId, enabled) };
    });
    app.post<{ Params: { name: string; routineId: string } }>("/api/bots/:name/routines/:routineId/run", async (request, reply) => {
      const routine = await hermes.runBotRoutine!(request.params.name, request.params.routineId);
      return reply.code(202).send({ routine });
    });
    app.delete<{ Params: { name: string; routineId: string } }>("/api/bots/:name/routines/:routineId", async (request, reply) => {
      await hermes.deleteBotRoutine!(request.params.name, request.params.routineId);
      return reply.code(204).send();
    });
    app.get<{ Params: { name: string; routineId: string }; Querystring: { limit?: string } }>("/api/bots/:name/routines/:routineId/runs", async (request) => {
      const limit = Number.parseInt(request.query.limit ?? "10", 10);
      return { runs: await hermes.listBotRoutineRuns!(request.params.name, request.params.routineId, Number.isFinite(limit) ? limit : 10) };
    });
  }

  if (chat) {
    app.get<{ Params: { name: string } }>("/api/bots/:name/conversation", async (request) => {
      return chat.getConversation(request.params.name);
    });
    app.post<{ Params: { name: string } }>("/api/bots/:name/messages", async (request, reply) => {
      const { text } = z.object({ text: z.string().trim().min(1).max(100_000) }).parse(request.body);
      const conversation = await chat.sendMessage(request.params.name, text);
      return reply.code(202).send(conversation);
    });
    if (chat.listThreads && chat.createThread && chat.getThread && chat.sendThreadMessage && chat.renameThread && chat.archiveThread) {
      app.get<{ Params: { name: string } }>("/api/bots/:name/threads", async (request) => ({
        threads: await chat.listThreads!(request.params.name)
      }));
      app.post<{ Params: { name: string } }>("/api/bots/:name/threads", async (request, reply) => {
        const { title } = z.object({ title: z.string().trim().min(1).max(120).optional() }).parse(request.body ?? {});
        const conversation = await chat.createThread!(request.params.name, title);
        return reply.code(201).send({ conversation });
      });
      app.get<{ Params: { name: string; threadId: string } }>("/api/bots/:name/threads/:threadId", async (request) => {
        return chat.getThread!(request.params.name, request.params.threadId);
      });
      if (chat.watchThread) {
        app.get<{ Params: { name: string; threadId: string } }>("/api/bots/:name/threads/:threadId/events", async (request, reply) => {
          const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
          const principal = supplied
            ? `token:${createHash("sha256").update(supplied).digest("hex")}`
            : "local";
          const principalStreams = activeStreamsByPrincipal.get(principal) ?? 0;
          if (activeStreams >= streamLimits.global || principalStreams >= streamLimits.perPrincipal) {
            return reply.code(429).header("retry-after", "5").send({ error: { reason: "delivery_timeout", title: "Too many live streams", detail: "The live update connection limit has been reached.", hint: "Close another live conversation or retry in a few seconds.", retryable: true, action: "retry" } });
          }
          activeStreams += 1;
          activeStreamsByPrincipal.set(principal, principalStreams + 1);
          reply.hijack();
          reply.raw.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
            "x-byfinity-bridge-api-version": BRIDGE_API_VERSION
          });
          reply.raw.flushHeaders();
          let closed = false;
          let unsubscribe: () => void = () => undefined;
          let heartbeat: ReturnType<typeof setInterval> | undefined;
          let lifetime: ReturnType<typeof setTimeout> | undefined;
          const cleanup = () => {
            if (closed) return;
            closed = true;
            if (heartbeat) clearInterval(heartbeat);
            if (lifetime) clearTimeout(lifetime);
            unsubscribe();
            activeStreams = Math.max(0, activeStreams - 1);
            const remaining = Math.max(0, (activeStreamsByPrincipal.get(principal) ?? 1) - 1);
            if (remaining) activeStreamsByPrincipal.set(principal, remaining);
            else activeStreamsByPrincipal.delete(principal);
          };
          const write = (payload: string) => {
            if (closed) return false;
            if (reply.raw.write(payload)) return true;
            reply.raw.destroy();
            return false;
          };
          heartbeat = setInterval(() => {
            write(": heartbeat\n\n");
          }, 15_000);
          heartbeat.unref?.();
          lifetime = setTimeout(() => {
            reply.raw.destroy();
          }, streamLimits.lifetimeMs);
          lifetime.unref?.();
          reply.raw.once("close", cleanup);
          reply.raw.once("finish", cleanup);
          try {
            unsubscribe = await chat.watchThread!(request.params.name, request.params.threadId, (event) => {
              if (closed) return;
              const type = event && typeof event === "object" && "type" in event ? String(event.type) : "message";
              if (!write(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`)) return;
              if (type === "archived" || type === "reconnect") reply.raw.end();
            });
            if (closed) unsubscribe();
          } catch (cause) {
            const failure = hermesFailureFromUnknown(cause);
            write(`event: error\ndata: ${JSON.stringify({ type: "error", error: failure })}\n\n`);
            cleanup();
            reply.raw.end();
          }
        });
      }
      app.post<{ Params: { name: string; threadId: string } }>("/api/bots/:name/threads/:threadId/messages", async (request, reply) => {
        const { text } = z.object({ text: z.string().trim().min(1).max(100_000) }).parse(request.body);
        const conversation = await chat.sendThreadMessage!(request.params.name, request.params.threadId, text);
        return reply.code(202).send(conversation);
      });
      app.patch<{ Params: { name: string; threadId: string } }>("/api/bots/:name/threads/:threadId", async (request) => {
        const { title } = z.object({ title: z.string().trim().min(1).max(120) }).parse(request.body);
        return { thread: await chat.renameThread!(request.params.name, request.params.threadId, title) };
      });
      app.delete<{ Params: { name: string; threadId: string } }>("/api/bots/:name/threads/:threadId", async (request, reply) => {
        await chat.archiveThread!(request.params.name, request.params.threadId);
        return reply.code(204).send();
      });
    }
  }

  if (groups) {
    app.get("/api/groups", async () => ({ groups: await groups.listGroups() }));
    app.post("/api/groups", async (request, reply) => {
      const input = z.object({
        name: z.string().trim().min(2).max(80),
        members: z.array(z.string().trim().min(1).max(128)).min(2).max(6)
      }).parse(request.body);
      const group = await groups.createGroup(input.name, input.members);
      return reply.code(201).send({ group });
    });
    app.post<{ Params: { id: string } }>("/api/groups/:id/messages", async (request, reply) => {
      const { text, thread } = z.object({ text: z.string().trim().min(1).max(100_000), thread: z.string().min(1).max(200).optional() }).parse(request.body);
      const group = thread ? await groups.sendMessage(request.params.id, text, thread) : await groups.sendMessage(request.params.id, text);
      return reply.code(202).send(group);
    });
    if (groups.stop) {
      app.post<{ Params: { id: string } }>("/api/groups/:id/stop", async (request) => groups.stop!(request.params.id));
    }
  }

  return app;
}
