import { isIP } from "node:net";

const DEFAULT_DISCOVERY_TIMEOUT_MS = 3_000;
const MAX_BOOTSTRAP_HTML_CHARS = 128_000;
const MAX_SESSION_TOKEN_CHARS = 16_384;

export function extractHermesDashboardToken(html: string) {
  const match = /window\.__HERMES_SESSION_TOKEN__\s*=\s*("(?:\\.|[^"\\])*")/.exec(html);
  if (!match) return "";
  try {
    const token = JSON.parse(match[1]);
    return typeof token === "string" && token.length <= MAX_SESSION_TOKEN_CHARS ? token : "";
  } catch {
    return "";
  }
}

function isLoopbackUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return hostname === "localhost"
      || hostname === "::1"
      || (isIP(hostname) === 4 && Number(hostname.split(".")[0]) === 127);
  } catch {
    return false;
  }
}

export async function resolveLocalHermesSessionToken(
  baseUrl: string,
  configuredToken: string,
  fetcher: typeof fetch = fetch,
) {
  const fallback = configuredToken.trim();
  if (!isLoopbackUrl(baseUrl)) return fallback;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_DISCOVERY_TIMEOUT_MS);
  timer.unref?.();
  try {
    const normalized = baseUrl.replace(/\/+$/, "");
    const statusResponse = await fetcher(`${normalized}/api/status`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!statusResponse.ok) return fallback;
    const status = await statusResponse.json() as { auth_required?: unknown };
    if (status.auth_required !== false) return fallback;

    const indexResponse = await fetcher(`${normalized}/`, {
      headers: { accept: "text/html" },
      signal: controller.signal,
    });
    if (!indexResponse.ok) return fallback;
    const html = await indexResponse.text();
    if (html.length > MAX_BOOTSTRAP_HTML_CHARS) return fallback;
    return extractHermesDashboardToken(html) || fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
