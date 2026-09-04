// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GatewayStatuses } from "../src/GatewayStatuses";
import { LanguageProvider } from "../src/i18n";
import type { BotsApi } from "../src/App";

afterEach(cleanup);
it.each([1, 2])("renders exactly %i configured gateway indicators without phantom local entries", async (count) => {
  const getGatewayStatuses = vi.fn().mockResolvedValue({ gateways: Array.from({ length: count }, (_, i) => ({ id: String(i), label: `Gateway ${i}`, status: i ? "unavailable" : "connected", isDefault: i === 0 })) });
  const open = vi.fn();
  render(<LanguageProvider initialLanguage="en"><GatewayStatuses api={{ getGatewayStatuses, listBots: vi.fn(), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn() }} onOpen={open} /></LanguageProvider>);
  expect(await screen.findAllByRole("button")).toHaveLength(count);
  expect(screen.getByText("Connected")).toBeInTheDocument();
  if (count > 1) expect(screen.getByText("Unavailable")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button")[0]);
  expect(open).toHaveBeenCalledOnce();
});
it("does not claim a connection is healthy when status loading fails", async () => {
  render(<LanguageProvider initialLanguage="en"><GatewayStatuses api={{ getGatewayStatuses: vi.fn().mockRejectedValue(new Error("offline")), listBots: vi.fn(), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn() }} /></LanguageProvider>);
  expect(await screen.findByText("Status unavailable")).toBeInTheDocument();
  expect(screen.queryByText("Connected")).not.toBeInTheDocument();
});
