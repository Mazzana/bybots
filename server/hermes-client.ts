import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const MAX_BOT_ARCHIVE_BYTES = 25 * 1024 * 1024;

export interface BotAvatar {
  shape?: string;
  color?: string;
  image?: string;
}

export interface AvatarPet {
  slug: string;
  displayName: string;
  spritesheetUrl?: string;
  installed?: boolean;
  curated?: boolean;
}

export interface AvatarPetSprite {
  data: Uint8Array;
  contentType: string;
}

export interface BotArchive {
  data: Uint8Array;
  filename: string;
}

export interface BotCreateInput {
  name: string;
  title?: string;
  description?: string;
  avatar?: BotAvatar;
}

export interface BotSummary {
  name: string;
  system: boolean;
  displayName?: string;
  description?: string;
  title?: string;
  avatar?: BotAvatar;
  machine?: string;
}

export interface HermesMachine { id: string; name: string; url?: string; kind: "local" | "peer"; status: "connected" | "configured" | "needs_auth" }

export interface BotUsage {
  bot: string;
  periodDays: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  actualCostUsd: number;
  estimatedCostUsd: number;
  sessions: number;
  apiCalls: number;
  byModel: Array<{ model: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number }>;
}

export interface BotCapability {
  name: string;
  description?: string;
  enabled: boolean;
  installed?: boolean;
  fromCatalog?: boolean;
  requires?: string[];
  auth?: string;
  toolCount?: number;
}

export interface BotModelProvider {
  slug: string;
  name?: string;
  models: string[];
}

export interface BotConfiguration {
  bot: string;
  provider: string;
  model: string;
  soul: string;
  skills: BotCapability[];
  toolsets: BotCapability[];
  mcpServers: BotCapability[];
  providers: BotModelProvider[];
}

export interface McpServerTest {
  server: string;
  toolCount: number;
  tools: string[];
}

export interface BotUpdateInput {
  title?: string;
  description?: string;
  provider?: string;
  model?: string;
  soul?: string;
  disabledSkills?: string[];
  enabledToolsets?: string[];
  enabledMcpServers?: string[];
  confirmExpensiveModel?: boolean;
}

export interface BotUpdateResult {
  applied: Record<string, boolean>;
  confirmRequired: boolean;
  confirmMessage?: string;
}

export interface BotRoutine {
  id: string;
  bot: string;
  name: string;
  prompt: string;
  schedule: string;
  scheduleDisplay: string;
  enabled: boolean;
  state: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: string;
  lastError?: string;
}

export interface BotRoutineRun {
  id: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "success" | "error";
  output?: string;
  error?: string;
}

export interface BotRoutineInput {
  name: string;
  prompt: string;
  schedule: string;
}

interface GatewayPort {
  request(method: string, params?: Record<string, unknown>): Promise<any>;
}

interface HermesClientOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  sessionToken?: string;
  authMode?: "session" | "oauth";
  gateway?: GatewayPort;
  profileExchangeDir?: string;
}

