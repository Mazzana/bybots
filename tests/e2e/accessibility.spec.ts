import { expect, test, type Route } from "@playwright/test";

function json(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("mobile settings preserve focus, touch targets, reduced motion, and horizontal containment", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/access") return json(route, { role: "admin" });
    if (path === "/api/bots") return json(route, { bots: [{ name: "research", title: "Research", description: "Evidence-backed research", system: false }] });
    if (path === "/api/groups") return json(route, { groups: [] });
    if (path === "/api/machines") return json(route, { machines: [] });
    if (path === "/api/diagnostics") return json(route, {
      checkedAt: "2026-09-03T00:00:00.000Z", supportedHermes: "0.21.x",
      bridge: { status: "ready", version: "0.1.0" },
      hermes: { status: "ready", baseUrl: "http://127.0.0.1:9120", version: "0.21.4", compatible: true },
      authentication: { status: "ready" }
    });
    return json(route, {});
  });

  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Conversation threads" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Bot Research" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const settingsButton = page.getByRole("button", { name: "Settings" });
  await settingsButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Close settings" })).toBeFocused();

  const targetSizes = await dialog.locator("button:visible, select:visible").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { name: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName, width: rect.width, height: rect.height };
  }));
  expect(targetSizes.filter((target) => target.width < 44 || target.height < 44)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Accessibility" }).click();
  await page.getByRole("switch", { name: "Reduce motion" }).check();
  await expect(page.locator("html")).toHaveClass(/reduce-motion/);
  const durationMs = await page.getByRole("button", { name: "Accessibility" }).evaluate((element) => {
    const duration = getComputedStyle(element).transitionDuration;
    return Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1_000);
  });
  expect(durationMs).toBeLessThanOrEqual(0.01);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(settingsButton).toBeFocused();
});

test("keyboard switches thread tabs, targets a group Bot, and closes creation dialogs", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/events")) return route.abort();
    if (path === "/api/access") return json(route, { role: "admin" });
    if (path === "/api/bots") return json(route, { bots: [
      { name: "research", title: "Research", system: false },
      { name: "ops", title: "Operations", system: false }
    ] });
    if (path === "/api/groups") return json(route, { groups: [{ id: "room-1", name: "Review", members: ["research", "ops"], messages: [], running: false }] });
    if (path === "/api/machines") return json(route, { machines: [] });
    if (path === "/api/diagnostics") return json(route, {
      checkedAt: "2026-09-03T00:00:00.000Z", supportedHermes: "0.21.x",
      bridge: { status: "ready", version: "0.1.0" },
      hermes: { status: "ready", baseUrl: "http://127.0.0.1:9120", version: "0.21.4", compatible: true },
      authentication: { status: "ready" }
    });
    if (path === "/api/bots/research/usage") return json(route, { bot: "research", periodDays: 30, totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, actualCostUsd: 0, estimatedCostUsd: 0, sessions: 2, apiCalls: 0, byModel: [] });
    if (path === "/api/bots/research/threads") return json(route, { threads: [
      { id: "budget", bot: "research", title: "Budget", preview: "Budget", startedAt: 2, messageCount: 1, running: false },
      { id: "forecast", bot: "research", title: "Forecast", preview: "Forecast", startedAt: 1, messageCount: 1, running: false }
    ] });
    if (path === "/api/bots/research/threads/budget") return json(route, { bot: "research", sessionId: "budget", running: false, messages: [{ role: "assistant", text: "Budget answer" }] });
    if (path === "/api/bots/research/threads/forecast") return json(route, { bot: "research", sessionId: "forecast", running: false, messages: [{ role: "assistant", text: "Forecast answer" }] });
    return json(route, {});
  });

  await page.goto("/");
  const mobileBackButton = page.getByRole("button", { name: "Back to conversations" });
  await expect(mobileBackButton).toBeVisible();
  await mobileBackButton.click();
  await expect(page.getByRole("complementary", { name: "Conversation threads" })).toBeVisible();
  await page.getByRole("button", { name: "Open Bot Research" }).click();
  await expect(page.getByRole("complementary", { name: "Conversation threads" })).toBeHidden();
  await expect(mobileBackButton).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveCSS("font-size", "16px");
  const budgetTab = page.getByRole("tab", { name: "Budget" });
  const forecastTab = page.getByRole("tab", { name: "Forecast" });
  await expect(budgetTab).toHaveAttribute("aria-selected", "true");
  await budgetTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(forecastTab).toBeFocused();
  await expect(forecastTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Forecast" }).getByText("Forecast answer")).toBeVisible();

  await mobileBackButton.click();
  await expect(page.getByRole("complementary", { name: "Conversation threads" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search conversations" })).toBeFocused();
  await page.getByRole("button", { name: "Open group Review" }).click();
  const groupComposer = page.getByRole("textbox", { name: "Message the group" });
  await groupComposer.fill("@");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: /@ops/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(groupComposer).toHaveValue("@ops ");

  await page.getByRole("button", { name: "Back to conversations" }).click();
  const newBotButton = page.getByRole("button", { name: "New Bot" });
  await newBotButton.click();
  const dialog = page.getByRole("dialog", { name: "Create a Bot" });
  await expect(dialog).toBeVisible();
  const nameInput = page.getByRole("textbox", { name: "Technical name", exact: true });
  await expect(nameInput).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(nameInput).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(newBotButton).toBeFocused();
});
