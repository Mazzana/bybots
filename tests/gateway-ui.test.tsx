// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { HermesConnection } from "../src/App";
import { HermesConnectionPanel } from "../src/HermesConnectionPanel";
import { LanguageProvider } from "../src/i18n";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete document.documentElement.dataset.desktop;
  window.history.replaceState(null, "", "/");
  localStorage.clear();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const remote: HermesConnection = {
  baseUrl: "https://hermes.example.test", defaultBaseUrl: "http://127.0.0.1:9120",
  hasToken: true, authMode: "oauth", secure: true, source: "saved", version: "0.21.4"
};

async function setup(authMode: "oauth" | "token" = "oauth") {
  vi.useFakeTimers();
  document.documentElement.dataset.desktop = "windows";
  const api = {
    listBots: vi.fn(), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
    getHermesConnection: vi.fn().mockResolvedValue({ ...remote, hasToken: false, requiresReauthentication: true }),
    testHermesConnection: vi.fn(), updateHermesConnection: vi.fn(), resetHermesConnection: vi.fn(),
    probeHermesAuth: vi.fn().mockResolvedValue({ baseUrl: remote.baseUrl, reachable: true, authMode, nativePkce: true, providers: [] }),
    startHermesOAuth: vi.fn().mockResolvedValue({ authorizationUrl: "#authorized" })
  };
  const connected = vi.fn();
  const view = render(<LanguageProvider initialLanguage="en"><HermesConnectionPanel api={api} role="admin" onConnected={connected} /></LanguageProvider>);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  return { api, connected, ...view };
}

it.each(["cancel", "unmount"])("ignores a pending OAuth start after %s", async (action) => {
  const { api, connected, unmount } = await setup();
  const pending = deferred<{ authorizationUrl: string }>();
  api.startHermesOAuth.mockReturnValue(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Sign in to Hermes" }));
  if (action === "cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  else unmount();
  await act(async () => { pending.resolve({ authorizationUrl: "#authorized" }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(window.location.hash).toBe("");
  expect(api.getHermesConnection).toHaveBeenCalledTimes(1);
  expect(connected).not.toHaveBeenCalled();
});

it.each(["cancel", "unmount"])("ignores a pending OAuth completion poll after %s", async (action) => {
  const { api, connected, unmount } = await setup();
  const pending = deferred<HermesConnection>();
  api.getHermesConnection.mockReturnValue(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Sign in to Hermes" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(api.getHermesConnection).toHaveBeenCalledTimes(2);
  if (action === "cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  else unmount();
  await act(async () => { pending.resolve(remote); });
  expect(connected).not.toHaveBeenCalled();
});

it("does not let a canceled OAuth start failure clear a newer sign-in", async () => {
  const { api } = await setup();
  const first = deferred<{ authorizationUrl: string }>();
  const second = deferred<{ authorizationUrl: string }>();
  api.startHermesOAuth.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  fireEvent.click(screen.getByRole("button", { name: "Sign in to Hermes" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Sign in to Hermes" }));
  await act(async () => { first.reject(new Error("Old OAuth failure")); });
  expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  expect(screen.queryByText("Old OAuth failure")).not.toBeInTheDocument();
});

it.each(["save", "reset"])("refreshes the application after a committed gateway %s even when settings have closed", async (action) => {
  const { api, connected, unmount } = await setup("token");
  const pending = deferred<HermesConnection>();
  if (action === "save") {
    api.updateHermesConnection.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "Save and connect" }));
  } else {
    api.resetHermesConnection.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: /Local Hermes/ }));
  }
  unmount();
  await act(async () => { pending.resolve(remote); });
  expect(connected).toHaveBeenCalledOnce();
});
