// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatModelSelector } from "../src/ChatModelSelector";
import { LanguageProvider } from "../src/i18n";
import { loadModelLibrary, MODEL_LIBRARY_KEY, rememberModel } from "../src/modelLibrary";
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const key = (model: string) => JSON.stringify(["local", model]);
function setup() {
  const api = { listBots: vi.fn(), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
    getBotConfiguration: vi.fn(async (bot: string) => ({ bot, provider: "local", model: "small", skills: [], toolsets: [], mcpServers: [], soul: "", providers: [{ slug: "local", name: "Local provider", models: ["small", "large", "small"] }] })),
    updateBot: vi.fn().mockResolvedValue({ applied: { model: true, provider: true }, confirmRequired: false }) };
  const tree = (name = "alpha", role: "admin" | "viewer" = "admin", running = false) => <LanguageProvider initialLanguage="en"><ChatModelSelector api={api} bot={{ name, system: false }} role={role} running={running} /></LanguageProvider>;
  const view = render(tree());
  return { api, tree, ...view };
}
it("filters models, persists a favorite and records a successful model selection", async () => {
  const { api } = setup();
  await waitFor(() => expect(screen.getByRole("button", { name: "Find a model" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Find a model" }));
  const search = await screen.findByRole("searchbox", { name: "Search models" });
  expect(search).toHaveFocus();
  fireEvent.change(search, { target: { value: "LARGE" } });
  expect(screen.getByLabelText("Available models")).toHaveValue(key("large"));
  fireEvent.click(screen.getByRole("button", { name: "Add favorite" }));
  expect(loadModelLibrary().favorites).toEqual([key("large")]);
  fireEvent.click(screen.getByRole("button", { name: "Use model" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.updateBot).toHaveBeenCalledWith("alpha", { provider: "local", model: "large" });
  expect(loadModelLibrary().recent).toEqual([key("large")]);
});
it("does not offer stale favorites and disables selection when no models match", async () => {
  localStorage.setItem(MODEL_LIBRARY_KEY, JSON.stringify({ favorites: [key("removed")], recent: [] }));
  setup();
  await waitFor(() => expect(screen.getByRole("button", { name: "Find a model" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Find a model" }));
  fireEvent.change(await screen.findByRole("searchbox"), { target: { value: "removed" } });
  expect(screen.getByRole("button", { name: "Use model" })).toBeDisabled();
  expect(screen.getByLabelText("Available models")).toHaveTextContent("No matching model");
});
it("ignores a save response after selecting another Bot", async () => {
  const { api, rerender, tree } = setup();
  let finish!: (value: unknown) => void;
  api.updateBot.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const select = await screen.findByLabelText("Bot model for alpha");
  await waitFor(() => expect(select).toBeEnabled());
  fireEvent.change(select, { target: { value: key("large") } });
  rerender(tree("beta"));
  await waitFor(() => expect(screen.getByLabelText("Bot model for beta")).toHaveValue(key("small")));
  await act(async () => finish({ applied: { model: true }, confirmRequired: false }));
  expect(screen.getByLabelText("Bot model for beta")).toHaveValue(key("small"));
  expect(loadModelLibrary().recent).toEqual([]);
});
it("does not record a rejected model and preserves the selection", async () => {
  const { api } = setup();
  api.updateBot.mockResolvedValue({ applied: { model: false }, confirmRequired: false });
  const select = await screen.findByLabelText("Bot model for alpha");
  await waitFor(() => expect(select).toBeEnabled());
  fireEvent.change(select, { target: { value: key("large") } });
  await waitFor(() => expect(select).toHaveValue(key("small")));
  expect(loadModelLibrary().recent).toEqual([]);
});
it("keeps model controls disabled for viewers and running conversations", async () => {
  const { tree, rerender } = setup();
  rerender(tree("alpha", "viewer"));
  expect(screen.getByRole("button", { name: "Find a model" })).toBeDisabled();
  rerender(tree("alpha", "admin", true));
  expect(screen.getByRole("button", { name: "Find a model" })).toBeDisabled();
  await act(async () => {});
});
it("bounds and validates local history and tolerates unavailable storage", () => {
  localStorage.setItem(MODEL_LIBRARY_KEY, '{"favorites":[null,"bad"],"recent":false}');
  expect(loadModelLibrary()).toEqual({ favorites: [], recent: [] });
  for (let n = 0; n < 12; n++) rememberModel(key(String(n)));
  rememberModel(key("11"));
  expect(loadModelLibrary().recent).toHaveLength(8);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
  expect(() => rememberModel(key("other"))).not.toThrow();
});
