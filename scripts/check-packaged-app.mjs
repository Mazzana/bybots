import { _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

if (!["win32", "darwin"].includes(process.platform)) {
  throw new Error("The packaged application smoke test must run on Windows or macOS.");
}

const rootDir = resolve(import.meta.dirname, "..");
const desktopPlatform = process.platform === "win32" ? "windows" : "macos";
const executablePath = process.platform === "win32"
  ? resolve(rootDir, "release", "win-unpacked", "ByBots.exe")
  : resolve(rootDir, "release", "mac-universal", "ByBots.app", "Contents", "MacOS", "ByBots");
const userDataPath = await mkdtemp(resolve(tmpdir(), "bybots-packaged-smoke-"));
const bridgePort = await new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close(() => reject(new Error("Unable to reserve a loopback port.")));
      return;
    }
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});
let desktop;

try {
  desktop = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      BYBOTS_E2E_PORT: String(bridgePort),
      BYBOTS_E2E_USER_DATA: userDataPath,
    },
    timeout: 30_000,
  });
  const window = await desktop.firstWindow({ timeout: 30_000 });
  await window.waitForLoadState("domcontentloaded");
  await window.waitForFunction(() => document.body.innerText.trim().length > 0);

  const applicationUrl = new URL(window.url());
  if (applicationUrl.hostname !== "127.0.0.1" || applicationUrl.port !== String(bridgePort)) {
    throw new Error(`The packaged application opened an unexpected URL: ${window.url()}`);
  }

  if (applicationUrl.searchParams.get("desktop") !== desktopPlatform) {
    throw new Error(`The packaged application did not enable its ${desktopPlatform} desktop presentation.`);
  }

  const health = await window.evaluate(async () => {
    const response = await fetch("/api/health");
    return { status: response.status, body: await response.json() };
  });
  if (health.status !== 200 || health.body?.ok !== true || health.body?.apiVersion !== "1") {
    throw new Error(`The embedded Bridge health check failed: ${JSON.stringify(health)}`);
  }

  if (process.argv.includes("--check-local-hermes")) {
    const localProbe = await window.evaluate(async () => {
      const response = await fetch("/api/hermes/connection/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: "http://127.0.0.1:9120" }),
      });
      return { status: response.status, body: await response.json() };
    });
    if (localProbe.status !== 200 || typeof localProbe.body?.probe?.version !== "string") {
      throw new Error(`The packaged application could not connect to local Hermes: ${JSON.stringify(localProbe)}`);
    }
    console.log(`Packaged ByBots connected to local Hermes ${localProbe.body.probe.version}.`);
  }

  console.log(`Packaged ByBots opened successfully at ${applicationUrl.origin} with Bridge API v1.`);
} finally {
  await desktop?.close();
  await rm(userDataPath, { recursive: true, force: true });
}
