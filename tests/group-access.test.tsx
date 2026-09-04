// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import GroupAccessPreview from "../src/GroupAccessPreview";
import { LanguageProvider } from "../src/i18n";
afterEach(() => { cleanup(); vi.useRealTimers(); });
const config = (name: string) => ({ bot: name, skills: [{ name: "read-docs", enabled: true }, { name: "disabled-skill", enabled: false }], toolsets: [{ name: "terminal", enabled: true }], mcpServers: [{ name: "drive", enabled: true }], soul: "PRIVATE INSTRUCTIONS", provider: "private-provider", model: "private-model", providers: [] });
function setup() {
  const api = { listBots: vi.fn(), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(), getBotConfiguration: vi.fn(async (name: string) => config(name)) };
  const tree = (members = ["alpha", "beta"]) => <LanguageProvider initialLanguage="en"><GroupAccessPreview api={api} bots={[]} members={members} /></LanguageProvider>;
  return { api, tree, ...render(tree()) };
}
it("loads only on opening and shows enabled names without private configuration", async () => {
  const { api } = setup();
  expect(api.getBotConfiguration).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review Bot access" }));
  const alpha = within(screen.getByRole("region", { name: "Access for alpha" }));
  expect(await alpha.findByText("terminal")).toBeInTheDocument();
  expect(api.getBotConfiguration).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("disabled-skill")).not.toBeInTheDocument();
  expect(screen.queryByText("PRIVATE INSTRUCTIONS")).not.toBeInTheDocument();
  expect(screen.queryByText("private-provider")).not.toBeInTheDocument();
});
it("keeps successful Bots visible when another member fails or returns malformed data", async () => {
  const { api } = setup();
  api.getBotConfiguration.mockImplementation(async (name) => { if (name === "beta") throw new Error("private diagnostic"); return config(name); });
  fireEvent.click(screen.getByRole("button", { name: "Review Bot access" }));
  expect(await screen.findByText("terminal")).toBeInTheDocument();
  expect(await screen.findByText("Access could not be verified. Do not assume this Bot has no access.")).toBeInTheDocument();
  expect(screen.queryByText("private diagnostic")).not.toBeInTheDocument();
  api.getBotConfiguration.mockResolvedValue({} as ReturnType<typeof config>);
  fireEvent.click(screen.getByRole("button", { name: "Refresh access" }));
  await waitFor(() => expect(screen.getAllByText("Access could not be verified. Do not assume this Bot has no access.")).toHaveLength(2));
});
it("does not populate a new member selection with stale results", async () => {
  const { api, tree, rerender } = setup();
  let finish!: (value: ReturnType<typeof config>) => void;
  api.getBotConfiguration.mockImplementation((name) => name === "alpha" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(config(name)));
  fireEvent.click(screen.getByRole("button", { name: "Review Bot access" }));
  await screen.findByText("terminal");
  rerender(tree(["gamma"]));
  await waitFor(() => expect(api.getBotConfiguration).toHaveBeenCalledWith("gamma"));
  await act(async () => finish(config("alpha")));
  expect(screen.queryByRole("region", { name: "Access for alpha" })).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Access for gamma" })).getByText("terminal")).toBeInTheDocument();
});
it("reports a timeout instead of loading forever and supports a fresh retry", async () => {
  vi.useFakeTimers();
  const { api } = setup();
  api.getBotConfiguration.mockReturnValue(new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Review Bot access" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(screen.getAllByText("Access could not be verified. Do not assume this Bot has no access.")).toHaveLength(2);
  api.getBotConfiguration.mockImplementation(async (name) => config(name));
  fireEvent.click(screen.getByRole("button", { name: "Refresh access" }));
  await act(async () => {});
  expect(screen.getAllByText("terminal")).toHaveLength(2);
});
it("never labels an unavailable endpoint as empty access and closes cleanly", async () => {
  const { api } = setup();
  api.getBotConfiguration.mockRejectedValue(new Error("Forbidden"));
  fireEvent.click(screen.getByRole("button", { name: "Review Bot access" }));
  await waitFor(() => expect(screen.getAllByText("Access could not be verified. Do not assume this Bot has no access.")).toHaveLength(2));
  expect(screen.queryByText("None reported by Hermes")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
