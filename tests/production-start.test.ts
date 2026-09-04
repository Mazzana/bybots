import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json";

describe("production runtime boundary", () => {
  it("starts only the built Bridge and never starts a second Hermes runtime", () => {
    expect(packageJson.scripts.start).toBe("node dist-server/index.js");
    expect(packageJson.scripts.start).not.toMatch(/dev-stack|hermes/i);
  });

  it("keeps Electron dependencies external so CommonJS packages load natively", () => {
    const buildScript = readFileSync("scripts/build-electron.mjs", "utf8");
    expect(buildScript).toContain('packages: "external"');
  });

  it("keeps the production container on host loopback with a dedicated exchange mount", () => {
    const compose = readFileSync("compose.production.yaml", "utf8");
    expect(compose).toContain("network_mode: host");
    expect(compose).toContain("BYFINITY_HOST: 127.0.0.1");
    expect(compose).toContain("BYFINITY_HERMES_EXCHANGE_DIR: /var/lib/byfinity-bots/exchange");
    expect(compose).not.toMatch(/ports:\s*\n/);
  });
});
