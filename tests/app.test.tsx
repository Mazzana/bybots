// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, type Bot } from "../src/App";
import { HermesConnectionPanel } from "../src/HermesConnectionPanel";
import { LanguageProvider, type Language } from "../src/i18n";

afterEach(() => { cleanup(); window.localStorage.clear(); delete document.documentElement.dataset.desktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function renderApp(api: Parameters<typeof App>[0]["api"], language: Language = "fr") {
  return render(<LanguageProvider initialLanguage={language}><App api={api} /></LanguageProvider>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("ByBots UI", () => {
  it("guides first-time users through a local or remote Hermes connection", async () => {
    const disconnected = {
      checkedAt: new Date().toISOString(), supportedHermes: "0.21.x",
      bridge: { status: "ready" as const, version: "0.1.0" },
      hermes: { status: "warning" as const, baseUrl: "http://127.0.0.1:9120" },
      authentication: { status: "error" as const, detail: "Hermes session token is required" }
    };
    const connected = {
      ...disconnected,
      hermes: { status: "ready" as const, baseUrl: "https://hermes.example.test", version: "0.21.4", compatible: true },
      authentication: { status: "ready" as const }
    };
    const api = {
      listBots: vi.fn().mockResolvedValue([]), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      getAccess: vi.fn().mockResolvedValue({ role: "admin" as const }),
      listMachines: vi.fn().mockResolvedValue([]), listGroups: vi.fn().mockResolvedValue([]),
      getDiagnostics: vi.fn().mockResolvedValueOnce(disconnected).mockResolvedValue(connected),
      getHermesConnection: vi.fn().mockResolvedValue({ baseUrl: "http://127.0.0.1:9120", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: false, secure: true, source: "environment" as const }),
      testHermesConnection: vi.fn().mockResolvedValue({ baseUrl: "https://hermes.example.test", secure: true, version: "0.21.4" }),
      updateHermesConnection: vi.fn().mockResolvedValue({ baseUrl: "https://hermes.example.test", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, secure: true, source: "saved" as const, version: "0.21.4" }),
      resetHermesConnection: vi.fn(),
      startHermesOAuth: vi.fn().mockResolvedValue({ authorizationUrl: "https://hermes.example.test/auth/native/authorize" })
    };
    renderApp(api, "en");

    expect(await screen.findByRole("heading", { name: "Connect your Hermes gateway" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Local Hermes/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Remote Hermes/ }));
    expect(screen.getByRole("button", { name: /Remote Hermes/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(await screen.findByLabelText("Gateway URL"), { target: { value: "https://hermes.example.test" } });
    fireEvent.change(screen.getByLabelText("Hermes session token"), { target: { value: "secret-session" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and connect" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Connect your Hermes gateway" })).not.toBeInTheDocument());
    expect(api.updateHermesConnection).toHaveBeenCalledWith({ baseUrl: "https://hermes.example.test", token: "secret-session" });
  });

  it("detects and presents the Hermes Desktop OAuth flow without a provider field", async () => {
    const api = {
      listBots: vi.fn(), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      getHermesConnection: vi.fn().mockResolvedValue({ baseUrl: "http://127.0.0.1:9120", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, secure: true, source: "environment" as const }),
      testHermesConnection: vi.fn(), updateHermesConnection: vi.fn(), resetHermesConnection: vi.fn(),
      probeHermesAuth: vi.fn().mockResolvedValue({ baseUrl: "https://hermes.example.test", reachable: true, authMode: "oauth" as const, nativePkce: true, providers: [{ name: "nous", displayName: "Nous Research", supportsPassword: false }] }),
      startHermesOAuth: vi.fn().mockResolvedValue({ authorizationUrl: "https://hermes.example.test/auth/native/authorize" })
    };
    render(<LanguageProvider initialLanguage="en"><HermesConnectionPanel api={api} role="admin" onConnected={vi.fn()} /></LanguageProvider>);

    fireEvent.click(await screen.findByRole("button", { name: /Remote Hermes/ }));
    fireEvent.change(screen.getByLabelText("Gateway URL"), { target: { value: "https://hermes.example.test" } });

    expect(await screen.findByRole("button", { name: "Sign in with Nous Research" }, { timeout: 2_000 })).toBeEnabled();
    expect(api.probeHermesAuth).toHaveBeenCalledWith({ baseUrl: "https://hermes.example.test" });
    expect(screen.queryByText("OAuth provider")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Hermes session token")).not.toBeInTheDocument();
  });

  it.each(["windows", "macos"])("follows OAuth completion in Electron on %s after opening the system browser", async (desktopPlatform) => {
    document.documentElement.dataset.desktop = desktopPlatform;
    const originalConsoleError = console.error;
    vi.spyOn(console, "error").mockImplementation((message, ...details) => {
      if (!String(message).includes("Not implemented: navigation")) originalConsoleError(message, ...details);
    });
    const local = { baseUrl: "http://127.0.0.1:9120", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, secure: true, source: "environment" as const };
    const remote = { baseUrl: "https://hermes.example.test", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, authMode: "oauth" as const, secure: true, source: "saved" as const, version: "0.21.4" };
    const onConnected = vi.fn();
    const api = {
      listBots: vi.fn(), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      getHermesConnection: vi.fn().mockResolvedValueOnce(local).mockResolvedValue(remote),
      testHermesConnection: vi.fn(), updateHermesConnection: vi.fn(), resetHermesConnection: vi.fn(),
      probeHermesAuth: vi.fn().mockResolvedValue({ baseUrl: remote.baseUrl, reachable: true, authMode: "oauth" as const, nativePkce: true, providers: [{ name: "nous", displayName: "Nous Research", supportsPassword: false }] }),
      startHermesOAuth: vi.fn().mockResolvedValue({ authorizationUrl: `${remote.baseUrl}/auth/native/authorize` })
    };
    render(<LanguageProvider initialLanguage="en"><HermesConnectionPanel api={api} role="admin" onConnected={onConnected} /></LanguageProvider>);

    fireEvent.click(await screen.findByRole("button", { name: /Remote Hermes/ }));
    fireEvent.change(screen.getByLabelText("Gateway URL"), { target: { value: remote.baseUrl } });
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Nous Research" }, { timeout: 2_000 }));

    expect(await screen.findByRole("button", { name: "Cancel" })).toBeEnabled();
    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce(), { timeout: 2_500 });
    expect(await screen.findByText("Connected to Hermes 0.21.4")).toBeInTheDocument();
  });

  it("asks for a fresh Hermes sign-in when a saved OAuth session has expired", async () => {
    const api = {
      listBots: vi.fn(), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      getHermesConnection: vi.fn().mockResolvedValue({ baseUrl: "https://hermes.example.test", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: false, authMode: "oauth" as const, secure: true, source: "saved" as const, requiresReauthentication: true }),
      testHermesConnection: vi.fn(), updateHermesConnection: vi.fn(), resetHermesConnection: vi.fn(),
      probeHermesAuth: vi.fn().mockResolvedValue({ baseUrl: "https://hermes.example.test", reachable: true, authMode: "oauth" as const, nativePkce: true, providers: [{ name: "nous", displayName: "Nous Research", supportsPassword: false }] }),
      startHermesOAuth: vi.fn().mockResolvedValue({ authorizationUrl: "https://hermes.example.test/auth/native/authorize" })
    };
    render(<LanguageProvider initialLanguage="en"><HermesConnectionPanel api={api} role="admin" onConnected={vi.fn()} /></LanguageProvider>);

    expect(await screen.findByText("Hermes session expired")).toBeInTheDocument();
    expect(screen.getByText("Sign in again")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Sign in with Nous Research" }, { timeout: 2_000 })).toBeEnabled();
  });

  it("reconnects local Hermes without asking the user for a session token", async () => {
    const disconnected = {
      checkedAt: new Date().toISOString(), supportedHermes: "0.21.x",
      bridge: { status: "ready" as const, version: "0.1.0" },
      hermes: { status: "warning" as const, baseUrl: "http://127.0.0.1:9120" },
      authentication: { status: "error" as const, detail: "Hermes session token is required" }
    };
    const connected = {
      ...disconnected,
      hermes: { status: "ready" as const, baseUrl: "http://127.0.0.1:9120", version: "0.21.4", compatible: true },
      authentication: { status: "ready" as const }
    };
    const local = { baseUrl: "http://127.0.0.1:9120", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, secure: true, source: "environment" as const, version: "0.21.4" };
    const api = {
      listBots: vi.fn().mockResolvedValue([]), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      getAccess: vi.fn().mockResolvedValue({ role: "admin" as const }),
      listMachines: vi.fn().mockResolvedValue([]), listGroups: vi.fn().mockResolvedValue([]),
      getDiagnostics: vi.fn().mockResolvedValueOnce(disconnected).mockResolvedValue(connected),
      getHermesConnection: vi.fn().mockResolvedValue(local),
      testHermesConnection: vi.fn(), updateHermesConnection: vi.fn(),
      resetHermesConnection: vi.fn().mockResolvedValue(local)
    };
    renderApp(api, "en");

    expect(await screen.findByText("Managed automatically by ByBots")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hermes session token")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Local Hermes/ }));

    await waitFor(() => expect(api.resetHermesConnection).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Connect your Hermes gateway" })).not.toBeInTheDocument());
  });

  it("shows initial loading and a recoverable Bot-list failure before the empty state", async () => {
    const firstLoad = deferred<Bot[]>();
    const api = {
      listBots: vi.fn().mockReturnValueOnce(firstLoad.promise).mockResolvedValue([]),
      getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn()
    };
    renderApp(api, "en");

    expect(screen.getByRole("heading", { name: "Loading your Bots…" })).toBeInTheDocument();
    await act(async () => firstLoad.reject(new Error("Hermes is offline")));
    const failure = await screen.findByRole("heading", { name: "Conversations unavailable" });
    fireEvent.click(within(failure.parentElement!).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "No conversations yet" })).toBeInTheDocument();
    expect(api.listBots).toHaveBeenCalledTimes(2);
  });

  it("shows a recoverable conversation loading failure", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", periodDays: 30, totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, actualCostUsd: 0, estimatedCostUsd: 0, sessions: 1, apiCalls: 0, byModel: [] }), createBot: vi.fn(), deleteBot: vi.fn(),
      getConversation: vi.fn().mockRejectedValueOnce(new Error("Hermes is offline")).mockResolvedValue({ bot: "finance", sessionId: "s1", running: false, messages: [] })
    };
    renderApp(api, "en");

    fireEvent.click(await screen.findByRole("button", { name: "Open Bot finance" }));
    const failure = await screen.findByRole("heading", { name: "Conversation unavailable" });
    fireEvent.click(within(failure.parentElement!).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Write to finance" })).toBeInTheDocument();
    expect(api.getConversation).toHaveBeenCalledTimes(2);
  });

  it("shows and retries a group-list failure independently from Bots", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      listGroups: vi.fn().mockRejectedValueOnce(new Error("Groups unavailable")).mockResolvedValue([])
    };
    renderApp(api, "en");

    const failure = await screen.findByText("Could not load group conversations.", { selector: "strong" });
    fireEvent.click(within(failure.parentElement!).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("No group conversation yet.")).toBeInTheDocument();
    expect(api.listGroups).toHaveBeenCalledTimes(2);
  });

  it("keeps usage failures inside the Usage settings section", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockRejectedValue(new Error("Usage endpoint unavailable")),
      createBot: vi.fn(), deleteBot: vi.fn(),
      getConversation: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: false, messages: [] })
    };
    renderApp(api, "en");

    await screen.findByRole("button", { name: "Open Bot finance" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Usage" }));

    const usageFailure = await screen.findByText(/Usage unavailable/);
    expect(usageFailure).toHaveAttribute("role", "alert");
  });

  it.each([
    ["offline", { status: "error" as const, baseUrl: "http://127.0.0.1:9120" }, "Hermes is unavailable"],
    ["incompatible", { status: "ready" as const, baseUrl: "http://127.0.0.1:9120", version: "0.22.0", compatible: false }, "Hermes version is not supported"]
  ])("shows the explicit %s Hermes state", async (_state, hermes, heading) => {
    const api = {
      listBots: vi.fn().mockResolvedValue([]), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      getDiagnostics: vi.fn().mockResolvedValue({
        checkedAt: new Date().toISOString(), supportedHermes: "0.21.x",
        bridge: { status: "ready" as const, version: "0.1.0" }, hermes,
        authentication: { status: "ready" as const }
      })
    };
    renderApp(api, "en");

    const stateHeading = await screen.findByText(heading, { selector: "strong" });
    expect(stateHeading.closest("[role='alert']")).toBeInTheDocument();
  });

  it("keeps Bot details free of cost estimates without unmounting chat", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({
        bot: "finance",
        totalTokens: 1500,
        inputTokens: 1000,
        outputTokens: 400,
        reasoningTokens: 100,
        estimatedCostUsd: 0.42,
        actualCostUsd: 0.39,
        sessions: 3,
        apiCalls: 6,
        periodDays: 30,
        cacheReadTokens: 0,
        byModel: []
      }),
      createBot: vi.fn(),
      deleteBot: vi.fn(),
      getConversation: vi.fn().mockResolvedValue({
        bot: "finance",
        sessionId: "session-finance",
        running: false,
        messages: [{ role: "assistant" as const, text: "Rapport disponible." }]
      })
    };
    renderApp(api);

    fireEvent.click(await screen.findByText("finance"));

    expect(screen.queryByRole("complementary", { name: "Détails" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Afficher les détails" }));
    const details = await screen.findByRole("complementary", { name: "Détails" });
    const log = screen.getByRole("log");
    expect(within(details).queryByText(/coût|cost|0,42/i)).not.toBeInTheDocument();
    expect(api.getUsage).not.toHaveBeenCalled();
    expect(await within(log).findByText("Rapport disponible.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Masquer les détails" }));

    expect(screen.queryByRole("complementary", { name: "Détails" })).not.toBeInTheDocument();
    expect(within(log).getByText("Rapport disponible.")).toBeInTheDocument();
  });

  it("shows token and model usage in the dedicated settings section", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "default", system: true }, { name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({
        bot: "finance",
        totalTokens: 1500,
        inputTokens: 1100,
        outputTokens: 400,
        reasoningTokens: 0,
        estimatedCostUsd: 0.42,
        actualCostUsd: 0.39,
        sessions: 3,
        apiCalls: 6,
        periodDays: 30,
        cacheReadTokens: 0,
        byModel: [
          { model: "gpt-5.6-terra", inputTokens: 750, outputTokens: 300, estimatedCostUsd: 0.32 },
          { model: "gpt-5.6-luna", inputTokens: 250, outputTokens: 100, estimatedCostUsd: 0.1 }
        ]
      }),
      createBot: vi.fn(),
      deleteBot: vi.fn()
    };

    renderApp(api);
    expect(await screen.findByText("finance")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Réglages" }));
    fireEvent.click(await screen.findByRole("button", { name: "Utilisation" }));
    fireEvent.change(screen.getByLabelText("Utilisation de"), { target: { value: "finance" } });

    expect(await screen.findByText((text) => text.replace(/\s/g, "") === "1500")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Utilisation par modèle" })).toHaveTextContent("gpt-5.6-terra");
    expect(screen.getByRole("region", { name: "Utilisation par modèle" })).toHaveTextContent(/1\s?050 jetons · 75\s?%/);
    expect(screen.getByRole("progressbar", { name: "gpt-5.6-terra : 75 % des jetons des modèles" })).toHaveAttribute("aria-valuenow", "75");
    expect(screen.getByRole("progressbar", { name: "gpt-5.6-luna : 25 % des jetons des modèles" })).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText(/Hermes communique les totaux et les jetons par modèle séparément/)).toBeInTheDocument();
    expect(screen.queryByText(/0,42/)).not.toBeInTheDocument();
    await waitFor(() => expect(api.getUsage).toHaveBeenCalledWith("finance", 30));
  });

  it("does not render cost fields even when Hermes returns them", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", periodDays: 30, totalTokens: 420, inputTokens: 300, outputTokens: 120, reasoningTokens: 0, cacheReadTokens: 0, actualCostUsd: 0, estimatedCostUsd: 0, sessions: 1, apiCalls: 1, byModel: [{ model: "local-model", inputTokens: 300, outputTokens: 120, estimatedCostUsd: 0 }] }),
      createBot: vi.fn(), deleteBot: vi.fn(),
      getConversation: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: false, messages: [] })
    };
    renderApp(api, "en");

    await screen.findByRole("button", { name: "Open Bot finance" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Usage" }));
    expect(await screen.findByRole("region", { name: "Usage by model" })).toHaveTextContent("local-model");
    expect(screen.queryByText("Cost unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("creates a new Hermes bot from the sidebar", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([]),
      getUsage: vi.fn(),
      createBot: vi.fn().mockResolvedValue({ name: "analyst", system: false }),
      deleteBot: vi.fn()
    };
    renderApp(api);

    fireEvent.click(screen.getByRole("button", { name: "Nouveau Bot" }));
    fireEvent.change(screen.getByLabelText("Nom visible"), { target: { value: "Data Analyst" } });
    fireEvent.change(screen.getByLabelText("Mission"), { target: { value: "Analyse les données." } });
    expect(screen.getByLabelText("Nom technique")).toHaveValue("data-analyst");
    fireEvent.change(screen.getByLabelText("Nom technique"), { target: { value: "analyst" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer le Bot" }));

    expect(await screen.findByText("analyst")).toBeInTheDocument();
    expect(api.createBot).toHaveBeenCalledWith({ name: "analyst", title: "Data Analyst", description: "Analyse les données.", avatar: { shape: "blobatar::round" } });
  });

  it("prefers the optional Hermes title in every Bot label", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "inbox-triage", displayName: "Inbox triage profile", title: "Inbox Triage", system: false }]),
      getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn()
    };
    renderApp(api, "en");

    expect(await screen.findByText("Inbox Triage")).toBeInTheDocument();
    expect(screen.queryByText("inbox-triage")).not.toBeInTheDocument();
  });

  it("selects a Bot model directly from the models returned by Hermes", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", title: "Finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, inputTokens: 0, outputTokens: 0, sessions: 0, apiCalls: 0 }),
      createBot: vi.fn(), deleteBot: vi.fn(),
      getBotConfiguration: vi.fn().mockResolvedValue({
        bot: "finance", provider: "openai-codex", model: "gpt-5.6-terra", soul: "",
        skills: [], toolsets: [], mcpServers: [],
        providers: [
          { slug: "openai-codex", name: "OpenAI Codex", models: ["gpt-5.6-terra", "gpt-5.6-sol"] },
          { slug: "anthropic", name: "Anthropic", models: ["claude-sonnet-4-5"] }
        ]
      }),
      updateBot: vi.fn().mockResolvedValue({ applied: { model: true }, confirmRequired: false })
    };
    renderApp(api, "en");

    fireEvent.click(await screen.findByText("Finance"));
    const selector = await screen.findByRole("combobox", { name: "Bot model for Finance" });
    expect(await within(selector).findByRole("option", { name: "gpt-5.6-sol" })).toBeInTheDocument();
    expect(await within(selector).findByRole("option", { name: "claude-sonnet-4-5" })).toBeInTheDocument();

    fireEvent.change(selector, { target: { value: JSON.stringify(["openai-codex", "gpt-5.6-sol"]) } });

    await waitFor(() => expect(api.updateBot).toHaveBeenCalledWith("finance", {
      provider: "openai-codex",
      model: "gpt-5.6-sol"
    }));
    expect(await screen.findByText("Model saved.")).toBeInTheDocument();
  });

  it("loads native Hermes pets from the creation appearance panel", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([]),
      getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      listAvatarPets: vi.fn().mockResolvedValue([
        { slug: "pixel-fox", displayName: "Pixel Fox", installed: true },
        { slug: "tiny-owl", displayName: "Tiny Owl", curated: true }
      ])
    };
    renderApp(api, "en");

    fireEvent.click(screen.getByRole("button", { name: "New Bot" }));
    fireEvent.click(screen.getByRole("tab", { name: "Pets" }));
    expect(await screen.findByRole("button", { name: "Pixel Fox" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tiny Owl" })).toBeInTheDocument();
    expect(api.listAvatarPets).toHaveBeenCalledTimes(1);
  });

  it("switches between the English source UI and French, then persists the choice", async () => {
    const api = { listBots: vi.fn().mockResolvedValue([]), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn() };
    renderApp(api, "en");
    expect(screen.getByRole("button", { name: "New Bot" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("option", { name: "System language" })).toBeInTheDocument();
    expect(screen.getByLabelText("Application language").parentElement).toHaveClass("select-control");
    expect(screen.getByLabelText("Application language").parentElement?.querySelector("svg")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Application language"), { target: { value: "fr" } });
    expect(await screen.findByRole("button", { name: "Nouveau Bot" })).toBeInTheDocument();
    expect(window.localStorage.getItem("byfinity.language")).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
  });

  it("persists compact, accessible, and chat preferences from one settings panel", async () => {
    class NotificationMock {
      static permission: NotificationPermission = "default";
      static requestPermission = vi.fn().mockImplementation(async () => {
        NotificationMock.permission = "granted";
        return "granted" as NotificationPermission;
      });
    }
    vi.stubGlobal("Notification", NotificationMock);
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", periodDays: 30, totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, actualCostUsd: 0, estimatedCostUsd: 0, sessions: 0, apiCalls: 0, byModel: [] }),
      createBot: vi.fn(), deleteBot: vi.fn()
    };
    renderApp(api);

    await screen.findByText("finance");
    fireEvent.click(screen.getByRole("button", { name: "Réglages" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Compacte/ }));
    expect(document.documentElement.dataset.density).toBe("compact");

    fireEvent.click(screen.getByRole("button", { name: "Discussion" }));
    fireEvent.click(screen.getByRole("switch", { name: /Envoyer avec Entrée/ }));
    fireEvent.click(screen.getByRole("switch", { name: /Notifications de fin/ }));
    await waitFor(() => expect(NotificationMock.requestPermission).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Utilisation" }));
    fireEvent.change(screen.getByLabelText("Période d’utilisation"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Accessibilité" }));
    fireEvent.click(screen.getByRole("switch", { name: /Réduire les animations/ }));

    expect(document.documentElement).toHaveClass("reduce-motion");
    expect(JSON.parse(window.localStorage.getItem("byfinity.preferences") || "{}")).toMatchObject({
      density: "compact",
      sendOnEnter: false,
      desktopNotifications: true,
      reduceMotion: true,
      usageDays: 90
    });
  });

  it("loads and updates the real Hermes MCP assignment for a Bot", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", title: "Finance", system: false }]),
      getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      getBotConfiguration: vi.fn().mockResolvedValue({
        bot: "finance", provider: "", model: "", soul: "", skills: [], toolsets: [], providers: [],
        mcpServers: [
          { name: "filesystem", description: "Local files", enabled: false, installed: true, toolCount: 4 },
          { name: "notion", enabled: false, installed: false, fromCatalog: true, auth: "oauth", requires: ["token"] },
          { name: "public-catalog", enabled: false, installed: false, fromCatalog: true }
        ]
      }),
      testMcpServer: vi.fn().mockResolvedValue({ server: "filesystem", toolCount: 4, tools: ["read", "write", "list", "search"] }),
      updateBot: vi.fn().mockResolvedValue({ applied: { mcp_servers: true }, confirmRequired: false })
    };
    renderApp(api);

    await screen.findByText("Finance");
    fireEvent.click(screen.getByRole("button", { name: "Réglages" }));
    fireEvent.click(await screen.findByRole("button", { name: "MCP" }));
    fireEvent.click(await screen.findByRole("switch", { name: "Activer filesystem" }));

    await waitFor(() => expect(api.testMcpServer).toHaveBeenCalledWith("finance", "filesystem"));
    await waitFor(() => expect(api.updateBot).toHaveBeenCalledWith("finance", { enabledMcpServers: ["filesystem"] }));
    expect(screen.getByText("filesystem est prêt · 4 outils disponibles.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Activer notion" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Activer public-catalog" })).toBeDisabled();
  });

  it("does not assign an MCP server when its connection test fails", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", title: "Finance", system: false }]),
      getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      getBotConfiguration: vi.fn().mockResolvedValue({
        bot: "finance", provider: "", model: "", soul: "", skills: [], toolsets: [], providers: [],
        mcpServers: [{ name: "filesystem", enabled: false, installed: true }]
      }),
      testMcpServer: vi.fn().mockRejectedValue(new Error("Hermes could not validate this MCP server")),
      updateBot: vi.fn()
    };
    renderApp(api);

    await screen.findByText("Finance");
    fireEvent.click(screen.getByRole("button", { name: "Réglages" }));
    fireEvent.click(await screen.findByRole("button", { name: "MCP" }));
    fireEvent.click(await screen.findByRole("switch", { name: "Activer filesystem" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Hermes n’a pas pu valider ce serveur MCP.");
    expect(api.updateBot).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "Activer filesystem" })).not.toBeChecked();
  });

  it("keeps the creation form open and surfaces the exact Hermes rejection", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([]),
      getUsage: vi.fn(),
      createBot: vi.fn().mockRejectedValue(new Error("Profile 'analyst' already exists")),
      deleteBot: vi.fn()
    };
    renderApp(api);

    fireEvent.click(screen.getByRole("button", { name: "Nouveau Bot" }));
    fireEvent.change(screen.getByLabelText("Nom visible"), { target: { value: "Analyst" } });
    fireEvent.change(screen.getByLabelText("Mission"), { target: { value: "Analyse les données" } });
    fireEvent.change(screen.getByLabelText("Nom technique"), { target: { value: "Analyst" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer le Bot" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Le profil « analyst » existe déjà");
    expect(screen.getByLabelText("Nom technique")).toHaveValue("Analyst");
    expect(api.createBot).toHaveBeenCalledWith({ name: "analyst", title: "Analyst", description: "Analyse les données", avatar: { shape: "blobatar::round" } });
  });

  it("deletes the selected non-system bot after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "analyst", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "analyst", totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, sessions: 0, apiCalls: 0, periodDays: 30, cacheReadTokens: 0, byModel: [] }),
      createBot: vi.fn(),
      deleteBot: vi.fn().mockResolvedValue(undefined)
    };
    renderApp(api);

    fireEvent.click(await screen.findByText("analyst"));
    fireEvent.click(screen.getByRole("button", { name: "Afficher les détails" }));
    fireEvent.click(await screen.findByRole("button", { name: "Supprimer ce Bot" }));

    await waitFor(() => expect(api.deleteBot).toHaveBeenCalledWith("analyst"));
    expect(screen.queryByText("analyst")).not.toBeInTheDocument();
  });

  it("loads and sends messages in the bot canonical chat", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, sessions: 0, apiCalls: 0, periodDays: 30, cacheReadTokens: 0, byModel: [] }),
      createBot: vi.fn(),
      deleteBot: vi.fn(),
      getConversation: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: false, messages: [{ role: "assistant", text: "Comment puis-je aider ?" }] }),
      sendMessage: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: true, messages: [{ role: "assistant", text: "Comment puis-je aider ?" }, { role: "user", text: "Prépare le rapport" }] })
    };
    renderApp(api);

    fireEvent.click(await screen.findByText("finance"));
    expect(await within(screen.getByRole("log")).findByText("Comment puis-je aider ?")).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "Prépare le rapport" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith("finance", "Prépare le rapport"));
    expect(await screen.findByText("Prépare le rapport")).toBeInTheDocument();
  });

  it("keeps a separate draft for each conversation", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", title: "Finance", system: false }, { name: "ops", title: "Operations", system: false }]),
      getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      getConversation: vi.fn((name: string) => Promise.resolve({ bot: name, sessionId: `session-${name}`, running: false, messages: [] }))
    };
    renderApp(api, "en");

    fireEvent.click(await screen.findByRole("button", { name: "Open Bot Finance" }));
    await screen.findByRole("heading", { name: "Write to Finance" });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Finance draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Open Bot Operations" }));
    await screen.findByRole("heading", { name: "Write to Operations" });
    expect(screen.getByLabelText("Message")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Operations draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Open Bot Finance" }));

    await screen.findByRole("heading", { name: "Write to Finance" });
    expect(screen.getByLabelText("Message")).toHaveValue("Finance draft");
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("byfinity.drafts.v1") || "{}")).toMatchObject({
      "bot:finance:legacy": "Finance draft",
      "bot:ops:legacy": "Operations draft"
    }));
  });

  it("sends bounded text attachments as portable message content", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", title: "Finance", system: false }]),
      getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      getConversation: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: false, messages: [] }),
      sendMessage: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: true, messages: [] })
    };
    const attachment = new File(["Revenue,42"], "forecast.csv", { type: "text/csv" });
    Object.defineProperty(attachment, "text", { value: vi.fn().mockResolvedValue("Revenue,42") });
    renderApp(api, "en");

    fireEvent.click(await screen.findByRole("button", { name: "Open Bot Finance" }));
    await screen.findByRole("heading", { name: "Write to Finance" });
    fireEvent.change(screen.getByLabelText("Choose text files"), { target: { files: [attachment] } });
    expect(await screen.findByText("forecast.csv")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith("finance", expect.stringContaining('<attachment name="forecast.csv" type="text/csv">\nRevenue,42\n</attachment>')));
    expect(screen.queryByText("forecast.csv")).not.toBeInTheDocument();
  });

  it("shows recent thread summaries, searches them, and starts from a guided prompt", async () => {
    const threads = [{ id: "s1", bot: "finance", title: "Roadmap review", preview: "Risks and next steps", startedAt: 2, messageCount: 3, running: false }];
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", title: "Finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, sessions: 1, apiCalls: 1, periodDays: 30, cacheReadTokens: 0, byModel: [] }),
      createBot: vi.fn(), deleteBot: vi.fn(),
      listThreads: vi.fn().mockResolvedValue(threads),
      createThread: vi.fn(),
      getThread: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: false, messages: [{ role: "assistant" as const, text: "Roadmap ready" }] }),
      sendThreadMessage: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn()
    };
    renderApp(api, "en");

    expect(await within(await screen.findByRole("log")).findByText("Roadmap ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open ByBots home" }));
    expect(await screen.findByRole("heading", { name: "Pick up where you left off" })).toBeInTheDocument();
    expect(await screen.findByText("Risks and next steps")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search conversations"), { target: { value: "risks" } });
    fireEvent.click(await screen.findByRole("button", { name: "Open thread Roadmap review" }));
    expect(await within(screen.getByRole("log")).findByText("Roadmap ready")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open ByBots home" }));
    fireEvent.click(screen.getByRole("button", { name: /Build an action plan/ }));
    expect(await screen.findByLabelText("Message")).toHaveValue("Help me build a clear action plan for the objective I will describe.");
  });

  it("automatically restores the last active Hermes thread", async () => {
    const thread = { id: "s1", bot: "finance", title: "Forecast", preview: "Q4", startedAt: 2, messageCount: 1, running: false };
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, sessions: 1, apiCalls: 1, periodDays: 30, cacheReadTokens: 0, byModel: [] }),
      createBot: vi.fn(), deleteBot: vi.fn(), listThreads: vi.fn().mockResolvedValue([thread]), createThread: vi.fn(),
      getThread: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: false, messages: [{ role: "assistant" as const, text: "Forecast restored" }] }),
      sendThreadMessage: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn()
    };
    window.localStorage.setItem("byfinity.lastActive", JSON.stringify({ scope: "bot", id: "finance", threadId: "s1" }));
    renderApp(api, "en");

    const log = await screen.findByRole("log");
    expect(await within(log).findByText("Forecast restored")).toBeInTheDocument();
    expect(api.getThread).toHaveBeenCalledWith("finance", "s1");
  });

  it("opens the most recent Hermes thread when no last active conversation is stored", async () => {
    const olderThread = { id: "s1", bot: "finance", title: "Budget", preview: "Q3", startedAt: 1, messageCount: 1, running: false };
    const latestThread = { id: "s2", bot: "operations", title: "Morning brief", preview: "Priorities", startedAt: 3, messageCount: 1, running: false };
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }, { name: "operations", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "operations", totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, sessions: 1, apiCalls: 1, periodDays: 30, cacheReadTokens: 0, byModel: [] }),
      createBot: vi.fn(), deleteBot: vi.fn(),
      listThreads: vi.fn((name: string) => Promise.resolve(name === "finance" ? [olderThread] : [latestThread])),
      createThread: vi.fn(),
      getThread: vi.fn().mockResolvedValue({ bot: "operations", sessionId: "s2", running: false, messages: [{ role: "assistant" as const, text: "Latest conversation restored" }] }),
      sendThreadMessage: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn()
    };
    renderApp(api, "en");

    const log = await screen.findByRole("log");
    expect(await within(log).findByText("Latest conversation restored")).toBeInTheDocument();
    expect(api.getThread).toHaveBeenCalledWith("operations", "s2");
  });

  it("reopens the remembered Hermes thread and switches threads inside a Bot chat", async () => {
    const threads = [
      { id: "s1", bot: "finance", title: "Budget", preview: "Q3", startedAt: 1, messageCount: 1, running: false },
      { id: "s2", bot: "finance", title: "Forecast", preview: "Q4", startedAt: 2, messageCount: 1, running: false }
    ];
    const conversation = (sessionId: string, text: string) => ({ bot: "finance", sessionId, running: false, messages: [{ role: "assistant" as const, text }] });
    let streamListener: ((event: any) => void) | undefined;
    const stopWatching = vi.fn();
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, sessions: 2, apiCalls: 2, periodDays: 30, cacheReadTokens: 0, byModel: [] }),
      createBot: vi.fn(), deleteBot: vi.fn(),
      listThreads: vi.fn().mockResolvedValue(threads),
      createThread: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s3", running: false, messages: [] }),
      getThread: vi.fn((_: string, id: string) => Promise.resolve(conversation(id, id === "s1" ? "Budget answer" : "Forecast answer"))),
      sendThreadMessage: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: true, messages: [{ role: "user" as const, text: "Update budget" }] }),
      renameThread: vi.fn().mockResolvedValue({ ...threads[1], title: "Updated budget" }), archiveThread: vi.fn(),
      watchThread: vi.fn((_name: string, _threadId: string, listener: (event: any) => void, onStatus: (status: string) => void) => {
        streamListener = listener;
        onStatus("connected");
        return stopWatching;
      })
    };
    window.localStorage.setItem("byfinity.lastThreads", JSON.stringify({ finance: "s2" }));
    renderApp(api, "en");

    fireEvent.click(await screen.findByText("finance"));
    expect(await within(screen.getByRole("log")).findByText("Forecast answer")).toBeInTheDocument();
    expect(api.getThread).toHaveBeenCalledWith("finance", "s2");
    const threadTabs = screen.getByRole("tablist", { name: "Threads for finance" });
    expect(within(threadTabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Budget", "Forecast"]);
    const forecastTab = within(threadTabs).getByRole("tab", { name: "Forecast" });
    const budgetTab = within(threadTabs).getByRole("tab", { name: "Budget" });
    expect(forecastTab).toHaveAttribute("aria-selected", "true");
    expect(forecastTab).toHaveAttribute("tabindex", "0");
    expect(budgetTab).toHaveAttribute("tabindex", "-1");
    forecastTab.focus();
    fireEvent.keyDown(forecastTab, { key: "ArrowLeft" });
    expect(budgetTab).toHaveFocus();
    expect(await within(screen.getByRole("log")).findByText("Budget answer")).toBeInTheDocument();
    await waitFor(() => expect(budgetTab).toHaveAttribute("aria-selected", "true"));
    await waitFor(() => expect(api.watchThread).toHaveBeenLastCalledWith("finance", "s1", expect.any(Function), expect.any(Function)));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("byfinity.lastThreads") || "{}")).toMatchObject({ finance: "s1" }));
    act(() => streamListener?.({ type: "delta", bot: "finance", threadId: "s1", text: " live" }));
    expect(await within(screen.getByRole("log")).findByText("Budget answer live")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Update budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.sendThreadMessage).toHaveBeenCalledWith("finance", "s1", "Update budget"));

    fireEvent.click(screen.getByRole("button", { name: "Rename thread" }));
    fireEvent.change(screen.getByLabelText("Thread title"), { target: { value: "Updated budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(api.renameThread).toHaveBeenCalledWith("finance", "s1", "Updated budget"));

    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    await waitFor(() => expect(api.createThread).toHaveBeenCalledWith("finance"));
  });

  it("opens a conversation at its latest message", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(240);
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, sessions: 1, apiCalls: 1, periodDays: 30, cacheReadTokens: 0, byModel: [] }),
      createBot: vi.fn(), deleteBot: vi.fn(),
      getConversation: vi.fn().mockResolvedValue({
        bot: "finance",
        sessionId: "s1",
        running: false,
        messages: [
          { role: "assistant" as const, text: "First answer" },
          { role: "user" as const, text: "Latest question" },
          { role: "assistant" as const, text: "Latest answer" }
        ]
      })
    };
    renderApp(api, "en");

    fireEvent.click(await screen.findByText("finance"));
    const log = await screen.findByRole("log");
    expect(await within(log).findByText("Latest answer")).toBeInTheDocument();
    await waitFor(() => expect(log.scrollTop).toBe(900));
  });

  it("replies to a specific message with visible context sent to Hermes", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, sessions: 0, apiCalls: 0, periodDays: 30, cacheReadTokens: 0, byModel: [] }),
      createBot: vi.fn(),
      deleteBot: vi.fn(),
      getConversation: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: false, messages: [{ role: "assistant", text: "Comment puis-je aider ?" }] }),
      sendMessage: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: true, messages: [] })
    };
    renderApp(api);

    fireEvent.click(await screen.findByText("finance"));
    fireEvent.click(await screen.findByRole("button", { name: "Répondre au message de finance" }));
    expect(screen.getByText("Réponse à finance")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Prépare le rapport" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith(
      "finance",
      "> **En réponse à finance**\n> Comment puis-je aider ?\n\nPrépare le rapport"
    ));
  });

  it("identifies an assistant error and retries the previous user message", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, sessions: 0, apiCalls: 0, periodDays: 30, cacheReadTokens: 0, byModel: [] }),
      createBot: vi.fn(),
      deleteBot: vi.fn(),
      getConversation: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: false, messages: [{ role: "user", text: "Prépare le rapport" }, { role: "assistant", text: "Error: service unavailable" }] }),
      sendMessage: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: true, messages: [] })
    };
    renderApp(api);

    fireEvent.click(await screen.findByText("finance"));
    expect(await screen.findByText("Message d’erreur")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));

    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith("finance", "Prépare le rapport"));
  });

  it("uses the typed Hermes reason to avoid retrying an authentication failure", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, sessions: 0, apiCalls: 0, periodDays: 30, cacheReadTokens: 0, byModel: [] }),
      createBot: vi.fn(), deleteBot: vi.fn(),
      getConversation: vi.fn().mockResolvedValue({
        bot: "finance", sessionId: "s1", running: false,
        messages: [{ role: "user", text: "Prépare le rapport" }, { role: "assistant", text: "", failure: { reason: "provider_auth_or_access", title: "Connexion au fournisseur requise", detail: "401 invalid API key", hint: "Reconnectez ce profil à son fournisseur dans Hermes.", retryable: false, action: "configure" } }]
      }),
      sendMessage: vi.fn()
    };
    renderApp(api);

    fireEvent.click(await screen.findByText("finance"));
    expect(await screen.findByText("Connexion au fournisseur requise")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configurer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();
    expect(screen.getByText("Reconnectez ce profil à son fournisseur dans Hermes.")).toBeInTheDocument();
  });

  it("creates a persistent Hermes routine and opens its run history", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const routine = { id: "job-1", bot: "finance", name: "Rapport", prompt: "Prépare le rapport", schedule: "0 9 * * *", scheduleDisplay: "Tous les jours à 09:00", enabled: true, state: "scheduled" };
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, inputTokens: 0, outputTokens: 0, sessions: 0, apiCalls: 0 }),
      createBot: vi.fn(), deleteBot: vi.fn(),
      listRoutines: vi.fn().mockResolvedValue([]),
      createRoutine: vi.fn().mockResolvedValue(routine),
      setRoutineEnabled: vi.fn(), runRoutine: vi.fn().mockResolvedValue({ ...routine, lastStatus: "success" }), deleteRoutine: vi.fn(),
      listRoutineRuns: vi.fn().mockResolvedValue([{ id: "run-1", startedAt: 1, endedAt: 2, status: "success" as const, output: "Rapport terminé." }])
    };
    renderApp(api);

    fireEvent.click(await screen.findByText("finance"));
    fireEvent.click(screen.getByRole("button", { name: "Routines" }));
    fireEvent.click(await screen.findByRole("button", { name: "Créer une routine" }));
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Rapport" } });
    fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "Prépare le rapport" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer la routine" }));

    await waitFor(() => expect(api.createRoutine).toHaveBeenCalledWith("finance", { name: "Rapport", prompt: "Prépare le rapport", schedule: "0 9 * * *" }));
    fireEvent.click(await screen.findByRole("button", { name: "Exécuter" }));
    expect(confirm).toHaveBeenCalledWith("Exécuter maintenant la routine « Rapport » avec les accès actuels de ce Bot ?");
    await waitFor(() => expect(api.runRoutine).toHaveBeenCalledWith("finance", "job-1"));
    fireEvent.click(await screen.findByRole("button", { name: /Historique/ }));
    expect(await screen.findByText("Rapport terminé.")).toBeInTheDocument();
  });

  it("applies viewer UX, shows peer machines, and keeps model usage cost-free", async () => {
    const api = {
      getAccess: vi.fn().mockResolvedValue({ role: "viewer" as const }),
      listMachines: vi.fn().mockResolvedValue([
        { id: "local", name: "Cet appareil", kind: "local" as const, status: "connected" as const },
        { id: "studio", name: "studio", url: "http://studio.lan:8377", kind: "peer" as const, status: "configured" as const }
      ]),
      listBots: vi.fn().mockResolvedValue([{ name: "finance", machine: "local", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 1500, estimatedCostUsd: 0.12, actualCostUsd: 0, inputTokens: 1000, outputTokens: 500, sessions: 2, apiCalls: 3, byModel: [{ model: "gpt-5.6-terra", inputTokens: 1000, outputTokens: 500, estimatedCostUsd: 0.12 }] }),
      getConversation: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: false, messages: [] }),
      createBot: vi.fn(), deleteBot: vi.fn(), sendMessage: vi.fn()
    };
    renderApp(api);

    expect(await screen.findByText("Lecture seule", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Accès en lecture seule");
    expect(screen.queryByRole("button", { name: "Nouveau Bot" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Réglages" }));
    expect(await screen.findByRole("dialog", { name: "Réglages" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hermes" }));
    expect(screen.getByText("studio")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Utilisation" }));
    expect(await screen.findByRole("region", { name: "Utilisation par modèle" })).toHaveTextContent("gpt-5.6-terra");
    expect(screen.getByRole("region", { name: "Utilisation par modèle" })).toHaveTextContent(/1\s?500 jetons/);
    expect(screen.queryByText(/\$US|0,12/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fermer les réglages" }));
    fireEvent.click(await screen.findByText("finance"));
    expect(await screen.findByLabelText("Message")).toBeDisabled();
  });

  it("imports and exports Hermes Bots from the Data settings", async () => {
    const archiveBlob = new Blob([new Uint8Array([0x1f, 0x8b, 1])], { type: "application/gzip" });
    const archiveFile = new File([archiveBlob], "research.tar.gz", { type: "application/gzip" });
    const createObjectURL = vi.fn().mockReturnValue("blob:finance");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", title: "Finance", system: false }]),
      getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      exportBot: vi.fn().mockResolvedValue({ blob: archiveBlob, filename: "finance.tar.gz" }),
      importBot: vi.fn().mockResolvedValue({ name: "research-copy", title: "Research", system: false })
    };
    renderApp(api);

    await screen.findByText("Finance");
    fireEvent.click(screen.getByRole("button", { name: "Réglages" }));
    fireEvent.click(await screen.findByRole("button", { name: "Données" }));
    fireEvent.click(screen.getByRole("button", { name: "Télécharger l’archive" }));
    await waitFor(() => expect(api.exportBot).toHaveBeenCalledWith("finance"));
    expect(createObjectURL).toHaveBeenCalledWith(archiveBlob);

    fireEvent.change(screen.getByLabelText("Archive Hermes"), { target: { files: [archiveFile] } });
    fireEvent.change(screen.getByLabelText("Nouveau nom technique"), { target: { value: "research-copy" } });
    fireEvent.click(screen.getByRole("button", { name: "Importer le Bot" }));

    await waitFor(() => expect(api.importBot).toHaveBeenCalledWith(archiveFile, "research-copy"));
    expect(await screen.findByRole("status")).toHaveTextContent("Research a été importé.");
  });

  it("previews the exact sanitized diagnostics report before download", async () => {
    const report = {
      schemaVersion: 1,
      generatedAt: "2026-09-03T12:00:00.000Z",
      application: { name: "ByBots", version: "0.2.0" },
      runtime: { platform: "linux", architecture: "x64" },
      connection: { target: "remote" as const, transport: "https" as const, secure: true },
      support: { hermes: "0.21.x" },
      checks: {
        bridge: { status: "ready" as const, version: "0.2.0" },
        hermes: { status: "ready" as const, version: "0.21.4", compatible: true },
        authentication: { status: "ready" as const }
      },
      privacy: { excluded: ["authentication credentials and headers", "gateway host, port, path, query, and fragment", "Bot names, conversations, files, and user content"] }
    };
    const createObjectURL = vi.fn().mockReturnValue("blob:diagnostics");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const api = {
      listBots: vi.fn().mockResolvedValue([]), getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      getDiagnosticsReport: vi.fn().mockResolvedValue(report)
    };
    renderApp(api);

    fireEvent.click(screen.getByRole("button", { name: "Réglages" }));
    fireEvent.click(await screen.findByRole("button", { name: "Données" }));
    expect(api.getDiagnosticsReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Préparer l’aperçu" }));

    const preview = await screen.findByLabelText("Aperçu du rapport de diagnostic");
    expect(preview).toHaveTextContent('"target": "remote"');
    expect(preview).not.toHaveTextContent("baseUrl");
    fireEvent.click(screen.getByRole("button", { name: "Télécharger le diagnostic" }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(await screen.findByRole("status")).toHaveTextContent("Rapport de diagnostic téléchargé.");
  });

  it("tests and switches to a remote Hermes gateway from Settings", async () => {
    const local = { baseUrl: "http://127.0.0.1:9120", defaultBaseUrl: "http://127.0.0.1:9120", hasToken: true, secure: true, source: "environment" as const };
    const remote = { ...local, baseUrl: "https://hermes.example.test", source: "saved" as const, version: "0.21.4" };
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      getHermesConnection: vi.fn().mockResolvedValue(local),
      testHermesConnection: vi.fn().mockResolvedValue({ baseUrl: remote.baseUrl, secure: true, version: "0.21.4" }),
      updateHermesConnection: vi.fn().mockResolvedValue(remote),
      resetHermesConnection: vi.fn().mockResolvedValue(local)
    };
    renderApp(api, "en");

    await screen.findByText("finance");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hermes" }));
    fireEvent.click(await screen.findByRole("button", { name: /Remote Hermes/ }));
    const url = await screen.findByLabelText("Gateway URL");
    fireEvent.change(url, { target: { value: remote.baseUrl } });
    fireEvent.change(screen.getByLabelText("Hermes session token"), { target: { value: "remote-session" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Connection successful · Hermes 0.21.4");
    fireEvent.click(screen.getByRole("button", { name: "Save and connect" }));

    await waitFor(() => expect(api.updateHermesConnection).toHaveBeenCalledWith({ baseUrl: remote.baseUrl, token: "remote-session" }));
    expect(api.listBots).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Gateway URL")).toHaveValue(remote.baseUrl);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Local Hermes/ })).toBeInTheDocument();
  });

  it("keeps a failed message in the composer and offers an inline retry", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, sessions: 0, apiCalls: 0, periodDays: 30, cacheReadTokens: 0, byModel: [] }),
      createBot: vi.fn(),
      deleteBot: vi.fn(),
      getConversation: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: false, messages: [] }),
      sendMessage: vi.fn()
        .mockRejectedValueOnce(new Error("Hermes indisponible"))
        .mockResolvedValue({ bot: "finance", sessionId: "s1", running: true, messages: [] })
    };
    renderApp(api);

    fireEvent.click(await screen.findByText("finance"));
    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "Prépare le rapport" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await screen.findByText("Hermes a rencontré une erreur")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("Prépare le rapport");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(2));
  });

  it("refreshes a running conversation until the assistant completes", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, sessions: 0, apiCalls: 0, periodDays: 30, cacheReadTokens: 0, byModel: [] }),
      createBot: vi.fn(),
      deleteBot: vi.fn(),
      getConversation: vi.fn()
        .mockResolvedValueOnce({ bot: "finance", sessionId: "s1", running: false, messages: [] })
        .mockResolvedValueOnce({ bot: "finance", sessionId: "s1", running: true, messages: [{ role: "user", text: "Rapport" }] })
        .mockResolvedValue({ bot: "finance", sessionId: "s1", running: false, messages: [{ role: "user", text: "Rapport" }, { role: "assistant", text: "Rapport prêt" }] }),
      sendMessage: vi.fn().mockResolvedValue({ bot: "finance", sessionId: "s1", running: true, messages: [{ role: "user", text: "Rapport" }] })
    };
    renderApp(api);

    fireEvent.click(await screen.findByText("finance"));
    await screen.findByText("Commencez la conversation avec ce Bot.");
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Rapport" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await within(screen.getByRole("log")).findByText("Rapport prêt", undefined, { timeout: 2_500 })).toBeInTheDocument();
    expect(api.getConversation).toHaveBeenCalledTimes(3);
  });

  it("lets the user choose and persist a Hermes avatar", async () => {
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "analyst", system: false, avatar: { shape: "blobatar" } }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "analyst", totalTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, inputTokens: 0, outputTokens: 0, sessions: 0, apiCalls: 0 }),
      createBot: vi.fn(),
      deleteBot: vi.fn(),
      updateBotAvatar: vi.fn().mockResolvedValue(undefined)
    };
    renderApp(api);

    fireEvent.click(await screen.findByRole("button", { name: /analyst/i }));
    fireEvent.click(screen.getByRole("button", { name: "Afficher les détails" }));
    fireEvent.click(await screen.findByRole("button", { name: "Modifier l’avatar de analyst" }));
    fireEvent.click(screen.getByRole("button", { name: "nuage" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l’avatar" }));

    await waitFor(() => expect(api.updateBotAvatar).toHaveBeenCalledWith("analyst", { shape: "blobatar::cloud" }));
  });

  it("edits a Bot identity, model, SOUL and least-privilege capabilities", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false, title: "Finance", description: "Budgets" }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, inputTokens: 0, outputTokens: 0, sessions: 0, apiCalls: 0 }),
      createBot: vi.fn(), deleteBot: vi.fn(),
      getBotConfiguration: vi.fn().mockResolvedValue({
        bot: "finance", provider: "openai-codex", model: "gpt-5.6-terra", soul: "Reste factuel.",
        skills: [{ name: "spreadsheets", enabled: true }, { name: "email", enabled: true }],
        toolsets: [{ name: "file", enabled: true }, { name: "terminal", enabled: true }],
        mcpServers: [{ name: "neon", enabled: true }],
        providers: [{ slug: "openai-codex", name: "OpenAI Codex", models: ["gpt-5.6-terra", "gpt-5.6-sol"] }]
      }),
      updateBot: vi.fn().mockResolvedValue({ applied: { model: true, skills: true }, confirmRequired: false })
    };
    renderApp(api);

    fireEvent.click(await screen.findByText("Finance"));
    fireEvent.click(screen.getByRole("button", { name: "Afficher les détails" }));
    fireEvent.click(screen.getByRole("button", { name: "Configurer finance" }));
    expect(await screen.findByRole("dialog", { name: "Configurer Finance" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Titre affiché"), { target: { value: "Direction financière" } });
    expect(screen.getByText("1 section de configuration modifiée.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(confirm).toHaveBeenCalledWith("Abandonner les modifications non enregistrées du Bot ?");
    expect(screen.getByRole("dialog", { name: "Configurer Finance" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Accès/ }));
    fireEvent.click(await screen.findByLabelText("email"));
    fireEvent.keyDown(screen.getByRole("tab", { name: /Compétences/ }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Outils/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByLabelText("terminal"));
    fireEvent.keyDown(screen.getByRole("tab", { name: /Accès/ }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Instructions/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.change(screen.getByLabelText("SOUL.md"), { target: { value: "Valide chaque montant." } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(api.updateBot).toHaveBeenCalledWith("finance", expect.objectContaining({
      title: "Direction financière",
      soul: "Valide chaque montant.",
      disabledSkills: ["email"],
      enabledToolsets: ["file"],
      enabledMcpServers: ["neon"]
    })));
    expect(screen.queryByRole("heading", { name: "Configurer Finance" })).not.toBeInTheDocument();
  });

  it("opens a group discussion and sends one turn to its Bots", async () => {
    const group = {
      id: "room-1",
      name: "Direction",
      members: ["finance", "ops"],
      messages: [{ id: "m1", author: "finance", authorKind: "bot" as const, text: "## Recommandation\n\n@user, validez avec @ops.", at: 1 }],
      running: false
    };
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }, { name: "ops", title: "Opérations", system: false }]),
      getUsage: vi.fn().mockResolvedValue({ bot: "finance", totalTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, inputTokens: 0, outputTokens: 0, sessions: 0, apiCalls: 0 }),
      createBot: vi.fn(),
      deleteBot: vi.fn(),
      listGroups: vi.fn().mockResolvedValue([group]),
      sendGroupMessage: vi.fn().mockResolvedValue({ ...group, running: true, turn: "finance", protocol: { status: "running", round: 1, maxRounds: 3, posted: 0, maxMessages: 10 }, messages: [...group.messages, { id: "m2", author: "user", authorKind: "user", text: "Consultez-vous", at: 2 }] }),
      stopGroup: vi.fn().mockResolvedValue({ ...group, running: false, protocol: { status: "stopped", round: 0, maxRounds: 3, posted: 0, maxMessages: 10 } })
    };
    window.localStorage.setItem("byfinity.preferences", JSON.stringify({ displayName: "Ruben" }));
    renderApp(api);

    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir le groupe Direction" }));
    expect(await screen.findByRole("heading", { name: "Recommandation" })).toBeInTheDocument();
    expect(screen.getByText("@Ruben")).toHaveClass("message-mention-user");
    expect(screen.getByText("Ruben", { selector: ".account-row strong" })).toBeInTheDocument();
    expect(screen.getByText("@Opérations")).toHaveClass("message-mention-bot");
    fireEvent.change(screen.getByLabelText("Message au groupe"), { target: { value: "Consultez-vous" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer au groupe" }));

    await waitFor(() => expect(api.sendGroupMessage).toHaveBeenCalledWith("room-1", "Consultez-vous"));
    expect(await screen.findByText("Consultez-vous")).toBeInTheDocument();
    expect(screen.getByText("finance travaille · tour 1/3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Arrêter" }));
    await waitFor(() => expect(api.stopGroup).toHaveBeenCalledWith("room-1"));
    expect(await screen.findByText("Discussion interrompue.")).toBeInTheDocument();
  });

  it("navigates group mention suggestions from the composer keyboard", async () => {
    const group = { id: "room-1", name: "Direction", members: ["finance", "ops"], messages: [], running: false };
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", displayName: "Finance", system: false }, { name: "ops", displayName: "Opérations", system: false }]),
      getUsage: vi.fn(), createBot: vi.fn(), deleteBot: vi.fn(),
      listGroups: vi.fn().mockResolvedValue([group]),
      sendGroupMessage: vi.fn().mockResolvedValue({ ...group, running: true })
    };
    renderApp(api);

    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir le groupe Direction" }));
    const input = screen.getByLabelText("Message au groupe");
    fireEvent.change(input, { target: { value: "@" } });
    const financeOption = await screen.findByRole("option", { name: /@finance/ });
    const opsOption = screen.getByRole("option", { name: /@ops/ });
    expect(financeOption).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", financeOption.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(opsOption).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", opsOption.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("@ops ");
    fireEvent.change(input, { target: { value: "@ops vérifie le budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer au groupe" }));

    await waitFor(() => expect(api.sendGroupMessage).toHaveBeenCalledWith("room-1", "@ops vérifie le budget"));
  });

  it("creates a group discussion from 2 to 6 selected Bots", async () => {
    const group = {
      id: "room-2",
      name: "Sprint",
      members: ["finance", "ops"],
      messages: [],
      running: false
    };
    const api = {
      listBots: vi.fn().mockResolvedValue([{ name: "finance", system: false }, { name: "ops", system: false }, { name: "sales", system: false }]),
      getUsage: vi.fn(),
      createBot: vi.fn(),
      deleteBot: vi.fn(),
      listGroups: vi.fn().mockResolvedValue([]),
      createGroup: vi.fn().mockResolvedValue(group),
      sendGroupMessage: vi.fn()
    };
    renderApp(api);

    fireEvent.click(await screen.findByRole("button", { name: "Nouveau groupe" }));
    expect(screen.getByRole("dialog", { name: "Créer un groupe" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nom du groupe"), { target: { value: "Sprint" } });
    fireEvent.click(screen.getByLabelText(/^finance/));
    fireEvent.click(screen.getByLabelText(/^ops/));
    expect(screen.getByRole("note")).toHaveTextContent("Les accès sont combinés dans ce groupe");
    fireEvent.click(screen.getByRole("button", { name: "Créer le groupe" }));

    await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith("Sprint", ["finance", "ops"]));
    expect(await screen.findByRole("button", { name: "Ouvrir le groupe Sprint" })).toBeInTheDocument();
  });

  it("polls a running group and renders each Bot message with that Bot avatar", async () => {
    const running = {
      id: "room-1",
      name: "Direction",
      members: ["finance", "ops"],
      messages: [{ id: "m1", author: "user", authorKind: "user" as const, text: "Consultez-vous", at: 1 }],
      running: true
    };
    const complete = {
      ...running,
      running: false,
      messages: [
        ...running.messages,
        { id: "m2", author: "finance", authorKind: "bot" as const, text: "| Decision | OK |\n| --- | --- |\n| Budget | Oui |", at: 2 },
        { id: "m3", author: "ops", authorKind: "bot" as const, text: "Planning confirme.", at: 3 }
      ]
    };
    const api = {
      listBots: vi.fn().mockResolvedValue([
        { name: "finance", system: false, avatar: { image: "data:image/png;base64,finance" } },
        { name: "ops", system: false, avatar: { image: "data:image/png;base64,ops" } }
      ]),
      getUsage: vi.fn(),
      createBot: vi.fn(),
      deleteBot: vi.fn(),
      listGroups: vi.fn().mockResolvedValueOnce([running]).mockResolvedValue([complete]),
      sendGroupMessage: vi.fn()
    };
    renderApp(api);

    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir le groupe Direction" }));

    expect(await within(screen.getByRole("log")).findByText("Planning confirme.")).toBeInTheDocument();
    expect(api.listGroups).toHaveBeenCalledTimes(2);
    const financeMessage = screen.getByText("Budget").closest("article");
    expect(financeMessage).not.toBeNull();
    expect(within(financeMessage!).getByRole("img", { name: "Avatar de finance" })).toHaveAttribute("src", "data:image/png;base64,finance");
  });
});
