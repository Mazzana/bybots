import { expect, it, vi } from "vitest";
import { evaluateRelease, ReleaseChecker } from "../electron/release-checker";
import { trustedUpdateRequest } from "../electron/update-ipc";

const release = (tag_name = "v0.4.0") => ({ tag_name, draft: false, prerelease: false });
it("accepts only the application's top-level IPC frame on its expected origin", () => {
  const frame = { url: "http://127.0.0.1:5188/?desktop=windows" };
  const main = { mainFrame: frame };
  const event = { sender: main, senderFrame: frame };
  const trusted = (value: unknown, window: unknown = main) => trustedUpdateRequest(value as any, window as any, "http://127.0.0.1:5188/");
  expect(trusted(event)).toBe(true);
  expect(trusted({ ...event, sender: {} })).toBe(false);
  expect(trusted({ ...event, senderFrame: { ...frame } })).toBe(false);
  expect(trustedUpdateRequest(event as any, undefined, "http://127.0.0.1:5188/")).toBe(false);
  expect(trusted(event, null)).toBe(false);
  frame.url = "https://external.test/";
  expect(trusted(event)).toBe(false);
  frame.url = "not a URL";
  expect(trusted(event)).toBe(false);
});
it("compares numeric versions and stable releases against previews without downgrading", () => {
  expect(evaluateRelease("0.3.1-alpha.1", release("v0.3.1"))).toMatchObject({ status: "available", version: "0.3.1" });
  expect(evaluateRelease("0.9.0", release("v0.10.0"))).toMatchObject({ status: "available" });
  for (const current of ["0.4.0", "0.4.0+build.7", "0.5.0-alpha.1", "1.0.0"]) {
    expect(evaluateRelease(current, release())).toEqual({ status: "current" });
  }
});

it("fails closed for drafts, previews, invalid versions and unexpected payloads", () => {
  for (const value of [null, [], {}, { ...release(), draft: true }, { ...release(), prerelease: true },
    ...["v1.0.0-beta.1", "v01.0.0", "v1.0", "v1.0.0/../../evil", "v1.0.0-01", "v1.0.0+a..b", "v9999999999999999999.0.0"].map(release)]) {
    expect(evaluateRelease("0.3.1", value)).toEqual({ status: "unavailable" });
  }
  expect(evaluateRelease("broken", release())).toEqual({ status: "unavailable" });
});

it("constructs the release link on the fixed repository and ignores remote URLs and notes", () => {
  expect(evaluateRelease("0.3.1", { ...release(), html_url: "https://evil.test", body: "secret", assets: [{ browser_download_url: "file:///bad" }] }))
    .toEqual({ status: "available", version: "0.4.0", url: "https://github.com/Mazzana/bybots/releases/tag/v0.4.0" });
});

it("stays idle until requested, shares concurrent checks and caches results for one minute", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
  let time = 0;
  const checker = new ReleaseChecker("0.3.1", fetcher, () => time);
  expect(fetcher).not.toHaveBeenCalled();
  const first = checker.check();
  const second = checker.check();
  expect(fetcher).toHaveBeenCalledTimes(1);
  finish(Response.json(release()));
  const result = await first;
  expect(await second).toEqual(result);
  expect(await checker.check()).toEqual(result);
  expect(fetcher).toHaveBeenCalledTimes(1);
  if (result.status === "available") result.url = "tampered";
  expect(await checker.check()).toHaveProperty("url", "https://github.com/Mazzana/bybots/releases/tag/v0.4.0");
  time = 60_001;
  const third = checker.check();
  finish(new Response(null, { status: 404 }));
  expect(await third).toEqual({ status: "no-stable-release" });
  const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.github.com/repos/Mazzana/bybots/releases/latest");
  expect(options).toMatchObject({ redirect: "error", credentials: "omit" });
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.stringify(options.headers)).not.toMatch(/authorization|token/i);
});

it("reports offline, rate-limited and oversized responses without exposing raw errors", async () => {
  for (const response of [new Response(null, { status: 403 }), new Response(null, { status: 429 }), new Response("not JSON"), new Response("a".repeat(128 * 1024 + 1))]) {
    expect(await new ReleaseChecker("0.3.1", vi.fn(async () => response)).check()).toEqual({ status: "unavailable" });
  }
  expect(await new ReleaseChecker("0.3.1", vi.fn(async () => { throw new Error("private proxy credentials"); })).check()).toEqual({ status: "unavailable" });
});
