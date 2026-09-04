import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BridgeRuntime } from "../server/runtime";
import { startBridge } from "../server/runtime";

describe("embedded Bridge runtime", () => {
  let runtime: BridgeRuntime | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    await runtime?.close();
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    runtime = undefined;
    temporaryDirectory = undefined;
  });

  it("starts on an available loopback port and serves its health endpoint", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "byfinity-bridge-"));
    runtime = await startBridge({
      host: "127.0.0.1",
      port: 0,
      hermesSessionToken: "test-session",
      configFile: join(temporaryDirectory, "connection.json")
    });

    const response = await fetch(`${runtime.url}/api/health`);

    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ ok: true, apiVersion: "1" });
    expect(response.headers.get("x-byfinity-bridge-api-version")).toBe("1");
    expect(new URL(runtime.url).hostname).toBe("127.0.0.1");
  });

  it("does not mistake a hostname beginning with 127 for a loopback address", async () => {
    await expect(startBridge({ host: "127.example.test", port: 0 })).rejects.toThrow(
      "At least one BYFINITY_*_TOKEN is required"
    );
  });
});
