// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App, type BotsApi, type BotThreadStreamEvent, type AgentDispatch } from "../src/App";
import { LanguageProvider } from "../src/i18n";

afterEach(() => { cleanup(); localStorage.clear(); });
it("shows live dispatch acknowledgements without claiming delivery and rejects stale or foreign streams", async () => {
  const listeners = new Map<string, (event: BotThreadStreamEvent) => void>();
  const snapshot = (bot: string, dispatches: AgentDispatch[] = []) => ({ bot, sessionId: "thread", running: false, messages: [{ role: "assistant" as const, text: `${bot} reply` }], dispatches });
  const api: BotsApi = {
    listBots: vi.fn().mockResolvedValue([{ name: "alpha", system: false }, { name: "beta", system: false }]),
    getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
    listThreads: vi.fn(async (bot) => [{ id: "thread", bot, title: "Bot Chat", preview: "", startedAt: 1, messageCount: 1, running: false }]),
    createThread: vi.fn(), sendThreadMessage: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), getThread: vi.fn(async (bot) => snapshot(bot)),
    watchThread: (bot, _id, listener, status) => { listeners.set(bot, listener); status("connected"); return () => {}; }
  };
  render(<LanguageProvider initialLanguage="en"><App api={api} /></LanguageProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Open Bot alpha" }));
  await screen.findByText("alpha reply", { selector: "p" });
  const dispatch: AgentDispatch = { id: "call", target: "research@remote", status: "started" };
  act(() => listeners.get("alpha")!({ type: "conversation", conversation: snapshot("alpha", [dispatch]) }));
  const panel = await screen.findByRole("region", { name: "Outgoing Bot messages (live)" });
  expect(panel).toHaveTextContent("research@remote · Request started");
  act(() => listeners.get("alpha")!({ type: "conversation", conversation: snapshot("alpha", [{ ...dispatch, status: "dispatched" }]) }));
  expect(panel).toHaveTextContent("Dispatched");
  expect(panel).toHaveTextContent("Dispatch is not confirmation of receipt.");
  expect(within(panel).queryByText("Delivered")).not.toBeInTheDocument();
  act(() => listeners.get("alpha")!({ type: "conversation", conversation: snapshot("beta", []) }));
  expect(panel).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open Bot beta" }));
  await screen.findByText("beta reply", { selector: "p" });
  act(() => listeners.get("alpha")!({ type: "conversation", conversation: snapshot("alpha", [dispatch]) }));
  expect(screen.queryByRole("region", { name: "Outgoing Bot messages (live)" })).not.toBeInTheDocument();
  expect(screen.getByText("beta reply", { selector: "p" })).toBeInTheDocument();
});
