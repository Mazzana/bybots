// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App, type AppDiagnostics } from "../src/App";
import { FirstRunPanel } from "../src/FirstRunPanel";
import { isLocalHermesUrl } from "../src/hermesConnectionUi";
import { LanguageProvider } from "../src/i18n";

afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });
const local = { baseUrl: "http://127.0.0.1:9120", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, secure: true, source: "environment" as const };
const ready: AppDiagnostics = {
  checkedAt: "2026-09-04", supportedHermes: "0.21.x",
  bridge: { status: "ready" }, hermes: { status: "ready", baseUrl: local.baseUrl, compatible: true },
  authentication: { status: "ready" }
};
function fixture() {
  return {
    listBots: vi.fn().mockResolvedValue([]), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
    getHermesConnection: vi.fn().mockResolvedValue(local), getDiagnostics: vi.fn().mockResolvedValue(ready),
    testHermesConnection: vi.fn(), updateHermesConnection: vi.fn(), resetHermesConnection: vi.fn().mockResolvedValue(local)
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}

it("cancels an in-flight local recovery when a user chooses remote sign-in", async () => {
  vi.useFakeTimers();
  const api = fixture();
  const pending = deferred<AppDiagnostics>();
  api.getDiagnostics.mockReturnValue(pending.promise);
  const connected = vi.fn();
  render(<LanguageProvider initialLanguage="en"><FirstRunPanel api={api} role="admin" localHermesUnavailable onConnected={connected} /></LanguageProvider>);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
  expect(api.getDiagnostics).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: /Remote Hermes/ }));
  fireEvent.change(screen.getByLabelText("Gateway URL"), { target: { value: "https://remote.example.test" } });
  await act(async () => { pending.resolve(ready); });
  await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
  expect(connected).not.toHaveBeenCalled();
  expect(api.getDiagnostics).toHaveBeenCalledOnce();
  expect(screen.queryByText("Waiting for local Hermes…")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Gateway URL")).toHaveValue("https://remote.example.test");
});

it("keeps recovery actionable when workspace loading fails, then retries successfully", async () => {
  vi.useFakeTimers();
  const api = fixture();
  const connected = vi.fn().mockRejectedValueOnce(new Error("Loading failed")).mockResolvedValue(undefined);
  render(<LanguageProvider initialLanguage="en"><FirstRunPanel api={api} role="admin" localHermesUnavailable onConnected={connected} /></LanguageProvider>);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
  expect(screen.getByText("The connection could not be completed. Retry or open the setup guide below.")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
  expect(connected).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
  expect(connected).toHaveBeenCalledTimes(2);
});

it.each(["authentication", "compatibility"])("does not complete onboarding when %s validation fails", async (reason) => {
  const api = fixture();
  const unavailable: AppDiagnostics = { ...ready, hermes: { status: "error", baseUrl: local.baseUrl } };
  const invalid: AppDiagnostics = reason === "authentication"
    ? { ...ready, authentication: { status: "error" } }
    : { ...ready, hermes: { ...ready.hermes, compatible: false } };
  api.getDiagnostics.mockResolvedValueOnce(unavailable).mockResolvedValue(invalid);
  render(<LanguageProvider initialLanguage="en"><App api={api} /></LanguageProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Retry local connection" }));
  await waitFor(() => expect(within(screen.getByRole("dialog")).getByText("The connection could not be completed. Retry or open the setup guide below.")).toBeInTheDocument());
  expect(screen.getByRole("dialog", { name: "Connect your Hermes gateway" })).toBeInTheDocument();
  expect(localStorage.getItem("bybots.onboardingCompleted")).toBeNull();
  expect(screen.queryByText("Default Hermes gateway restored.")).not.toBeInTheDocument();
});

it("contains keyboard focus inside the first-run dialogue and links to installation help", async () => {
  render(<LanguageProvider initialLanguage="en"><FirstRunPanel api={fixture()} role="admin" onConnected={vi.fn()} /></LanguageProvider>);
  const language = screen.getByRole("combobox", { name: "Language" });
  const help = screen.getByRole("link", { name: "Set up Hermes step by step" });
  expect(language).toHaveFocus();
  fireEvent.keyDown(language, { key: "Tab", shiftKey: true });
  expect(help).toHaveFocus();
  fireEvent.keyDown(help, { key: "Tab" });
  expect(language).toHaveFocus();
  expect(help).toHaveAttribute("href", expect.stringContaining("INSTALLATION.md#prepare-hermes"));
  await act(async () => {});
});

it("recognizes IPv6 loopback but never mistakes lookalike remote hosts for local Hermes", () => {
  expect(isLocalHermesUrl("http://[::1]:9120")).toBe(true);
  expect(isLocalHermesUrl("http://127.0.0.2:9120")).toBe(true);
  expect(isLocalHermesUrl("http://127.attacker.example")).toBe(false);
});
