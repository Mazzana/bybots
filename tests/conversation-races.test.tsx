// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, type BotsApi, type Conversation } from "../src/App";
import { LanguageProvider } from "../src/i18n";

afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const conversation = (bot: string, text = `${bot} history`): Conversation => ({
  bot, sessionId: `${bot}-session`, running: false, messages: [{ role: "assistant", text }]
});

function setup(overrides: Partial<BotsApi> = {}) {
  const api: BotsApi = {
    listBots: vi.fn().mockResolvedValue([{ name: "alpha", system: false }, { name: "beta", system: false }]),
    getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
    getConversation: vi.fn(async (name) => conversation(name)),
    sendMessage: vi.fn(), ...overrides
  };
  render(<LanguageProvider initialLanguage="en"><App api={api} /></LanguageProvider>);
  return api;
}

async function openBot(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Open Bot ${name}` }));
}

async function send(text: string) {
  fireEvent.change(await screen.findByRole("textbox", { name: "Message" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

describe("conversation request ownership", () => {
  it("ignores a late legacy history response after selecting another bot", async () => {
    const old = deferred<Conversation>();
    setup({ getConversation: vi.fn((name) => name === "alpha" ? old.promise : Promise.resolve(conversation(name))) });
    await openBot("alpha");
    await openBot("beta");
    expect(await screen.findByText("beta history", { selector: "p" })).toBeInTheDocument();
    await act(async () => old.resolve(conversation("alpha")));
    expect(screen.getByText("beta history", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("alpha history")).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("byfinity.lastActive")!)).toEqual({ scope: "bot", id: "beta" });
  });

  it("keeps the selected bot history when an earlier bot send finishes", async () => {
    const old = deferred<Conversation>();
    setup({ sendMessage: vi.fn(() => old.promise) });
    await openBot("alpha");
    await send("First request");
    await openBot("beta");
    expect(await screen.findByText("beta history", { selector: "p" })).toBeInTheDocument();
    await act(async () => old.resolve(conversation("alpha", "Late response")));
    expect(screen.getByText("beta history", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("Late response")).not.toBeInTheDocument();
  });

  it("restores a failed request without erasing a new draft", async () => {
    const old = deferred<Conversation>();
    setup({ sendMessage: vi.fn(() => old.promise) });
    await openBot("alpha");
    await send("First request");
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Next request" } });
    await act(async () => old.reject(new Error("Offline")));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("First request\n\nNext request");
  });

  it("restores a failed request to its own bot without exposing its error in another chat", async () => {
    const old = deferred<Conversation>();
    setup({ sendMessage: vi.fn(() => old.promise) });
    await openBot("alpha");
    await send("First request");
    await openBot("beta");
    const input = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(input, { target: { value: "Beta draft" } });
    await act(async () => old.reject(new Error("Alpha failure")));
    expect(input).toHaveValue("Beta draft");
    expect(screen.queryByText(/Alpha failure/)).not.toBeInTheDocument();
    await openBot("alpha");
    expect(await screen.findByRole("textbox", { name: "Message" })).toHaveValue("First request");
  });

  it("does not attach a file to another bot when reading finishes after navigation", async () => {
    const reading = deferred<string>();
    setup();
    await openBot("alpha");
    await screen.findByRole("textbox", { name: "Message" });
    const file = new File(["sensitive draft"], "alpha-only.txt", { type: "text/plain" });
    Object.defineProperty(file, "text", { value: () => reading.promise });
    fireEvent.change(screen.getByLabelText("Choose text files"), { target: { files: [file] } });
    await openBot("beta");
    await screen.findByText("beta history", { selector: "p" });
    await act(async () => reading.resolve("sensitive draft"));
    expect(screen.queryByText("alpha-only.txt")).not.toBeInTheDocument();
  });

  it("keeps new draft edits made while retrying a failed message", async () => {
    const retry = deferred<Conversation>();
    setup({ sendMessage: vi.fn().mockRejectedValueOnce(new Error("Offline")).mockImplementationOnce(() => retry.promise) });
    await openBot("alpha");
    await send("First request");
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "New draft during retry" } });
    await act(async () => retry.resolve(conversation("alpha", "Retry response")));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("New draft during retry");
  });

  it("keeps another bot selected when a retry finishes", async () => {
    const retry = deferred<Conversation>();
    setup({ sendMessage: vi.fn().mockRejectedValueOnce(new Error("Offline")).mockImplementationOnce(() => retry.promise) });
    await openBot("alpha");
    await send("First request");
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await openBot("beta");
    await screen.findByText("beta history", { selector: "p" });
    await act(async () => retry.resolve(conversation("alpha", "Retry response")));
    expect(screen.getByText("beta history", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("Retry response")).not.toBeInTheDocument();
  });

  it("does not clear an edited draft when retry sends only the failed request", async () => {
    const retry = deferred<Conversation>();
    const api = setup({ sendMessage: vi.fn().mockRejectedValueOnce(new Error("Offline")).mockImplementationOnce(() => retry.promise) });
    await openBot("alpha");
    await send("First request");
    const retryButton = await screen.findByRole("button", { name: "Retry" });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Edited unsent request" } });
    fireEvent.click(retryButton);
    expect(api.sendMessage).toHaveBeenLastCalledWith("alpha", "First request");
    await act(async () => retry.resolve(conversation("alpha", "Retry response")));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Edited unsent request");
  });
});
