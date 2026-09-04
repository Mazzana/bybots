import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const diagnostics = {
  checkedAt: "2026-09-03T18:00:00.000Z",
  supportedHermes: "0.21.x",
  bridge: { status: "ready", version: "0.3.0-alpha.6" },
  hermes: { status: "ready", baseUrl: "http://127.0.0.1:9120", version: "0.21.4", compatible: true },
  authentication: { status: "ready" }
};

const bots = [
  { name: "launch", title: "Launch Copilot", description: "Turns product context into focused plans and polished deliverables", system: false, avatar: { shape: "blobatar:launch-copilot:sun" } },
  { name: "research", title: "Research Scout", description: "Finds the signals, sources, and risks that matter", system: false, avatar: { shape: "blobatar:research-scout:cloud" } },
  { name: "operations", title: "Ops Navigator", description: "Keeps projects, routines, and next actions moving", system: false, avatar: { shape: "blobatar:ops-navigator:hexagon" } }
];

const threadsByBot = {
  launch: [
    { id: "launch-command-center", bot: "launch", title: "Launch command center", preview: "Your brief, launch plan, and weekly pulse are ready.", startedAt: 1788460200, messageCount: 4, running: false },
    { id: "positioning", bot: "launch", title: "Positioning workshop", preview: "One promise, three proof points, and a sharper CTA.", startedAt: 1788370200, messageCount: 9, running: false }
  ],
  research: [
    { id: "competitive-brief", bot: "research", title: "Competitive brief", preview: "Three market signals distilled into one clear page.", startedAt: 1788280200, messageCount: 2, running: false }
  ],
  operations: [
    { id: "weekly-review", bot: "operations", title: "Weekly review", preview: "The team’s priorities and owners are aligned.", startedAt: 1788190200, messageCount: 7, running: false }
  ]
};

const conversations = {
  "launch:launch-command-center": {
    bot: "launch",
    sessionId: "launch-command-center",
    running: false,
    messages: [
      { role: "user", text: "Turn our product notes into a focused launch plan for next week." },
      { role: "assistant", text: "## Launch plan\n\nYour team can move in three clear tracks:\n\n- **Positioning** — lead with one crisp customer promise.\n- **Proof** — pair every claim with a demo, quote, or metric.\n- **Activation** — give each channel one owner and one measurable next step.\n\nThe result is a launch that feels coordinated without adding another layer of meetings." },
      { role: "user", text: "Package this as a brief and keep the team aligned every Monday." },
      { role: "assistant", text: "Done — the shareable brief is ready, and the Monday launch pulse will keep owners, progress, and risks in one place.\n\nMEDIA:/exports/bybots-launch-brief.pdf" }
    ]
  },
  "research:competitive-brief": {
    bot: "research",
    sessionId: "competitive-brief",
    running: false,
    messages: [
      { role: "user", text: "What should we know before this afternoon’s product review?" },
      { role: "assistant", text: "## Three signals that matter\n\n- **Speed wins:** teams value a fast path from question to usable output.\n- **Trust converts:** visible sources and clear uncertainty beat confident guesses.\n- **Continuity matters:** the best assistant remembers the thread, not just the last prompt.\n\nI saved the evidence and open questions in one page for the team.\n\nMEDIA:/exports/product-review-brief.pdf" }
    ]
  },
  "operations:weekly-review": {
    bot: "operations",
    sessionId: "weekly-review",
    running: false,
    messages: [{ role: "assistant", text: "The team’s three priorities are ready." }]
  }
};

const groups = [{
  id: "leadership",
  name: "Product launch",
  members: ["launch", "research", "operations"],
  messages: [
    { id: "group-1", author: "user", authorKind: "user", text: "We launch next week. Build one plan the whole team can act on.", at: 1788449000 },
    { id: "group-2", author: "launch", authorKind: "bot", text: "## One launch, three workstreams\n\n- **Story:** a clear promise for every channel.\n- **Proof:** demos and evidence behind every claim.\n- **Momentum:** one owner and one next step per audience.", at: 1788449400 },
    { id: "group-3", author: "research", authorKind: "bot", text: "@launch, the market signals support this direction. I added the strongest proof points and flagged two assumptions for validation.", at: 1788449800 },
    { id: "group-4", author: "operations", authorKind: "bot", text: "Owners, milestones, and the weekly pulse are aligned. Your launch command center is ready.\n\nMEDIA:/exports/bybots-launch-command-center.pdf", at: 1788450000 }
  ],
  running: false
}];

const routines = [{
  id: "weekly-brief",
  bot: "launch",
  name: "Monday launch pulse",
  prompt: "Summarize progress, owners, and launch risks.",
  schedule: "0 9 * * 1",
  scheduleDisplay: "Every Monday at 9:00 AM",
  enabled: true,
  state: "scheduled",
  nextRunAt: "2026-09-07T09:00:00.000Z",
  lastStatus: "success"
}];