export class HermesClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly sessionToken?: string;
  private readonly authMode: "session" | "oauth";
  private readonly gateway?: GatewayPort;
  private readonly profileExchangeDir: string;
  private petGalleryCache: { expiresAt: number; pets: AvatarPet[] } | null = null;

  constructor({ baseUrl, fetcher = fetch, sessionToken, authMode = "session", gateway, profileExchangeDir }: HermesClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetcher = fetcher;
    this.sessionToken = sessionToken;
    this.authMode = authMode;
    this.gateway = gateway;
    this.profileExchangeDir = resolve(profileExchangeDir || process.env.BYFINITY_HERMES_EXCHANGE_DIR || tmpdir());
  }

  private async createProfileExchangeDirectory(prefix: string) {
    await mkdir(this.profileExchangeDir, { recursive: true, mode: 0o700 });
    const root = await lstat(this.profileExchangeDir);
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("The Hermes profile exchange path must be a regular directory");
    return mkdtemp(join(this.profileExchangeDir, prefix));
  }

  async listBots(): Promise<BotSummary[]> {
    if (this.gateway) {
      const data = await this.gateway.request("profiles.list", {});
      return Promise.all((data.profiles ?? []).map(async (profile: any) => {
        const meta = profile.ui_meta?.["hermes-bots"] ?? {};
        let image = typeof meta.image === "string" ? meta.image : undefined;
        if (profile.has_avatar) {
          const asset = await this.gateway!.request("profiles.get_asset", { name: profile.name, asset: "avatar" });
          if (asset?.found && typeof asset.data === "string") image = asset.data;
        }
        return {
          name: profile.name,
          system: String(profile.name).toLowerCase() === "default",
          machine: "local",
          ...(profile.display_name ? { displayName: profile.display_name } : {}),
          ...(profile.description ? { description: profile.description } : {}),
          ...(meta.title || profile.title ? { title: meta.title || profile.title } : {}),
          avatar: {
            ...(meta.shape ? { shape: meta.shape } : {}),
            ...(meta.color ? { color: meta.color } : {}),
            ...(image ? { image } : {})
          }
        };
      }));
    }
    const response = await this.request("/api/profiles", { method: "GET" });
    const data = (await response.json()) as { profiles?: Array<{ name: string }> } | Array<{ name: string }>;
    const profiles = Array.isArray(data) ? data : (data.profiles ?? []);
    return profiles.map(({ name }) => ({ name, system: name.toLowerCase() === "default", machine: "local" }));
  }

  async getBotConfiguration(name: string): Promise<BotConfiguration> {
    if (!this.gateway) throw new Error("Hermes gateway is required to configure Bots");
    const [description, catalog, options] = await Promise.all([
      this.gateway.request("profiles.describe", { name }),
      this.gateway.request("mcp.catalog", { profile: name }).catch(() => ({ servers: [] })),
      this.gateway.request("model.options", { include_unconfigured: true, explicit_only: false }).catch(() => ({ providers: [] }))
    ]);
    const configuredMcp = this.capabilities(description.mcp_servers);
    const configuredNames = new Set(configuredMcp.map((entry) => entry.name));
    const catalogMcp = this.capabilities(catalog.servers)
      .filter((entry) => !configuredNames.has(entry.name))
      .map((entry) => ({ ...entry, enabled: false, fromCatalog: true }));

    return {
      bot: name,
      provider: String(description.model?.provider || ""),
      model: String(description.model?.default || ""),
      soul: String(description.soul || ""),
      skills: this.capabilities(description.skills),
      toolsets: this.capabilities(description.toolsets),
      mcpServers: [...configuredMcp, ...catalogMcp],
      providers: (Array.isArray(options.providers) ? options.providers : [])
        .filter((provider: any) => provider?.slug)
        .map((provider: any) => ({
          slug: String(provider.slug),
          ...(provider.name ? { name: String(provider.name) } : {}),
          models: (Array.isArray(provider.models) ? provider.models : [])
            .map((model: any) => typeof model === "string" ? model : String(model?.id || model?.name || ""))
            .filter(Boolean)
        }))
    };
  }

  async testMcpServer(profile: string, server: string): Promise<McpServerTest> {
    const response = await this.request(
      `/api/mcp/servers/${encodeURIComponent(server)}/test?profile=${encodeURIComponent(profile)}`,
      { method: "POST" }
    );
    const data = await response.json() as any;
    if (data?.ok === false || data?.success === false) {
      throw new Error("Hermes could not validate this MCP server");
    }
    const rawTools = Array.isArray(data) ? data : Array.isArray(data?.tools) ? data.tools : Array.isArray(data?.result?.tools) ? data.result.tools : [];
    const tools = rawTools
      .slice(0, 100)
      .map((tool: any) => String(typeof tool === "string" ? tool : tool?.name || "").trim().slice(0, 200))
      .filter(Boolean);
    const reportedCount = Number(data?.tool_count ?? data?.toolCount ?? data?.count);
    return {
      server,
      toolCount: Number.isFinite(reportedCount) && reportedCount >= 0 ? Math.min(10_000, Math.floor(reportedCount)) : tools.length,
      tools
    };
  }

  async listMachines(): Promise<HermesMachine[]> {
    const local: HermesMachine = { id: "local", name: "This device", kind: "local", status: "connected" };
    if (!this.gateway) return [local];
    const result = await this.gateway.request("cli.exec", { argv: ["peer", "list"] });
    if (result?.blocked === true || Number(result?.code) !== 0) return [local];
    const output = String(result?.stdout || result?.output || "");
    const peers = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes("\t")).map((line): HermesMachine | null => {
      const [id, url, auth = ""] = line.split("\t");
      if (!id || !url) return null;
      return { id, name: id, url, kind: "peer", status: /NO KEY/i.test(auth) ? "needs_auth" : "configured" };
    }).filter((machine): machine is HermesMachine => Boolean(machine));
    return [local, ...peers];
  }

  async updateBot(name: string, input: BotUpdateInput): Promise<BotUpdateResult> {
    if (!this.gateway) throw new Error("Hermes gateway is required to configure Bots");
    const applied: Record<string, boolean> = {};
    const configure: Record<string, unknown> = { name };

    if (input.title !== undefined) {
      const data = await this.gateway.request("profiles.list", {});
      const profile = (data.profiles ?? []).find((entry: any) => entry.name === name);
      if (!profile) throw new Error(`Hermes profile '${name}' not found`);
      configure.ui_meta = {
        "hermes-bots": {
          ...(profile.ui_meta?.["hermes-bots"] ?? {}),
          title: input.title.trim()
        }
      };
    }

    if (input.soul !== undefined) configure.soul = input.soul;
    if (input.disabledSkills !== undefined) configure.disabled_skills = input.disabledSkills;
    if (input.enabledToolsets !== undefined) configure.enabled_toolsets = input.enabledToolsets;
    if (input.enabledMcpServers !== undefined) configure.enabled_mcp_servers = input.enabledMcpServers;

    if (input.model !== undefined || input.provider !== undefined) {
      const model = input.model?.trim() ?? "";
      const provider = input.provider?.trim() ?? "";
      if (model && provider) {
        configure.model = model;
        configure.provider = provider;
        if (input.confirmExpensiveModel) configure.confirm_expensive_model = true;
      } else if (!model && !provider) {
        const unset = await this.gateway.request("cli.exec", {
          argv: ["--profile", name, "config", "unset", "model"]
        });
        applied.model = unset?.blocked !== true && Number(unset?.code) === 0;
      } else {
        throw new Error("Provider and model must be selected together");
      }
    }

    let result: any = { applied: {} };
    if (Object.keys(configure).length > 1) {
      result = await this.gateway.request("profiles.configure", configure);
      Object.assign(applied, result?.applied ?? {});
    }

    if (input.description !== undefined) {
      const changed = await this.gateway.request("cli.exec", {
        argv: ["profile", "describe", name, "--text", input.description.trim()]
      });
      applied.description = changed?.blocked !== true && Number(changed?.code) === 0;
    }

    return {
      applied,
      confirmRequired: Boolean(result?.confirm_required),
      ...(result?.confirm_message ? { confirmMessage: String(result.confirm_message) } : {})
    };
  }

  async createBot(input: BotCreateInput): Promise<BotSummary> {
    if (this.gateway) {
      const createParams: Record<string, unknown> = {
        name: input.name,
        share_auth: true
      };
      if (input.description) createParams.description = input.description;
      const result = await this.gateway.request("profiles.create", createParams);
      const name = String(result?.name || input.name).toLowerCase();
      const avatar = input.avatar ?? {};
      const meta: Record<string, unknown> = {
        ...(input.title ? { title: input.title } : {}),
        ...(avatar.shape ? { shape: avatar.shape } : {}),
        ...(avatar.color ? { color: avatar.color } : {}),
        ...((input.title || avatar.shape || avatar.color || avatar.image) ? { custom: true } : {})
      };
      let metaApplied = false;
      let imageApplied = false;
      if (Object.keys(meta).length) {
        try {
          const configured = await this.gateway.request("profiles.configure", {
            name,
            ui_meta: { "hermes-bots": meta }
          });
          metaApplied = configured?.applied?.ui_meta !== false;
        } catch { /* The profile exists; appearance can be completed later. */ }
      }
      if (avatar.image) {
        try {
          await this.gateway.request("profiles.set_asset", { name, asset: "avatar", data: avatar.image });
          imageApplied = true;
        } catch { /* The profile exists; appearance can be completed later. */ }
      }
      const persistedAvatar = {
        ...(metaApplied && avatar.shape ? { shape: avatar.shape } : {}),
        ...(metaApplied && avatar.color ? { color: avatar.color } : {}),
        ...(imageApplied && avatar.image ? { image: avatar.image } : {})
      };
      return {
        name,
        system: false,
        machine: "local",
        ...(metaApplied && input.title ? { title: input.title } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(Object.keys(persistedAvatar).length ? { avatar: persistedAvatar } : {})
      };
    }
    const response = await this.request("/api/profiles", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" }
    });
    const result = (await response.json()) as { name: string };
    return { name: result.name.toLowerCase(), system: false, machine: "local" };
  }

  async deleteBot(name: string): Promise<void> {
    const normalized = name.trim();
    if (normalized.toLowerCase() === "default") {
      throw new Error("The default profile cannot be deleted");
    }
    await this.request(`/api/profiles/${encodeURIComponent(normalized)}`, { method: "DELETE" });
  }

  async exportBot(name: string): Promise<BotArchive> {
    const normalized = name.trim();
    const directory = await this.createProfileExchangeDirectory("byfinity-bot-export-");
    const output = join(directory, `${normalized.toLowerCase().replace(/[^a-z0-9-]/g, "-") || "bot"}.tar.gz`);
    try {
      const response = await this.request(`/api/profiles/${encodeURIComponent(normalized)}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ output })
      });
      const result = await response.json() as { archive?: unknown };
      const archive = resolve(String(result.archive || ""));
      if (archive !== resolve(output)) throw new Error("Hermes returned an unexpected export path");
      const archiveStat = await lstat(archive);
      if (archiveStat.isSymbolicLink() || !archiveStat.isFile() || archiveStat.size === 0) throw new Error("Hermes created an invalid Bot archive");
      if (archiveStat.size > MAX_BOT_ARCHIVE_BYTES) throw new Error("The Bot archive exceeds the 25 MB download limit");
      return { data: new Uint8Array(await readFile(archive)), filename: basename(archive) };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async importBot(data: Uint8Array, name?: string): Promise<BotSummary> {
    if (data.byteLength === 0) throw new Error("The Bot archive is empty");
    if (data.byteLength > MAX_BOT_ARCHIVE_BYTES) throw new Error("The Bot archive exceeds the 25 MB upload limit");
    if (data[0] !== 0x1f || data[1] !== 0x8b) throw new Error("The Bot archive must be a gzip-compressed Hermes profile");
    const directory = await this.createProfileExchangeDirectory("byfinity-bot-import-");
    const archive = join(directory, "profile.tar.gz");
    try {
      await writeFile(archive, data);
      const response = await this.request("/api/profiles/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archive, ...(name?.trim() ? { name: name.trim() } : {}) })
      });
      const result = await response.json() as { name?: unknown };
      const importedName = String(result.name || "").trim().toLowerCase();
      if (!importedName) throw new Error("Hermes did not return the imported Bot name");
      const imported = (await this.listBots()).find((bot) => bot.name === importedName);
      return imported ?? { name: importedName, system: false, machine: "local" };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async updateBotAvatar(name: string, avatar: BotAvatar): Promise<void> {
    if (!this.gateway) throw new Error("Hermes gateway is required to update avatars");
    const data = await this.gateway.request("profiles.list", {});
    const profile = (data.profiles ?? []).find((entry: any) => entry.name === name);
    if (!profile) throw new Error(`Hermes profile '${name}' not found`);
    const current = profile.ui_meta?.["hermes-bots"] ?? {};
    const result = await this.gateway.request("profiles.configure", {
      name,
      ui_meta: {
        "hermes-bots": {
          ...current,
          ...(avatar.shape ? { shape: avatar.shape } : {}),
          ...(avatar.color ? { color: avatar.color } : {}),
          custom: true
        }
      }
    });
    if (result?.applied?.ui_meta === false) throw new Error("Hermes rejected avatar metadata");
    if (avatar.image) {
      await this.gateway.request("profiles.set_asset", { name, asset: "avatar", data: avatar.image });
    } else if ("image" in avatar) {
      await this.gateway.request("profiles.set_asset", { name, asset: "avatar", clear: true });
    }
  }

  async listAvatarPets(): Promise<AvatarPet[]> {
    if (!this.gateway) return [];
    if (this.petGalleryCache && this.petGalleryCache.expiresAt > Date.now()) return this.petGalleryCache.pets;
    const data = await this.gateway.request("pet.gallery", {});
    const pets = (Array.isArray(data?.pets) ? data.pets : [])
      .filter((pet: any) => pet?.slug)
      .map((pet: any) => ({
        slug: String(pet.slug),
        displayName: String(pet.displayName || pet.display_name || pet.slug),
        ...(pet.spritesheetUrl || pet.spritesheet_url ? { spritesheetUrl: String(pet.spritesheetUrl || pet.spritesheet_url) } : {}),
        ...(pet.installed !== undefined ? { installed: Boolean(pet.installed) } : {}),
        ...(pet.curated !== undefined ? { curated: Boolean(pet.curated) } : {})
      }));
    this.petGalleryCache = { expiresAt: Date.now() + 300_000, pets };
    return pets;
  }

  async getAvatarPetSprite(slug: string): Promise<AvatarPetSprite> {
    const pet = (await this.listAvatarPets()).find((entry) => entry.slug === slug);
    if (!pet?.spritesheetUrl) throw new Error(`Hermes pet '${slug}' has no spritesheet`);
    const url = new URL(pet.spritesheetUrl);
    if (url.protocol !== "https:" || url.hostname !== "assets.petdex.dev") throw new Error("Unsupported Hermes pet asset origin");
    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`Hermes pet asset failed (${response.status})`);
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > 5_000_000) throw new Error("Hermes pet asset is too large");
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > 5_000_000) throw new Error("Hermes pet asset is too large");
    return { data, contentType: response.headers.get("content-type") || "image/webp" };
  }

  async getBotUsage(name: string, days = 30): Promise<BotUsage> {
    const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
    const response = await this.request(
      `/api/analytics/usage?days=${safeDays}&profile=${encodeURIComponent(name)}`,
      { method: "GET" }
    );
    const data = (await response.json()) as {
      period_days: number;
      totals: {
        total_input: number | null;
        total_output: number | null;
        total_reasoning: number | null;
        total_cache_read: number | null;
        total_actual_cost: number;
        total_estimated_cost: number;
        total_sessions: number;
        total_api_calls: number | null;
      };
      by_model: Array<{
        model: string;
        input_tokens: number;
        output_tokens: number;
        estimated_cost: number;
      }>;
    };
    const inputTokens = data.totals.total_input ?? 0;
    const outputTokens = data.totals.total_output ?? 0;
    const reasoningTokens = data.totals.total_reasoning ?? 0;
    return {
      bot: name,
      periodDays: data.period_days,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens: data.totals.total_cache_read ?? 0,
      totalTokens: inputTokens + outputTokens + reasoningTokens,
      actualCostUsd: data.totals.total_actual_cost,
      estimatedCostUsd: data.totals.total_estimated_cost,
      sessions: data.totals.total_sessions,
      apiCalls: data.totals.total_api_calls ?? 0,
      byModel: data.by_model.map((entry) => ({
        model: entry.model,
        inputTokens: entry.input_tokens,
        outputTokens: entry.output_tokens,
        estimatedCostUsd: entry.estimated_cost
      }))
    };
  }

  async listBotRoutines(name: string): Promise<BotRoutine[]> {
    const response = await this.request(`/api/cron/jobs?profile=${encodeURIComponent(name)}`, { method: "GET" });
    const jobs = await response.json() as unknown;
    return (Array.isArray(jobs) ? jobs : []).map((job: any) => this.routine(name, job));
  }

  async createBotRoutine(name: string, input: BotRoutineInput): Promise<BotRoutine> {
    const response = await this.request(`/api/cron/jobs?profile=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, deliver: "local" })
    });
    return this.routine(name, await response.json());
  }

  async setBotRoutineEnabled(name: string, routineId: string, enabled: boolean): Promise<BotRoutine> {
    const action = enabled ? "resume" : "pause";
    const response = await this.request(`/api/cron/jobs/${encodeURIComponent(routineId)}/${action}?profile=${encodeURIComponent(name)}`, { method: "POST" });
    return this.routine(name, await response.json());
  }

  async runBotRoutine(name: string, routineId: string): Promise<BotRoutine> {
    const response = await this.request(`/api/cron/jobs/${encodeURIComponent(routineId)}/trigger?profile=${encodeURIComponent(name)}`, { method: "POST" });
    return this.routine(name, await response.json());
  }

  async deleteBotRoutine(name: string, routineId: string): Promise<void> {
    await this.request(`/api/cron/jobs/${encodeURIComponent(routineId)}?profile=${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  async listBotRoutineRuns(name: string, routineId: string, limit = 10): Promise<BotRoutineRun[]> {
    const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)));
    const response = await this.request(`/api/cron/jobs/${encodeURIComponent(routineId)}/runs?profile=${encodeURIComponent(name)}&limit=${safeLimit}`, { method: "GET" });
    const data = await response.json() as { runs?: any[] };
    return Promise.all((data.runs ?? []).map(async (run) => {
      let output = "";
      try {
        const messagesResponse = await this.request(`/api/sessions/${encodeURIComponent(String(run.id))}/messages?profile=${encodeURIComponent(name)}&limit=50&order=latest`, { method: "GET" });
        const messages = (await messagesResponse.json() as { messages?: any[] }).messages ?? [];
        const assistant = [...messages].reverse().find((message) => message?.role === "assistant");
        output = this.messageText(assistant?.display_content ?? assistant?.content ?? assistant?.text);
      } catch { /* A run can exist before its transcript is readable. */ }
      const endReason = String(run.end_reason || "").toLowerCase();
      const status: BotRoutineRun["status"] = run.is_active || !run.ended_at
        ? "running"
        : /error|fail|cancel|interrupt/.test(endReason) ? "error" : "success";
      return {
        id: String(run.id),
        startedAt: Number(run.started_at || 0),
        ...(run.ended_at ? { endedAt: Number(run.ended_at) } : {}),
        status,
        ...(output ? { output } : {}),
        ...(status === "error" && endReason ? { error: String(run.end_reason) } : {})
      };
    }));
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(this.sessionToken ? this.authMode === "oauth" ? { Authorization: `Bearer ${this.sessionToken}` } : { "X-Hermes-Session-Token": this.sessionToken } : {}),
        ...init.headers
      }
    });
    if (!response.ok) {
      const raw = await response.text();
      let detail = raw.trim();
      try {
        const payload = JSON.parse(raw) as { detail?: unknown; error?: unknown; message?: unknown };
        detail = String(payload.detail || payload.error || payload.message || detail);
      } catch { /* Preserve non-JSON Hermes responses. */ }
      throw new Error(detail || `Hermes ${init.method ?? "GET"} ${path} failed (${response.status})`);
    }
    return response;
  }

  private capabilities(value: unknown): BotCapability[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry) => entry?.name)
      .map((entry) => ({
        name: String(entry.name),
        enabled: entry.enabled !== false,
        ...(entry.description ? { description: String(entry.description) } : {}),
        ...(typeof entry.installed === "boolean" ? { installed: entry.installed } : {}),
        ...(typeof entry.fromCatalog === "boolean" ? { fromCatalog: entry.fromCatalog } : {}),
        ...(Array.isArray(entry.requires) ? { requires: entry.requires.map(String) } : {}),
        ...(entry.auth ? { auth: String(entry.auth) } : {}),
        ...(Number(entry.tool_count) > 0 ? { toolCount: Number(entry.tool_count) } : {})
      }));
  }

  private routine(bot: string, job: any): BotRoutine {
    const schedule = job?.schedule && typeof job.schedule === "object"
      ? String(job.schedule.expr || job.schedule.run_at || job.schedule_display || "")
      : String(job?.schedule || "");
    return {
      id: String(job?.id || ""),
      bot,
      name: String(job?.name || "Routine"),
      prompt: String(job?.prompt || ""),
      schedule,
      scheduleDisplay: String(job?.schedule_display || schedule),
      enabled: job?.enabled !== false && job?.state !== "paused",
      state: String(job?.state || (job?.enabled === false ? "paused" : "scheduled")),
      ...(job?.next_run_at ? { nextRunAt: String(job.next_run_at) } : {}),
      ...(job?.last_run_at ? { lastRunAt: String(job.last_run_at) } : {}),
      ...(job?.last_status ? { lastStatus: String(job.last_status) } : {}),
      ...(job?.last_error ? { lastError: String(job.last_error) } : {})
    };
  }

  private messageText(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (!Array.isArray(value)) return "";
    return value.map((part) => typeof part === "string" ? part : String(part?.text || part?.content || "")).join("\n").trim();
  }
}
