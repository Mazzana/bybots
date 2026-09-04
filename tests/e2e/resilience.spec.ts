import { expect, test, type Route } from "@playwright/test";

function json(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

test("a long Bot title and 500-message thread stay contained and open at the latest message", async ({ page }) => {
  const title = "A deliberately very long research Bot title that must stay inside its own column";
  const messages = Array.from({ length: 500 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    text: index === 499 ? "Latest message in the long history" : `Archived message ${index + 1}`
  }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/events")) return route.abort();
    if (path === "/api/access") return json(route, { role: "admin" });
    if (path === "/api/diagnostics") return json(route, { checkedAt: "2026-09-03T00:00:00.000Z", supportedHermes: "0.21.x", bridge: { status: "ready", version: "0.1.0" }, hermes: { status: "ready", baseUrl: "http://127.0.0.1:9120", version: "0.21.4", compatible: true }, authentication: { status: "ready" } });
    if (path === "/api/machines") return json(route, { machines: [] });
    if (path === "/api/groups") return json(route, { groups: [] });
    if (path === "/api/bots") return json(route, { bots: [{ name: "long-history", title, description: "Large archived conversation", system: false }] });
    if (path === "/api/bots/long-history/usage") return json(route, { bot: "long-history", periodDays: 30, totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, actualCostUsd: 0, estimatedCostUsd: 0, sessions: 1, apiCalls: 1, byModel: [] });
    if (path === "/api/bots/long-history/config") return json(route, { bot: "long-history", provider: "", model: "", soul: "", skills: [], toolsets: [], mcpServers: [], providers: [] });
    if (path === "/api/bots/long-history/threads") return json(route, { threads: [{ id: "history", bot: "long-history", title: "Long history", preview: "Latest message", startedAt: 1, messageCount: 500, running: false }] });
    if (path === "/api/bots/long-history/threads/history") return json(route, { bot: "long-history", sessionId: "history", running: false, messages });
    return json(route, {});
  });

  await page.goto("/");
  const botButton = page.getByRole("button", { name: `Open Bot ${title}`, exact: true });
  await expect(botButton).toBeVisible();
  const startedAt = Date.now();
  await botButton.click();
  await expect(page.getByRole("tabpanel").getByText("Latest message in the long history")).toBeVisible();
  expect(Date.now() - startedAt).toBeLessThan(3_000);
  const distanceFromBottom = await page.locator(".messages").evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);
  expect(distanceFromBottom).toBeLessThan(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
