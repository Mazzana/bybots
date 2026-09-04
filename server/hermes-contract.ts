interface GatewayPort {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface HermesContractCheck {
  name: string;
  detail: string;
}

export interface HermesContractReport {
  version: string;
  checks: HermesContractCheck[];
}

interface HermesContractOptions {
  baseUrl: string;
  expectedMinor?: string;
  fetcher?: typeof fetch;
  gateway?: GatewayPort;
  healthOnly?: boolean;
  sessionToken?: string;
  timeoutMs?: number;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchJson(
  fetcher: typeof fetch,
  url: string,
  timeoutMs: number,
  sessionToken?: string
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      headers: {
        accept: "application/json",
        ...(sessionToken ? { "X-Hermes-Session-Token": sessionToken } : {})
      },
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHermesContract({
  baseUrl,
  expectedMinor = "0.21",
  fetcher = fetch,
  gateway,
  healthOnly = false,
  sessionToken,
  timeoutMs = 8_000
}: HermesContractOptions): Promise<HermesContractReport> {
  const normalizedUrl = baseUrl.replace(/\/$/, "");
  const checks: HermesContractCheck[] = [];
  const health = await fetchJson(fetcher, `${normalizedUrl}/api/health`, timeoutMs);
  assertRecord(health, "GET /api/health response");
  if (health.ok !== true) throw new Error("GET /api/health did not report ok: true");
  const version = String(health.version || "");
  if (!version) throw new Error("GET /api/health did not report a Hermes version");
  if (expectedMinor && version !== expectedMinor && !version.startsWith(`${expectedMinor}.`)) {
    throw new Error(`Expected Hermes ${expectedMinor}.x but found ${version}`);
  }
  checks.push({ name: "health", detail: `Hermes ${version}` });

  if (healthOnly) return { version, checks };
  if (!sessionToken || !gateway) {
    throw new Error("Authenticated checks require HERMES_DASHBOARD_SESSION_TOKEN");
  }

  const restProfiles = await fetchJson(fetcher, `${normalizedUrl}/api/profiles`, timeoutMs, sessionToken);
  const restProfileList = Array.isArray(restProfiles)
    ? restProfiles
    : (assertRecord(restProfiles, "GET /api/profiles response"), restProfiles.profiles);
  assertArray(restProfileList, "GET /api/profiles profiles");
  checks.push({ name: "rest.profiles", detail: `${restProfileList.length} profile(s)` });

  const profiles = await withTimeout(gateway.request("profiles.list", {}), timeoutMs, "profiles.list");
  assertRecord(profiles, "profiles.list response");
  assertArray(profiles.profiles, "profiles.list profiles");
  checks.push({ name: "rpc.profiles.list", detail: `${profiles.profiles.length} profile(s)` });

  const sessions = await withTimeout(
    gateway.request("session.list", { profile: "default", limit: 1, include_hidden: true }),
    timeoutMs,
    "session.list"
  );
  assertRecord(sessions, "session.list response");
  assertArray(sessions.sessions, "session.list sessions");
  checks.push({ name: "rpc.session.list", detail: "recent-order contract available" });

  const models = await withTimeout(
    gateway.request("model.options", { include_unconfigured: true, explicit_only: false }),
    timeoutMs,
    "model.options"
  );
  assertRecord(models, "model.options response");
  assertArray(models.providers, "model.options providers");
  checks.push({ name: "rpc.model.options", detail: `${models.providers.length} provider(s)` });

  const mcp = await withTimeout(
    gateway.request("mcp.catalog", { profile: "default" }),
    timeoutMs,
    "mcp.catalog"
  );
  assertRecord(mcp, "mcp.catalog response");
  assertArray(mcp.servers, "mcp.catalog servers");
  checks.push({ name: "rpc.mcp.catalog", detail: `${mcp.servers.length} server(s)` });

  const routines = await fetchJson(
    fetcher,
    `${normalizedUrl}/api/cron/jobs?profile=default`,
    timeoutMs,
    sessionToken
  );
  const routineList = Array.isArray(routines)
    ? routines
    : (assertRecord(routines, "GET /api/cron/jobs response"), routines.jobs);
  assertArray(routineList, "GET /api/cron/jobs jobs");
  checks.push({ name: "rest.cron.jobs", detail: `${routineList.length} routine(s)` });

  return { version, checks };
}
