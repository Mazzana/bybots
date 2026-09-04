// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GatewaysPanel } from "../src/GatewaysPanel";
import type { BotsApi } from "../src/App";
import { LanguageProvider } from "../src/i18n";

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
