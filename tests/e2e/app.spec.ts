import { expect, test, type Route } from "@playwright/test";

const readyDiagnostics = {
  checkedAt: "2026-09-03T00:00:00.000Z",
  supportedHermes: "0.21.x",
  bridge: { status: "ready", version: "0.1.0" },
  hermes: { status: "ready", baseUrl: "http://127.0.0.1:9120", version: "0.21.4", compatible: true },
  authentication: { status: "ready" }
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("first launch connects a local or remote Hermes gateway", async ({ page }) => {
  let connected = false;
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/access") return json(route, { role: "admin" });
    if (path === "/api/bots") return json(route, { bots: [] });
    if (path === "/api/groups") return json(route, { groups: [] });
    if (path === "/api/machines") return json(route, { machines: [] });
    if (path === "/api/diagnostics") return json(route, connected ? readyDiagnostics : {
      ...readyDiagnostics,
      hermes: { status: "warning", baseUrl: "http://127.0.0.1:9120" },
      authentication: { status: "error", detail: "Hermes session token is required" }
    });
    if (path === "/api/hermes/connection/auth") return json(route, { auth: { baseUrl: "https://hermes.example.test", reachable: true, authMode: "token", nativePkce: false, providers: [], version: "0.21.4" } });
    if (path === "/api/hermes/connection" && request.method() === "GET") return json(route, { connection: { baseUrl: "http://127.0.0.1:9120", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: connected, secure: true, source: connected ? "saved" : "environment" } });
    if (path === "/api/hermes/connection" && request.method() === "PUT") {
      connected = true;
      return json(route, { connection: { baseUrl: "https://hermes.example.test", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, secure: true, source: "saved", version: "0.21.4" } });
    }
    return json(route, {});
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connect your Hermes gateway" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Local Hermes/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Remote Hermes/ }).click();
  await expect(page.getByRole("button", { name: /Remote Hermes/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Gateway URL").fill("https://hermes.example.test");
  await page.getByLabel("Hermes session token").fill("private-session-value");
  await page.getByRole("button", { name: "Save and connect" }).click();
  await expect(page.getByRole("heading", { name: "Connect your Hermes gateway" })).toBeHidden();
});

test("core Bot journey restores a thread, changes model, retries chat, and transfers a profile", async ({ page }) => {
  const bots: Array<Record<string, unknown>> = [{ name: "research", title: "Research", description: "Evidence-backed research", system: false }];
  let messageAttempts = 0;
  let messageCompleted = false;
  let imported = false;

  await page.addInitScript(() => localStorage.setItem("byfinity.lastThreads", JSON.stringify({ research: "thread-last" })));
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/events")) return route.abort();
    if (path === "/api/access") return json(route, { role: "admin" });
    if (path === "/api/diagnostics") return json(route, readyDiagnostics);
    if (path === "/api/hermes/connection/gateways") return json(route, { gateways: [
      { id: "primary", label: "Home", hasToken: true, isDefault: true },
      { id: "gw-123456789abc", label: "Work", hasToken: true, isDefault: false }
    ], activity: [] });
    if (path === "/api/gateways/status") return json(route, { gateways: [{ id: "primary", label: "Home", status: "connected", isDefault: true }, { id: "gw-123456789abc", label: "Work", status: "connected", isDefault: false }] });
    if (path === "/api/machines") return json(route, { machines: [{ id: "local", name: "This device", kind: "local", status: "connected" }] });
    if (path === "/api/groups") return json(route, { groups: [] });
    if (path === "/api/bots" && request.method() === "GET") return json(route, { bots });
    if (path === "/api/bots" && request.method() === "POST") {
      const input = request.postDataJSON();
      const bot = { name: input.name, title: input.title, description: input.description, avatar: input.avatar, system: false };
      bots.push(bot);
      return json(route, { bot }, 201);
    }
    if (path === "/api/avatar-pets") return json(route, { pets: [] });
    if (path === "/api/bots/research/usage") return json(route, { bot: "research", periodDays: 30, totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, actualCostUsd: 0, estimatedCostUsd: 0, sessions: 1, apiCalls: 1, byModel: [] });
    if (path === "/api/bots/research/config" && request.method() === "GET") return json(route, {
      bot: "research", provider: "openai-codex", model: "gpt-5.6-terra", soul: "",
      skills: [], toolsets: [], mcpServers: [],
      providers: [{ slug: "openai-codex", name: "OpenAI Codex", models: ["gpt-5.6-terra", "gpt-5.6-sol"] }]
    });
    if (path === "/api/bots/research" && request.method() === "PATCH") return json(route, { applied: { model: true }, confirmRequired: false });
    if (path === "/api/bots/research/threads") return json(route, { threads: [
      { id: "thread-new", bot: "research", title: "Newer thread", preview: "New", startedAt: 2, messageCount: 0, running: false },
      { id: "thread-last", bot: "research", title: "Restored thread", preview: "Welcome back", startedAt: 1, messageCount: 1, running: false }
    ] });
    if (path === "/api/bots/research/threads/thread-last" && request.method() === "GET") return json(route, messageCompleted ? {
      bot: "research", sessionId: "thread-last", running: false,
      messages: [{ role: "user", text: "Summarize the evidence" }, { role: "assistant", text: "The evidence is ready." }]
    } : { bot: "research", sessionId: "thread-last", running: false, messages: [{ role: "assistant", text: "Welcome back" }] });
    if (path === "/api/bots/research/threads/thread-last/messages") {
      messageAttempts += 1;
      if (messageAttempts === 1) return json(route, { error: { reason: "provider_rate_limit", title: "Provider rate limit", detail: "Please retry", hint: "Wait briefly, then try again.", retryable: true, action: "retry" } }, 429);
      messageCompleted = true;
      return json(route, { bot: "research", sessionId: "thread-last", running: true, messages: [{ role: "user", text: "Summarize the evidence" }] }, 202);
    }
    if (path === "/api/bots/research/export") return route.fulfill({ status: 200, headers: { "content-type": "application/gzip", "content-disposition": "attachment; filename=\"research.tar.gz\"" }, body: Buffer.from([0x1f, 0x8b, 0x08]) });
    if (path === "/api/bots/import") {
      expect(new URL(request.url()).searchParams.get("gatewayId")).toBe("gw-123456789abc");
      imported = true;
      return json(route, { bot: { name: "research-copy", title: "Research Copy", system: false } }, 201);
    }
    return json(route, {});
  });

  await page.goto("/");

  await page.getByRole("button", { name: "New Bot" }).click();
  await page.getByLabel("Visible name", { exact: true }).fill("Data Analyst");
  await page.getByLabel("Mission", { exact: true }).fill("Analyze data and return actionable findings.");
  await page.getByLabel("Technical name", { exact: true }).fill("analyst");
  await page.getByRole("button", { name: "Create Bot" }).click();
  await expect(page.getByText("Data Analyst")).toBeVisible();

  await page.getByRole("button", { name: /Research/ }).first().click();
  await expect(page.getByRole("tab", { name: "Restored thread" })).toHaveAttribute("aria-selected", "true");
  const restoredConversation = page.getByRole("tabpanel", { name: "Restored thread" });
  await expect(restoredConversation.getByText("Welcome back")).toBeVisible();

  await page.getByRole("combobox", { name: "Bot model for Research" }).selectOption({ label: "gpt-5.6-sol" });
  await expect(page.getByText("Model saved.")).toBeVisible();

  await page.getByLabel("Message", { exact: true }).fill("Summarize the evidence");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Wait briefly, then try again.");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(restoredConversation.getByText("The evidence is ready.")).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Data", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download archive" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("research.tar.gz");
  await page.getByLabel("Hermes archive").setInputFiles({ name: "research.tar.gz", mimeType: "application/gzip", buffer: Buffer.from([0x1f, 0x8b, 0x08]) });
  await page.getByLabel("New technical name").fill("research-copy");
  await expect(page.getByRole("combobox", { name: "Destination gateway" })).toHaveValue("primary");
  await page.getByRole("combobox", { name: "Destination gateway" }).selectOption("gw-123456789abc");
  await page.getByRole("button", { name: "Import Bot" }).click();
  await expect(page.getByText("Research Copy was imported.")).toBeVisible();
  expect(imported).toBe(true);
});
