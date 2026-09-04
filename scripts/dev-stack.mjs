import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const token = randomBytes(32).toString("base64url");
const env = {
  ...process.env,
  HERMES_DASHBOARD_SESSION_TOKEN: token,
  HERMES_URL: "http://127.0.0.1:9120"
};
const children = [];

function run(command) {
  const child = spawn(command, { env, shell: true, stdio: "inherit" });
  children.push(child);
  child.on("exit", (code) => {
    if (code && !shuttingDown) shutdown(code);
  });
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 250).unref();
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
process.on("exit", () => { for (const child of children) child.kill(); });

const production = process.argv.includes("--production");
run("hermes serve --host 127.0.0.1 --port 9120 --skip-build");
run(production ? "npm start" : "npm run dev:server");
if (!production) run("npm run dev:web");

if (process.argv.includes("--desktop")) {
  run("npx wait-on http://127.0.0.1:5188/api/health && npx electron .");
}
