import { describe, expect, it, vi } from "vitest";
import { extractHermesDashboardToken, resolveLocalHermesSessionToken } from "../server/hermes-local-token";

describe("local Hermes session-token discovery", () => {
  it("extracts the JSON-encoded token served by the Hermes bootstrap page", () => {
    expect(extractHermesDashboardToken('<script>window.__HERMES_SESSION_TOKEN__="served-token";</script>')).toBe("served-token");
    expect(extractHermesDashboardToken('<script>window.__HERMES_SESSION_TOKEN__="served\\\\token\\\"quoted";</script>')).toBe('served\\token"quoted');
    expect(extractHermesDashboardToken("window.__HERMES_SESSION_TOKEN__={invalid}")).toBe("");
  });

  it("falls back to an explicitly configured token when Hermes is unavailable", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(resolveLocalHermesSessionToken("http://127.0.0.1:9120", " configured ", fetcher)).resolves.toBe("configured");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("adopts the token served by an unauthenticated loopback Hermes", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ auth_required: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response('<script>window.__HERMES_SESSION_TOKEN__="local-session";</script>', { status: 200 }));

    await expect(resolveLocalHermesSessionToken("http://127.0.0.1:9120", "", fetcher)).resolves.toBe("local-session");
    expect(fetcher).toHaveBeenNthCalledWith(1, "http://127.0.0.1:9120/api/status", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "http://127.0.0.1:9120/", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("never discovers a token from a remote or OAuth-gated gateway", async () => {
    const remoteFetcher = vi.fn();
    await expect(resolveLocalHermesSessionToken("https://hermes.example.test", "", remoteFetcher)).resolves.toBe("");
    expect(remoteFetcher).not.toHaveBeenCalled();

    const gatedFetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ auth_required: true }), { status: 200 }));
    await expect(resolveLocalHermesSessionToken("http://localhost:9120", "", gatedFetcher)).resolves.toBe("");
    expect(gatedFetcher).toHaveBeenCalledTimes(1);
  });
});
