// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GatewaysPanel } from "../src/GatewaysPanel";
import type { BotsApi } from "../src/App";
import { LanguageProvider } from "../src/i18n";
import { SettingsPanel } from "../src/SettingsPanel";
import { DEFAULT_PREFERENCES } from "../src/preferences";

afterEach(cleanup);
function fixture() {
  return {
    listBots: vi.fn(), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getConversation: vi.fn(), sendMessage: vi.fn(),
    listGateways: vi.fn().mockResolvedValue({ gateways: [
      { id: "primary", label: "Primary", baseUrl: "http://127.0.0.1:9120", hasToken: true, relay: false, relayStatus: "disabled" },
      { id: "gw-123456789abc", label: "Work", baseUrl: "https://work.example.test", hasToken: true, relay: false, relayStatus: "disabled" }
    ], activity: [] }), addGateway: vi.fn().mockResolvedValue({ id: "gw-123456789abc" }), setGatewayRelay: vi.fn(), removeGateway: vi.fn()
  } satisfies BotsApi;
}
it("requires explicit relay consent and confirmation before removing only a connection", async () => {
  const api = fixture(); const changed = vi.fn();
  render(<LanguageProvider initialLanguage="en"><GatewaysPanel api={api} role="admin" onChanged={changed} /></LanguageProvider>);
  const switches = await screen.findAllByRole("switch", { name: /Allow Bot relay/ });
  expect(switches).toHaveLength(2); expect(switches[1]).not.toBeChecked();
  fireEvent.click(switches[1]);
  await waitFor(() => expect(api.setGatewayRelay).toHaveBeenCalledWith("gw-123456789abc", true));
  fireEvent.click(screen.getByRole("button", { name: "Remove gateway" }));
  expect(api.removeGateway).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await waitFor(() => expect(api.removeGateway).toHaveBeenCalledWith("gw-123456789abc"));
  expect(changed).toHaveBeenCalledOnce();
});
it("does not load gateway metadata for an operator", () => {
  const api = fixture();
  render(<LanguageProvider initialLanguage="en"><GatewaysPanel api={api} role="operator" onChanged={() => {}} /></LanguageProvider>);
  expect(api.listGateways).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "Multiple gateways" })).not.toBeInTheDocument();
});

it("shows only additive gateway management in Settings, not the legacy local/remote replacement picker", async () => {
  const api = fixture();
  render(<LanguageProvider initialLanguage="en"><SettingsPanel api={api} bots={[]} machines={[]} role="admin" initialSection="hermes" preferences={DEFAULT_PREFERENCES} onPreferencesChange={() => {}} onBotImported={() => {}} onGatewayChanged={() => {}} onClose={() => {}} /></LanguageProvider>);
  expect(await screen.findByRole("heading", { name: "Multiple gateways" })).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Connection choices" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add and configure" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Configure connection" })).toHaveLength(2));
});

it("reconnects local Hermes as an additional session without replacing the remote OAuth gateway or granting relay", async () => {
  const api = fixture();
  const remote = { id: "primary", label: "Remote", baseUrl: "https://work.example.test", defaultBaseUrl: "http://127.0.0.1:9120", authMode: "oauth", hasToken: true, relay: true, relayStatus: "ready" };
  api.listGateways.mockResolvedValue({ gateways: [remote], activity: [] });
  const localUpdate = vi.fn().mockResolvedValue({ hasToken: true });
  const forGateway = vi.fn().mockReturnValue({ updateHermesConnection: localUpdate });
  const reset = vi.fn(), replace = vi.fn(), changed = vi.fn();
  render(<LanguageProvider initialLanguage="en"><GatewaysPanel api={{ ...api, forGateway, resetHermesConnection: reset, updateHermesConnection: replace }} role="admin" onChanged={changed} /></LanguageProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Connect local Hermes too" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(api.addGateway).toHaveBeenCalledWith({ label: "Local Hermes", baseUrl: "http://127.0.0.1:9120" });
  expect(forGateway).toHaveBeenCalledWith("gw-123456789abc");
  expect(localUpdate).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:9120" });
  expect(reset).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  expect(api.setGatewayRelay).not.toHaveBeenCalled();
});
