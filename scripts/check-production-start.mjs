import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporary = await mkdtemp(join(tmpdir(), "byfinity-production-start-"));
const child = spawn(process.execPath, ["dist-server/index.js"], {
  env: {
    ...process.env,
    BYFINITY_HOST: "127.0.0.1",
    BYFINITY_PORT: "0",
    BYFINITY_CONFIG_FILE: join(temporary, "connection.json")
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Production Bridge did not start in time. ${stderr}`)), 10_000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Production Bridge exited before startup (${code}). ${stderr}`));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/Byfinity Bridge listening on (http:\/\/\S+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
  });
  const response = await fetch(`${url}/api/health`);
  if (!response.ok || (await response.json()).ok !== true) throw new Error("Production Bridge health check failed");
  console.log(`Production Bridge health check passed at ${url}`);
} finally {
  child.kill();
  await rm(temporary, { recursive: true, force: true });
}
