import { useEffect, useState } from "react";
import { Accessibility, Archive, Check, Gauge, Globe2, Info, Keyboard, MonitorCog, PlugZap, RotateCcw, Search, Server, Settings, X } from "lucide-react";
import type { AccessRole, Bot, BotConfiguration, BotsApi, HermesMachine, McpServerTest } from "./App";
import { BotAvatar } from "./BotAvatar";
import { BotTransferPanel } from "./BotTransferPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { DiagnosticsExportPanel } from "./DiagnosticsExportPanel";
import { DialogShell } from "./Dialog";
import { FeedbackState } from "./FeedbackState";
import { FormField } from "./FormField";
import { HermesConnectionPanel } from "./HermesConnectionPanel";
import { IconButton } from "./IconButton";
import { LANGUAGE_OPTIONS, useI18n, type LanguagePreference } from "./i18n";
import { DEFAULT_PREFERENCES, type AppPreferences } from "./preferences";
import { SelectControl } from "./SelectControl";
import { SwitchControl, SwitchInput } from "./SwitchControl";
import { UsagePanel } from "./UsagePanel";
import { getBotDisplayName } from "./botDisplayName";

type SettingsSection = "general" | "chat" | "usage" | "accessibility" | "hermes" | "mcp" | "data" | "about";

interface SettingsPanelProps {
  api: BotsApi;
  bots: Bot[];
  machines: HermesMachine[];
  role: AccessRole;
  preferences: AppPreferences;
  onPreferencesChange(preferences: AppPreferences): void;
  onBotImported(bot: Bot): void;
  onGatewayChanged(): void | Promise<void>;
  onClose(): void;
}

const sectionIcons = {
  general: MonitorCog,
  chat: Keyboard,
  usage: Gauge,
  accessibility: Accessibility,
  hermes: Server,
  mcp: PlugZap,
  data: Archive,
  about: Info
} satisfies Record<SettingsSection, typeof Settings>;

function enabledMcp(config: BotConfiguration | null) {
  return config?.mcpServers.filter((server) => server.enabled).map((server) => server.name) ?? [];
}

