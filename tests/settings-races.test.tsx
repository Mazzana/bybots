// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsPanel } from "../src/SettingsPanel";
import { LanguageProvider } from "../src/i18n";
import { DEFAULT_PREFERENCES } from "../src/preferences";

afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const api = {
    listBots: vi.fn(), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
    getBotConfiguration: vi.fn(async (bot: string) => ({ bot, provider: "", model: "", soul: "", skills: [], toolsets: [], providers: [], mcpServers: [{ name: `${bot}-files`, enabled: false, installed: true }] })),
    testMcpServer: vi.fn().mockResolvedValue({ server: "alpha-files", toolCount: 1, tools: ["read"] }),
    updateBot: vi.fn().mockResolvedValue({ applied: { mcp_servers: true }, confirmRequired: false })
  };
  const view = render(<LanguageProvider initialLanguage="en"><SettingsPanel api={api} bots={[{ name: "alpha", system: false }, { name: "beta", system: false }]} machines={[]} role="admin" initialSection="mcp" preferences={DEFAULT_PREFERENCES} onPreferencesChange={vi.fn()} onBotImported={vi.fn()} onGatewayChanged={vi.fn()} onClose={vi.fn()} /></LanguageProvider>);
  return { api, ...view };
}

it("does not replace the selected Bot's MCP settings with a late save from another Bot", async () => {
  const { api } = setup();
  const save = deferred<{ applied: { mcp_servers: boolean }; confirmRequired: boolean }>();
  api.updateBot.mockReturnValue(save.promise);
  fireEvent.click(await screen.findByRole("switch", { name: "Enable alpha-files" }));
  await waitFor(() => expect(api.updateBot).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText("Configure integrations for"), { target: { value: "beta" } });
  await screen.findByRole("switch", { name: "Enable beta-files" });
  await act(async () => { save.resolve({ applied: { mcp_servers: true }, confirmRequired: false }); });
  expect(screen.getByRole("switch", { name: "Enable beta-files" })).not.toBeChecked();
  expect(screen.queryByRole("switch", { name: "Enable alpha-files" })).not.toBeInTheDocument();
});

it.each(["switch", "close"])("does not start a save after leaving an MCP connection test (%s)", async (action) => {
  const { api, unmount } = setup();
  const test = deferred<{ server: string; toolCount: number; tools: string[] }>();
  api.testMcpServer.mockReturnValue(test.promise);
  fireEvent.click(await screen.findByRole("switch", { name: "Enable alpha-files" }));
  if (action === "close") unmount();
  else {
    fireEvent.change(screen.getByLabelText("Configure integrations for"), { target: { value: "beta" } });
    await screen.findByRole("switch", { name: "Enable beta-files" });
  }
  await act(async () => { test.resolve({ server: "alpha-files", toolCount: 1, tools: ["read"] }); });
  expect(api.updateBot).not.toHaveBeenCalled();
});
