export const DEFAULT_LOCAL_HERMES_URL = "http://127.0.0.1:9120";

export function isLocalHermesUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
  } catch {
    return false;
  }
}
