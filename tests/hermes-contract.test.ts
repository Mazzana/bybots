import { describe, expect, it, vi } from "vitest";
import { checkHermesContract } from "../server/hermes-contract";

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

describe("Hermes 0.21 compatibility contract", () => {
  it("supports a public health-only probe", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ ok: true, version: "0.21.0", auth_required: true }));

    await expect(checkHermesContract({
      baseUrl: "http://127.0.0.1:9119/",
      fetcher,
      healthOnly: true
    })).resolves.toEqual({
      version: "0.21.0",
      checks: [{ name: "health", detail: "Hermes 0.21.0" }]
    });
  });

  it("validates the authenticated REST and JSON-RPC surfaces used by Bots", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/health")) return json({ ok: true, version: "0.21.4" });
      if (url.endsWith("/api/profiles")) return json({ profiles: [{ name: "default" }] });
      if (url.includes("/api/cron/jobs")) return json({ jobs: [] });
      throw new Error(`unexpected ${url}`);
    });
    const gateway = {
      request: vi.fn(async (method: string) => {
        if (method === "profiles.list") return { profiles: [{ name: "default" }] };
        if (method === "session.list") return { sessions: [] };
        if (method === "model.options") return { providers: [{ slug: "openai-codex" }] };
        if (method === "mcp.catalog") return { servers: [] };
        throw new Error(`unexpected ${method}`);
      })
    };

    const report = await checkHermesContract({
      baseUrl: "http://127.0.0.1:9119",
      fetcher: fetcher as typeof fetch,
      gateway,
      sessionToken: "secret"
    });

    expect(report.checks.map((check) => check.name)).toEqual([
      "health",
      "rest.profiles",
      "rpc.profiles.list",
      "rpc.session.list",
      "rpc.model.options",
      "rpc.mcp.catalog",
      "rest.cron.jobs"
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:9119/api/profiles",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Hermes-Session-Token": "secret" }) })
    );
  });

  it("rejects an incompatible Hermes release", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ ok: true, version: "0.22.0" }));

    await expect(checkHermesContract({
      baseUrl: "http://127.0.0.1:9119",
      fetcher,
      healthOnly: true
    })).rejects.toThrow("Expected Hermes 0.21.x but found 0.22.0");
  });
});
