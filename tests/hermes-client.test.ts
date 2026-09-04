import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { HermesClient } from "../server/hermes-client";

describe("HermesClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists Hermes profiles as dynamic bots", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ profiles: [{ name: "default" }, { name: "research" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", fetcher, sessionToken: "local-token" });

    await expect(client.listBots()).resolves.toEqual([
      { name: "default", system: true, machine: "local" },
      { name: "research", system: false, machine: "local" }
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:9119/api/profiles",
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ "X-Hermes-Session-Token": "local-token" }) })
    );
  });

  it("falls back to the Hermes REST profile endpoint without a gateway", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, name: "analyst", path: "profiles/analyst" }), { status: 200 })
    );
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", fetcher });

    await expect(client.createBot({ name: "analyst", description: "Analyse les données." })).resolves.toEqual({
      name: "analyst",
      system: false,
      machine: "local"
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:9119/api/profiles",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "analyst", description: "Analyse les données." })
      })
    );
  });

  it("creates a ready-to-run profile through the native Hermes gateway", async () => {
    const gateway = { request: vi.fn().mockResolvedValue({ ok: true, name: "analyst", soul_written: true }) };
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", gateway });

    await expect(client.createBot({ name: "Analyst", description: "Analyse les données." })).resolves.toEqual({
      name: "analyst",
      system: false,
      machine: "local",
      description: "Analyse les données."
    });
    expect(gateway.request).toHaveBeenCalledWith("profiles.create", {
      name: "Analyst",
      description: "Analyse les données.",
      share_auth: true
    });
  });

  it("stores optional title, description, Blobatar and Petdex image after profile creation", async () => {
    const gateway = {
      request: vi.fn(async (method: string) => {
        if (method === "profiles.create") return { name: "inbox-triage" };
        if (method === "profiles.configure") return { applied: { ui_meta: true } };
        if (method === "profiles.set_asset") return { ok: true };
        throw new Error(`unexpected ${method}`);
      })
    };
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", gateway });

    await expect(client.createBot({
      name: "inbox-triage",
      title: "Inbox Triage",
      description: "Sort incoming mail.",
      avatar: { shape: "blobatar::round", image: "data:image/png;base64,pet" }
    })).resolves.toMatchObject({
      name: "inbox-triage",
      title: "Inbox Triage",
      description: "Sort incoming mail.",
      avatar: { shape: "blobatar::round", image: "data:image/png;base64,pet" }
    });
    expect(gateway.request).toHaveBeenNthCalledWith(1, "profiles.create", {
      name: "inbox-triage",
      description: "Sort incoming mail.",
      share_auth: true
    });
    expect(gateway.request).toHaveBeenNthCalledWith(2, "profiles.configure", {
      name: "inbox-triage",
      ui_meta: { "hermes-bots": { title: "Inbox Triage", shape: "blobatar::round", custom: true } }
    });
    expect(gateway.request).toHaveBeenNthCalledWith(3, "profiles.set_asset", {
      name: "inbox-triage", asset: "avatar", data: "data:image/png;base64,pet"
    });
  });

  it("adapts the native Hermes Petdex gallery", async () => {
    const gateway = { request: vi.fn().mockResolvedValue({ pets: [{ slug: "pixel-fox", displayName: "Pixel Fox", spritesheetUrl: "https://pets.test/fox.webp", installed: true }] }) };
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", gateway });

    await expect(client.listAvatarPets()).resolves.toEqual([{ slug: "pixel-fox", displayName: "Pixel Fox", spritesheetUrl: "https://pets.test/fox.webp", installed: true }]);
    expect(gateway.request).toHaveBeenCalledWith("pet.gallery", {});
  });

  it("downloads only Petdex-hosted sprites and reuses the cached Hermes gallery", async () => {
    const gateway = { request: vi.fn().mockResolvedValue({ pets: [{ slug: "pixel-fox", displayName: "Pixel Fox", spritesheetUrl: "https://assets.petdex.dev/pets/fox/sprite.webp" }] }) };
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/webp", "content-length": "3" } }));
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", gateway, fetcher });

    await expect(client.getAvatarPetSprite("pixel-fox")).resolves.toEqual({ data: new Uint8Array([1, 2, 3]), contentType: "image/webp" });
    expect(gateway.request).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(new URL("https://assets.petdex.dev/pets/fox/sprite.webp"));
  });

  it("preserves the Hermes validation detail returned by REST", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Profile 'analyst' already exists" }), { status: 400 }));
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", fetcher });

    await expect(client.createBot({ name: "analyst", description: "Analyse les données." })).rejects.toThrow("Profile 'analyst' already exists");
  });

  it("deletes a named profile but protects the Hermes default profile", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", fetcher });

    await expect(client.deleteBot("research")).resolves.toBeUndefined();
    await expect(client.deleteBot("default")).rejects.toThrow(/cannot be deleted/i);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:9119/api/profiles/research",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("exports a Hermes profile through an isolated temporary archive", async () => {
    const exchangeRoot = await mkdtemp(join(tmpdir(), "byfinity-exchange-test-"));
    let generatedPath = "";
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      generatedPath = String(JSON.parse(String(init?.body)).output);
      await writeFile(generatedPath, new Uint8Array([0x1f, 0x8b, 1, 2]));
      return new Response(JSON.stringify({ ok: true, archive: generatedPath }), { status: 200 });
    });
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", fetcher: fetcher as typeof fetch, profileExchangeDir: exchangeRoot });

    try {
      await expect(client.exportBot("finance")).resolves.toEqual({
        data: new Uint8Array([0x1f, 0x8b, 1, 2]),
        filename: "finance.tar.gz"
      });
      expect(resolve(generatedPath).startsWith(`${resolve(exchangeRoot)}${sep}`)).toBe(true);
      await expect(readFile(generatedPath)).rejects.toThrow();
    } finally {
      await rm(exchangeRoot, { recursive: true, force: true });
    }
  });

  it("imports a gzip archive and refreshes the Hermes profile metadata", async () => {
    const exchangeRoot = await mkdtemp(join(tmpdir(), "byfinity-exchange-test-"));
    let stagedPath = "";
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/profiles/import")) {
        const body = JSON.parse(String(init?.body));
        stagedPath = body.archive;
        expect(body.name).toBe("research-copy");
        await expect(readFile(stagedPath)).resolves.toEqual(Buffer.from([0x1f, 0x8b, 1, 2]));
        return new Response(JSON.stringify({ ok: true, name: "research-copy" }), { status: 200 });
      }
      if (url.endsWith("/api/profiles")) {
        return new Response(JSON.stringify({ profiles: [{ name: "research-copy" }] }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", fetcher: fetcher as typeof fetch, profileExchangeDir: exchangeRoot });

    try {
      await expect(client.importBot(new Uint8Array([0x1f, 0x8b, 1, 2]), "research-copy")).resolves.toEqual({
        name: "research-copy",
        system: false,
        machine: "local"
      });
      expect(resolve(stagedPath).startsWith(`${resolve(exchangeRoot)}${sep}`)).toBe(true);
      await expect(readFile(stagedPath)).rejects.toThrow();
    } finally {
      await rm(exchangeRoot, { recursive: true, force: true });
    }
  });

  it("loads Hermes Bot metadata and its stored avatar asset", async () => {
    const gateway = {
      request: vi.fn(async (method: string) => {
        if (method === "profiles.list") return {
          profiles: [{
            name: "analyst",
            display_name: "Analyste",
            description: "Analyse les données",
            title: "Data analyst",
            has_avatar: true,
            ui_meta: { "hermes-bots": { shape: "blobatar:seed:round", color: "#7170ff", custom: true } }
          }]
        };
        if (method === "profiles.get_asset") return { found: true, data: "data:image/png;base64,abc" };
        throw new Error(`unexpected ${method}`);
      })
    };
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", gateway });

    await expect(client.listBots()).resolves.toEqual([{
      name: "analyst",
      system: false,
      machine: "local",
      displayName: "Analyste",
      description: "Analyse les données",
      title: "Data analyst",
      avatar: { shape: "blobatar:seed:round", color: "#7170ff", image: "data:image/png;base64,abc" }
    }]);
    expect(gateway.request).toHaveBeenCalledWith("profiles.get_asset", { name: "analyst", asset: "avatar" });
  });

  it("updates the Hermes avatar without dropping other Bot metadata", async () => {
    const gateway = {
      request: vi.fn(async (method: string) => {
        if (method === "profiles.list") return {
          profiles: [{ name: "analyst", ui_meta: { "hermes-bots": { title: "Data", groups: ["Ops"], shape: "circle" } } }]
        };
        if (method === "profiles.configure") return { applied: { ui_meta: true } };
        throw new Error(`unexpected ${method}`);
      })
    };
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", gateway });

    await client.updateBotAvatar("analyst", { shape: "blobatar:new:cloud", color: "#5e6ad2" });

    expect(gateway.request).toHaveBeenCalledWith("profiles.configure", {
      name: "analyst",
      ui_meta: {
        "hermes-bots": {
          title: "Data",
          groups: ["Ops"],
          shape: "blobatar:new:cloud",
          color: "#5e6ad2",
          custom: true
        }
      }
    });
  });

  it("loads a Bot capability inventory from the Hermes gateway", async () => {
    const gateway = {
      request: vi.fn(async (method: string) => {
        if (method === "profiles.describe") return {
          model: { provider: "openai-codex", default: "gpt-5.6-terra" },
          soul: "Tu es le Bot finance.",
          skills: [{ name: "spreadsheets", enabled: true }, { name: "email", enabled: false }],
          toolsets: [{ name: "file", enabled: true, tool_count: 4 }],
          mcp_servers: [{ name: "neon", enabled: true }]
        };
        if (method === "mcp.catalog") return { servers: [{ name: "neon" }, { name: "stripe", installed: false, requires: ["STRIPE_KEY"] }] };
        if (method === "model.options") return { providers: [{ slug: "openai-codex", name: "OpenAI Codex", models: ["gpt-5.6-terra"] }] };
        throw new Error(`unexpected ${method}`);
      })
    };
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", gateway });

    await expect(client.getBotConfiguration("finance")).resolves.toMatchObject({
      bot: "finance",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      skills: [{ name: "spreadsheets", enabled: true }, { name: "email", enabled: false }],
      toolsets: [{ name: "file", enabled: true, toolCount: 4 }],
      mcpServers: [{ name: "neon", enabled: true }, { name: "stripe", enabled: false, fromCatalog: true }]
    });
  });

  it("tests an installed MCP server and exposes only a bounded tool inventory", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      tools: [{ name: "search_records", description: "private implementation detail" }, { name: "create_record" }, { invalid: true }]
    }), { status: 200 }));
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9120", fetcher: fetcher as typeof fetch, sessionToken: "token" });

    await expect(client.testMcpServer("finance", "airtable local")).resolves.toEqual({
      server: "airtable local",
      toolCount: 2,
      tools: ["search_records", "create_record"]
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:9120/api/mcp/servers/airtable%20local/test?profile=finance",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("updates identity and least-privilege capability pins without dropping Bot metadata", async () => {
    const gateway = {
      request: vi.fn(async (method: string) => {
        if (method === "profiles.list") return { profiles: [{ name: "finance", ui_meta: { "hermes-bots": { shape: "circle", groups: ["Direction"] } } }] };
        if (method === "profiles.configure") return { applied: { ui_meta: true, model: true, soul: true, skills: true, toolsets: true, mcp_servers: true } };
        if (method === "cli.exec") return { code: 0, blocked: false };
        throw new Error(`unexpected ${method}`);
      })
    };
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", gateway });

    await expect(client.updateBot("finance", {
      title: "Directeur financier",
      description: "Contrôle les budgets.",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      soul: "Reste factuel.",
      disabledSkills: ["email"],
      enabledToolsets: ["file"],
      enabledMcpServers: ["neon"]
    })).resolves.toMatchObject({ confirmRequired: false, applied: { description: true, model: true } });

    expect(gateway.request).toHaveBeenCalledWith("profiles.configure", {
      name: "finance",
      ui_meta: { "hermes-bots": { shape: "circle", groups: ["Direction"], title: "Directeur financier" } },
      soul: "Reste factuel.",
      disabled_skills: ["email"],
      enabled_toolsets: ["file"],
      enabled_mcp_servers: ["neon"],
      model: "gpt-5.6-terra",
      provider: "openai-codex"
    });
    expect(gateway.request).toHaveBeenCalledWith("cli.exec", {
      argv: ["profile", "describe", "finance", "--text", "Contrôle les budgets."]
    });
  });

  it("adapts native Hermes cron jobs and their run transcripts as Bot routines", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/cron/jobs/job-1/runs")) return new Response(JSON.stringify({ runs: [{ id: "cron_job-1_1", started_at: 100, ended_at: 110, end_reason: "completed" }] }), { status: 200 });
      if (url.includes("/api/sessions/cron_job-1_1/messages")) return new Response(JSON.stringify({ messages: [{ role: "assistant", content: "Rapport terminé." }] }), { status: 200 });
      if (url.endsWith("/api/cron/jobs?profile=finance") && init?.method === "POST") return new Response(JSON.stringify({ id: "job-1", name: "Rapport", prompt: "Prépare le rapport", schedule: { expr: "0 9 * * *" }, schedule_display: "Tous les jours à 09:00", enabled: true, state: "scheduled" }), { status: 200 });
      if (url.endsWith("/api/cron/jobs?profile=finance")) return new Response(JSON.stringify([{ id: "job-1", name: "Rapport", prompt: "Prépare le rapport", schedule: { expr: "0 9 * * *" }, schedule_display: "Tous les jours à 09:00", enabled: true, state: "scheduled" }]), { status: 200 });
      throw new Error(`unexpected ${url}`);
    });
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9120", fetcher: fetcher as typeof fetch, sessionToken: "token" });

    await expect(client.listBotRoutines("finance")).resolves.toMatchObject([{ id: "job-1", bot: "finance", schedule: "0 9 * * *", enabled: true }]);
    await expect(client.createBotRoutine("finance", { name: "Rapport", prompt: "Prépare le rapport", schedule: "0 9 * * *" })).resolves.toMatchObject({ id: "job-1", name: "Rapport" });
    expect(JSON.parse(String(fetcher.mock.calls.find(([url, init]) => String(url).endsWith("/api/cron/jobs?profile=finance") && init?.method === "POST")?.[1]?.body))).toMatchObject({ deliver: "local" });
    await expect(client.listBotRoutineRuns("finance", "job-1")).resolves.toEqual([{ id: "cron_job-1_1", startedAt: 100, endedAt: 110, status: "success", output: "Rapport terminé." }]);
  });

  it("lists the local runtime and configured Hermes peers without exposing keys", async () => {
    const gateway = { request: vi.fn().mockResolvedValue({ code: 0, stdout: "studio\thttp://studio.lan:8377\t[key set]\nbackup\thttps://backup.example\t[NO KEY (HERMES_PEER_KEY_BACKUP unset)]" }) };
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9120", gateway });

    await expect(client.listMachines()).resolves.toEqual([
      { id: "local", name: "This device", kind: "local", status: "connected" },
      { id: "studio", name: "studio", url: "http://studio.lan:8377", kind: "peer", status: "configured" },
      { id: "backup", name: "backup", url: "https://backup.example", kind: "peer", status: "needs_auth" }
    ]);
    expect(gateway.request).toHaveBeenCalledWith("cli.exec", { argv: ["peer", "list"] });
  });
});
