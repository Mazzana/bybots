// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App, type Bot } from "../src/App";
import { LanguageProvider } from "../src/i18n";

afterEach(() => { cleanup(); localStorage.clear(); });
function fixture(bots: Bot[]) {
  return { listBots: vi.fn().mockResolvedValue(bots), getUsage: vi.fn().mockResolvedValue({}), createBot: vi.fn(), deleteBot: vi.fn(), sendMessage: vi.fn(), getConversation: vi.fn().mockImplementation(async (bot) => ({ bot, sessionId: bot, messages: [] })) };
}
it("groups interleaved Bots by gateway identity, puts the default first and keeps selection scoped", async () => {
  const api = fixture([
    { name: "writer", displayName: "Writer", system: false, gatewayId: "primary", gatewayLabel: "Home" },
    { name: "gw-123456789abc::writer", displayName: "Writer", system: false, gatewayId: "gw-123456789abc", gatewayLabel: "Work", gatewayDefault: true },
    { name: "reviewer", system: false, gatewayId: "primary", gatewayLabel: "Home" }
  ]);
  render(<LanguageProvider initialLanguage="en"><App api={api} /></LanguageProvider>);
  const nav = await screen.findByRole("navigation", { name: "Hermes Bots" });
  await within(nav).findByRole("heading", { name: "Work" });
  expect(within(nav).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Work", "Home"]);
  expect(within(within(nav).getByRole("region", { name: "Home" })).getAllByRole("button")).toHaveLength(2);
  fireEvent.click(within(nav).getByRole("button", { name: "Open Bot Writer · Work" }));
  await waitFor(() => expect(api.getConversation).toHaveBeenCalledWith("gw-123456789abc::writer"));
  expect(within(nav).getByRole("button", { name: "Open Bot Writer · Work" })).toHaveAttribute("aria-current", "page");
  fireEvent.change(screen.getByRole("textbox", { name: "Search conversations" }), { target: { value: "Work" } });
  expect(within(nav).getAllByRole("heading")).toHaveLength(1);
  expect(within(nav).getAllByRole("button")).toHaveLength(1);
});
it("keeps identical gateway labels separate and supports legacy Bots without metadata", async () => {
  const api = fixture([
    { name: "old", system: false },
    { name: "gw-111111111111::writer", system: false, gatewayId: "gw-111111111111", gatewayLabel: "Work" },
    { name: "gw-222222222222::writer", system: false, gatewayId: "gw-222222222222", gatewayLabel: "Work" }
  ]);
  render(<LanguageProvider initialLanguage="en"><App api={api} /></LanguageProvider>);
  const nav = screen.getByRole("navigation", { name: "Hermes Bots" });
  await within(nav).findByRole("heading", { name: "Hermes" });
  expect(within(nav).getAllByRole("region", { name: "Work" })).toHaveLength(2);
  expect(within(nav).getByRole("button", { name: "Open Bot old" })).toBeEnabled();
});
it("preselects the saved main gateway when creating a Bot", async () => {
  const api = { ...fixture([]), listGateways: vi.fn().mockResolvedValue({ gateways: [
    { id: "primary", label: "Home", hasToken: true, isDefault: false },
    { id: "gw-123456789abc", label: "Work", hasToken: true, isDefault: true }
  ], activity: [] }) };
  render(<LanguageProvider initialLanguage="en"><App api={api} /></LanguageProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "New Bot" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Gateway" })).toHaveValue("gw-123456789abc"));
});