export function SettingsPanel({ api, bots, machines, role, preferences, onPreferencesChange, onBotImported, onGatewayChanged, onClose }: SettingsPanelProps) {
  const { languagePreference, setLanguage, t, formatError } = useI18n();
  const [section, setSection] = useState<SettingsSection>("general");
  const [mcpBot, setMcpBot] = useState(bots[0]?.name || "");
  const [mcpConfig, setMcpConfig] = useState<BotConfiguration | null>(null);
  const [mcpSearch, setMcpSearch] = useState("");
  const [mcpFilter, setMcpFilter] = useState<"all" | "enabled" | "ready">("all");
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpSaving, setMcpSaving] = useState("");
  const [mcpError, setMcpError] = useState("");
  const [mcpTest, setMcpTest] = useState<McpServerTest | null>(null);
  const canManageMcp = role === "admin" && Boolean(api.getBotConfiguration && api.updateBot);
  const visibleMcpServers = (mcpConfig?.mcpServers ?? []).filter((server) => {
    const matchesSearch = !mcpSearch.trim() || `${server.name} ${server.description || ""}`.toLocaleLowerCase().includes(mcpSearch.trim().toLocaleLowerCase());
    if (!matchesSearch) return false;
    if (mcpFilter === "enabled") return server.enabled;
    if (mcpFilter === "ready") return !(server.fromCatalog && server.installed === false);
    return true;
  });

  useEffect(() => {
    if (section !== "mcp" || !mcpBot || !api.getBotConfiguration) return;
    let active = true;
    setMcpLoading(true);
    setMcpError("");
    setMcpTest(null);
    setMcpConfig(null);
    api.getBotConfiguration(mcpBot)
      .then((config) => active && setMcpConfig(config))
      .catch((cause) => active && setMcpError(formatError(cause)))
      .finally(() => active && setMcpLoading(false));
    return () => { active = false; };
  }, [api, formatError, mcpBot, section]);

  useEffect(() => {
    if (!bots.some((bot) => bot.name === mcpBot)) setMcpBot(bots[0]?.name || "");
  }, [bots, mcpBot]);

  function patchPreferences(patch: Partial<AppPreferences>) {
    onPreferencesChange({ ...preferences, ...patch });
  }

  async function setDesktopNotifications(enabled: boolean) {
    if (!enabled) {
      patchPreferences({ desktopNotifications: false });
      return;
    }
    if (typeof Notification === "undefined") return;
    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    patchPreferences({ desktopNotifications: permission === "granted" });
  }

  async function toggleMcp(name: string) {
    if (!mcpConfig || !api.updateBot || !canManageMcp) return;
    const current = enabledMcp(mcpConfig);
    const next = current.includes(name) ? current.filter((item) => item !== name) : [...current, name];
    setMcpSaving(name);
    setMcpError("");
    setMcpTest(null);
    try {
      if (!current.includes(name) && api.testMcpServer) {
        setMcpTest(await api.testMcpServer(mcpBot, name));
      }
      const result = await api.updateBot(mcpBot, { enabledMcpServers: next });
      const failed = Object.entries(result.applied).some(([, applied]) => !applied);
      if (failed) throw new Error(t("Hermes did not save the MCP configuration."));
      setMcpConfig({
        ...mcpConfig,
        mcpServers: mcpConfig.mcpServers.map((server) => ({ ...server, enabled: next.includes(server.name) }))
      });
    } catch (cause) {
      setMcpError(formatError(cause));
    } finally {
      setMcpSaving("");
    }
  }

  const sections: Array<{ id: SettingsSection; label: string }> = [
    { id: "general", label: t("General") },
    { id: "chat", label: t("Chat") },
    { id: "usage", label: t("Usage") },
    { id: "accessibility", label: t("Accessibility") },
    { id: "hermes", label: "Hermes" },
    { id: "mcp", label: "MCP" },
    { id: "data", label: t("Data") },
    { id: "about", label: t("About") }
  ];

  return <DialogShell variant="panel" backdropClassName="settings-backdrop" className="settings-panel" ariaLabelledBy="settings-title" onClose={onClose}>
      <header className="settings-header">
        <div><span className="settings-mark"><Settings size={18} /></span><div><h2 id="settings-title">{t("Settings")}</h2><p>{t("Application, Hermes, and integration preferences")}</p></div></div>
        <IconButton label={t("Close settings")} onClick={onClose}><X size={19} /></IconButton>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("Settings sections")}>{sections.map(({ id, label }) => {
          const Icon = sectionIcons[id];
          return <button key={id} type="button" className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}><Icon size={17} /><span>{label}</span></button>;
        })}</nav>

        <div className="settings-content">
          {section === "general" && <section aria-labelledby="settings-general">
            <div className="settings-section-heading"><h3 id="settings-general">{t("General")}</h3><p>{t("Choose how ByBots looks and speaks.")}</p></div>
            <div className="setting-card identity-setting"><div className="setting-copy"><span><strong>{t("Your display name")}</strong><small>{t("Used when Bots mention you in group conversations.")}</small></span></div><FormField label={t("Display name")}><input value={preferences.displayName} maxLength={80} onChange={(event) => patchPreferences({ displayName: event.target.value })} placeholder={t("e.g. Alex")} /></FormField></div>
            <div className="setting-card"><div className="setting-copy"><Globe2 size={18} /><span><strong>{t("Language")}</strong><small>{t("Applied immediately across the application.")}</small></span></div><SelectControl aria-label={t("Application language")} value={languagePreference} onChange={(event) => setLanguage(event.target.value as LanguagePreference)}>{LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value === "system" ? t(option.label) : option.label}</option>)}</SelectControl></div>
            <fieldset className="setting-group"><legend>{t("Interface density")}</legend><p>{t("Adjust spacing without reducing touch targets.")}</p><div className="choice-grid"><label className={preferences.density === "comfortable" ? "selected" : ""}><input type="radio" name="density" checked={preferences.density === "comfortable"} onChange={() => patchPreferences({ density: "comfortable" })} /><span><strong>{t("Comfortable")}</strong><small>{t("More breathing room")}</small></span>{preferences.density === "comfortable" && <Check size={16} />}</label><label className={preferences.density === "compact" ? "selected" : ""}><input type="radio" name="density" checked={preferences.density === "compact"} onChange={() => patchPreferences({ density: "compact" })} /><span><strong>{t("Compact")}</strong><small>{t("More content on screen")}</small></span>{preferences.density === "compact" && <Check size={16} />}</label></div></fieldset>
          </section>}

          {section === "chat" && <section aria-labelledby="settings-chat">
            <div className="settings-section-heading"><h3 id="settings-chat">{t("Chat")}</h3><p>{t("Control message composition.")}</p></div>
            <SwitchControl label={t("Send with Enter")} description={preferences.sendOnEnter ? t("Shift + Enter adds a new line.") : t("Ctrl or Command + Enter sends the message.")} checked={preferences.sendOnEnter} onChange={(event) => patchPreferences({ sendOnEnter: event.target.checked })} />
            <SwitchControl label={t("Completion notifications")} description={typeof Notification === "undefined" ? t("Notifications are unavailable in this browser.") : Notification.permission === "denied" ? t("Notifications are blocked in system settings.") : t("Notify me when a Bot finishes while ByBots is in the background.")} checked={preferences.desktopNotifications} disabled={typeof Notification === "undefined" || Notification.permission === "denied"} onChange={(event) => void setDesktopNotifications(event.target.checked)} />
          </section>}

          {section === "usage" && <UsagePanel api={api} bots={bots} preferences={preferences} onPreferencesChange={onPreferencesChange} />}

          {section === "accessibility" && <section aria-labelledby="settings-accessibility">
            <div className="settings-section-heading"><h3 id="settings-accessibility">{t("Accessibility")}</h3><p>{t("Make movement and interaction more comfortable.")}</p></div>
            <SwitchControl label={t("Reduce motion")} description={t("Disable decorative animations and transitions.")} checked={preferences.reduceMotion} onChange={(event) => patchPreferences({ reduceMotion: event.target.checked })} />
            <FeedbackState tone="note" icon={<Accessibility size={18} />}>{t("Keyboard focus remains visible and interactive targets stay at least 44 pixels.")}</FeedbackState>
          </section>}

          {section === "hermes" && <section aria-labelledby="settings-hermes">
            <div className="settings-section-heading"><h3 id="settings-hermes">Hermes</h3><p>{t("Choose the Hermes gateway that orchestrates this application.")}</p></div>
            <DiagnosticsPanel api={api} />
            <HermesConnectionPanel api={api} role={role} onConnected={onGatewayChanged} />
            {machines.length > 0 && <><h4 className="settings-subheading">{t("Connected machines")}</h4><div className="machine-list settings-machines">{machines.map((machine) => <article key={machine.id}><span className={`machine-dot ${machine.status}`} /><div><strong>{t(machine.name)}</strong><small>{machine.kind === "local" ? t("Local runtime") : machine.url}</small></div><em>{machine.status === "connected" ? t("Connected") : machine.status === "needs_auth" ? t("Key required") : t("Configured")}</em></article>)}</div></>}
            {machines.length <= 1 && <p className="settings-help">{t("Remote peers are securely configured from Hermes with {command}.", { command: "hermes peer add" })}</p>}
          </section>}

          {section === "mcp" && <section aria-labelledby="settings-mcp">
            <div className="settings-section-heading"><h3 id="settings-mcp">{t("MCP servers")}</h3><p>{t("Enable installed integrations for each Hermes Bot.")}</p></div>
            {!api.getBotConfiguration ? <FeedbackState tone="unavailable" icon={<PlugZap size={20} />} title={t("MCP management unavailable")}>{t("Connect the Hermes gateway to inspect MCP servers.")}</FeedbackState> : <>
              {bots.length === 0 ? <FeedbackState tone="unavailable" icon={<PlugZap size={20} />} title={t("No Bot available")}>{t("Create a Bot before assigning MCP integrations.")}</FeedbackState> : <label className="mcp-bot-picker"><span>{t("Configure integrations for")}</span><SelectControl value={mcpBot} onChange={(event) => setMcpBot(event.target.value)}>{bots.map((bot) => <option key={bot.name} value={bot.name}>{getBotDisplayName(bot)}</option>)}</SelectControl></label>}
              {mcpLoading && <FeedbackState tone="loading">{t("Loading MCP servers…")}</FeedbackState>}
              {!mcpLoading && mcpConfig && <><div className="mcp-toolbar"><label className="mcp-search"><Search size={15} /><span className="sr-only">{t("Filter MCP servers")}</span><input aria-label={t("Filter MCP servers")} value={mcpSearch} onChange={(event) => setMcpSearch(event.target.value)} placeholder={t("Filter MCP servers")} /></label><SelectControl aria-label={t("MCP server filter")} value={mcpFilter} onChange={(event) => setMcpFilter(event.target.value as "all" | "enabled" | "ready")}><option value="all">{t("All servers")}</option><option value="enabled">{t("Enabled")}</option><option value="ready">{t("Ready to use")}</option></SelectControl></div><p className="mcp-count">{t("{visible} of {total} servers", { visible: visibleMcpServers.length, total: mcpConfig.mcpServers.length })}</p><div className="mcp-settings-list">{visibleMcpServers.map((server) => {
                const requiresSetup = server.fromCatalog && server.installed === false;
                const disabled = !canManageMcp || requiresSetup || Boolean(mcpSaving);
                return <label key={server.name} className={`surface-card ${requiresSetup ? "needs-setup" : ""}`}><span className="mcp-icon"><PlugZap size={17} /></span><span><strong>{server.name}</strong><small>{server.description || (requiresSetup ? t("Setup required in Hermes") : t("Available to this Bot"))}</small></span>{server.toolCount ? <em>{t("{count} tools", { count: server.toolCount })}</em> : null}<SwitchInput aria-label={t("Enable {name}", { name: server.name })} checked={server.enabled} disabled={disabled} onChange={() => void toggleMcp(server.name)} /></label>;
              })}{mcpConfig.mcpServers.length === 0 && <FeedbackState tone="unavailable" icon={<PlugZap size={20} />} title={t("No MCP server found")}>{t("Install servers from Hermes, then return here to assign them to Bots.")}</FeedbackState>}{mcpConfig.mcpServers.length > 0 && visibleMcpServers.length === 0 && <FeedbackState tone="unavailable" icon={<Search size={20} />} title={t("No matching MCP server")}>{t("Change the search or filter to see more integrations.")}</FeedbackState>}</div></>}
              {mcpTest && <FeedbackState tone="note" icon={<Check size={18} />}>{t("{name} is ready · {count} tools available.", { name: mcpTest.server, count: mcpTest.toolCount })}</FeedbackState>}
              {role !== "admin" && <p className="settings-help">{t("Only administrators can change MCP access.")}</p>}
              {mcpError && <FeedbackState tone="error">{mcpError}</FeedbackState>}
            </>}
          </section>}

          {section === "data" && <section aria-labelledby="settings-data">
            <div className="settings-section-heading"><h3 id="settings-data">{t("Data")}</h3><p>{t("Manage portable Bot profiles and prepare privacy-safe diagnostics.")}</p></div>
            <BotTransferPanel api={api} bots={bots} role={role} onImported={onBotImported} />
            <DiagnosticsExportPanel api={api} />
          </section>}

          {section === "about" && <section aria-labelledby="settings-about">
            <div className="settings-section-heading"><h3 id="settings-about">{t("About")}</h3><p>{t("Open-source client for orchestrating Hermes Bots.")}</p></div>
            <div className="about-card"><span className="brand-mark">B</span><div><strong>ByBots</strong><small>Version {__APP_VERSION__}</small></div></div>
            <dl className="about-details"><div><dt>{t("Access level")}</dt><dd>{role === "admin" ? t("Administrator") : role === "operator" ? t("Operator") : t("Read only")}</dd></div><div><dt>{t("Runtime")}</dt><dd>Hermes 0.21</dd></div><div><dt>{t("Interface languages")}</dt><dd>English, Français</dd></div></dl>
          </section>}
        </div>
      </div>

      <footer className="settings-footer"><button type="button" onClick={() => { onPreferencesChange(DEFAULT_PREFERENCES); setLanguage("system"); }}><RotateCcw size={16} />{t("Reset local preferences")}</button><button className="primary" type="button" onClick={onClose}>{t("Done")}</button></footer>
  </DialogShell>;
}
