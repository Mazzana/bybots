import type { AppDiagnostics } from "./App";

export const DEFAULT_LOCAL_HERMES_URL = "http://127.0.0.1:9120";

export function isLocalHermesUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(hostname);
  } catch {
    return false;
  }
}

export function isHermesReady(diagnostics: AppDiagnostics) {
  return diagnostics.bridge.status === "ready" && diagnostics.hermes.status === "ready"
    && diagnostics.hermes.compatible !== false && diagnostics.authentication.status === "ready";
}
