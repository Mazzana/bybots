export type ReleaseCheck =
  | { status: "available"; version: string; url: string }
  | { status: "current" | "no-stable-release" | "unavailable" };

const endpoint = "https://api.github.com/repos/Mazzana/bybots/releases/latest";
const releases = "https://github.com/Mazzana/bybots/releases/tag/";
const maxBytes = 128 * 1024;

function versionParts(value: string) {
  if (value.length > 128) return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) return null;
  const core = match.slice(1, 4).map(Number);
  if (!core.every(Number.isSafeInteger)) return null;
  for (const [index, suffix] of [match[4], match[5]].entries()) {
    if (suffix && suffix.split(".").some((part) => !part || (index === 0 && /^0\d+$/.test(part)))) return null;
  }
  return { core, preview: Boolean(match[4]) };
}

export function evaluateRelease(currentVersion: string, value: unknown): ReleaseCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { status: "unavailable" };
  const release = value as Record<string, unknown>;
  const tag = release.tag_name;
  if (release.draft !== false || release.prerelease !== false || typeof tag !== "string") return { status: "unavailable" };
  const version = tag.replace(/^v/, "");
  const current = versionParts(currentVersion);
  const candidate = versionParts(version);
  if (!current || !candidate || candidate.preview) return { status: "unavailable" };
  // Derive the destination from the fixed repository, never from html_url/assets.
  let newer = current.preview;
  for (let index = 0; index < 3; index++) {
    if (candidate.core[index] !== current.core[index]) {
      newer = candidate.core[index] > current.core[index];
      break;
    }
  }
  return newer ? { status: "available", version, url: releases + encodeURIComponent(tag) } : { status: "current" };
}

/** Read-only and idle until check(): no token, download, installation, or startup request. */
export class ReleaseChecker {
  private pending?: Promise<ReleaseCheck>;
  private cached?: { at: number; result: ReleaseCheck };
  constructor(private readonly currentVersion: string, private readonly fetcher: typeof fetch = fetch, private readonly now = Date.now) {}

  async check(): Promise<ReleaseCheck> {
    if (this.cached && this.now() - this.cached.at < 60_000) return { ...this.cached.result };
    this.pending ??= this.load().then((result) => {
      this.cached = { at: this.now(), result };
      return result;
    }).finally(() => { this.pending = undefined; });
    return { ...await this.pending };
  }

  private async load(): Promise<ReleaseCheck> {
    try {
      const response = await this.fetcher(endpoint, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "ByBots-release-check" },
        signal: AbortSignal.timeout(8_000), redirect: "error", credentials: "omit"
      });
      if (response.status === 404) return { status: "no-stable-release" };
      if (!response.ok || !response.body) return { status: "unavailable" };
      const reader = response.body.getReader();
      let text = "";
      let size = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxBytes) { await reader.cancel(); return { status: "unavailable" }; }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      return evaluateRelease(this.currentVersion, JSON.parse(text));
    } catch { return { status: "unavailable" }; }
  }
}