function json(route, body) {
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

function profileFromPath(path) {
  const match = path.match(/^\/api\/bots\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function installApi(page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/events")) return route.abort();
    if (path === "/api/access") return json(route, { role: "admin" });
    if (path === "/api/diagnostics") return json(route, diagnostics);
    if (path === "/api/machines") return json(route, { machines: [{ id: "local", name: "This device", kind: "local", status: "connected" }] });
    if (path === "/api/groups") return json(route, { groups });
    if (path === "/api/bots") return json(route, { bots });

    const profile = profileFromPath(path);
    if (path.match(/^\/api\/bots\/[^/]+\/usage$/)) return json(route, {
      bot: profile,
      periodDays: 30,
      totalTokens: 42860,
      inputTokens: 26740,
      outputTokens: 12920,
      reasoningTokens: 3200,
      cacheReadTokens: 9480,
      actualCostUsd: 0,
      estimatedCostUsd: 0,
      sessions: 12,
      apiCalls: 31,
      byModel: [
        { model: "gpt-5.6-terra", inputTokens: 18400, outputTokens: 9200, estimatedCostUsd: 0 },
        { model: "gpt-5.6-luna", inputTokens: 8340, outputTokens: 3720, estimatedCostUsd: 0 }
      ]
    });
    if (path.match(/^\/api\/bots\/[^/]+\/config$/)) return json(route, {
      bot: profile,
      provider: "openai-codex",
      model: profile === "research" ? "gpt-5.6-luna" : "gpt-5.6-terra",
      soul: "",
      skills: [],
      toolsets: [],
      mcpServers: [],
      providers: [{ slug: "openai-codex", name: "OpenAI Codex", models: ["gpt-5.6-terra", "gpt-5.6-luna"] }]
    });
    if (path.match(/^\/api\/bots\/[^/]+\/threads$/)) return json(route, { threads: threadsByBot[profile] ?? [] });
    const threadMatch = path.match(/^\/api\/bots\/([^/]+)\/threads\/([^/]+)$/);
    if (threadMatch) {
      const key = `${decodeURIComponent(threadMatch[1])}:${decodeURIComponent(threadMatch[2])}`;
      return json(route, conversations[key] ?? { bot: profile, sessionId: threadMatch[2], running: false, messages: [] });
    }
    if (path.match(/^\/api\/bots\/[^/]+\/routines$/)) return json(route, { routines: profile === "launch" ? routines : [] });
    return json(route, {});
  });
}

async function preparePage(browser, baseUrl, viewport, active) {
  const page = await browser.newPage({
    viewport,
    colorScheme: "dark",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "America/New_York"
  });
  await page.addInitScript((selected) => {
    localStorage.setItem("byfinity.language", "en");
    localStorage.setItem("byfinity.lastActive", JSON.stringify(selected));
    if (selected.scope === "bot") localStorage.setItem("byfinity.lastThreads", JSON.stringify({ [selected.id]: selected.threadId }));
    localStorage.setItem("byfinity.preferences", JSON.stringify({ density: "comfortable", sendOnEnter: true, reduceMotion: true, usageDays: 30 }));
  }, active);
  await installApi(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: active.heading }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function captureDesktop(browser, baseUrl) {
  const page = await preparePage(browser, baseUrl, { width: 1440, height: 900 }, { scope: "group", id: "leadership", heading: "Product launch" });
  const details = page.getByRole("button", { name: /Show details/i });
  if (await details.isVisible()) {
    await details.click();
    await page.getByRole("complementary", { name: "Details" }).waitFor();
  }
  await page.screenshot({ path: resolve("docs", "screenshots", "byfinity-bots-desktop.png"), animations: "disabled" });
  await page.close();
}

async function captureBotConversation(browser, baseUrl) {
  const page = await preparePage(browser, baseUrl, { width: 1440, height: 900 }, {
    scope: "bot",
    id: "launch",
    threadId: "launch-command-center",
    heading: "Launch Copilot"
  });
  await page.screenshot({ path: resolve("docs", "screenshots", "byfinity-bots-bot-conversation.png"), animations: "disabled" });
  await page.close();
}

async function captureMobile(browser, baseUrl) {
  const page = await preparePage(browser, baseUrl, { width: 430, height: 932 }, { scope: "bot", id: "research", threadId: "competitive-brief", heading: "Research Scout" });
  await page.screenshot({ path: resolve("docs", "screenshots", "byfinity-bots-mobile.png"), animations: "disabled" });
  await page.close();
}

const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false } });
await server.listen();
const address = server.httpServer?.address();
if (!address || typeof address === "string") throw new Error("Unable to resolve the screenshot server address");
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch();

try {
  await mkdir(resolve("docs", "screenshots"), { recursive: true });
  await captureBotConversation(browser, baseUrl);
  await captureDesktop(browser, baseUrl);
  await captureMobile(browser, baseUrl);
  console.log("Public screenshots generated in docs/screenshots");
} finally {
  await browser.close();
  await server.close();
}
