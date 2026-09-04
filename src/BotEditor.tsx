import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Cpu, FileText, IdCard, RotateCcw, Search, ShieldCheck, X } from "lucide-react";
import type { Bot, BotCapability, BotConfiguration, BotsApi, BotUpdateInput } from "./App";
import { BotAvatar } from "./BotAvatar";
import { getBotDisplayName } from "./botDisplayName";
import { DialogActions, DialogShell } from "./Dialog";
import { FeedbackState } from "./FeedbackState";
import { FormField } from "./FormField";
import { IconButton } from "./IconButton";
import { useI18n } from "./i18n";
import { SelectControl } from "./SelectControl";
import { TextareaControl } from "./TextareaControl";

interface BotEditorProps {
  api: BotsApi;
  bot: Bot;
  onClose(): void;
  onSaved(bot: Bot): void;
}

type EditorSection = "identity" | "model" | "access" | "instructions";
type CapabilityKind = "skills" | "toolsets" | "mcp";
const CAPABILITY_KINDS: CapabilityKind[] = ["skills", "toolsets", "mcp"];

function enabledNames(items: BotCapability[]) {
  return items.filter((item) => item.enabled).map((item) => item.name);
}

function sameNames(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((name) => expected.has(name));
}

function needsSetup(item: BotCapability) {
  return item.fromCatalog && !item.installed && ((item.requires?.length ?? 0) > 0 || item.auth?.toLowerCase() === "oauth");
}

function CapabilityList({ items, selected, onToggle }: { items: BotCapability[]; selected: string[]; onToggle(name: string): void }) {
  const { t } = useI18n();
  if (!items.length) return <p className="capability-empty">{t("No matching item.")}</p>;

  return <div className="capability-list">
    {items.map((item) => {
      const unavailable = needsSetup(item);
      return <label key={item.name} className={unavailable ? "disabled" : ""}>
        <input type="checkbox" checked={selected.includes(item.name)} disabled={unavailable} onChange={() => onToggle(item.name)} />
        <span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}{unavailable && <small>{t("Setup required in Hermes")}</small>}</span>
        {item.toolCount ? <em aria-label={t("{count} tools", { count: item.toolCount })}>{item.toolCount}</em> : null}
      </label>;
    })}
  </div>;
}

export function BotEditor({ api, bot, onClose, onSaved }: BotEditorProps) {
  const { locale, t, formatError } = useI18n();
  const [config, setConfig] = useState<BotConfiguration | null>(null);
  const [title, setTitle] = useState(bot.title || "");
  const [description, setDescription] = useState(bot.description || "");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [soul, setSoul] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [toolsets, setToolsets] = useState<string[]>([]);
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  const [section, setSection] = useState<EditorSection>("identity");
  const [capabilityKind, setCapabilityKind] = useState<CapabilityKind>("skills");
  const [capabilityFilter, setCapabilityFilter] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!api.getBotConfiguration) return;
    setError("");
    api.getBotConfiguration(bot.name).then((next) => {
      if (!active) return;
      setConfig(next);
      setProvider(next.provider);
      setModel(next.model);
      setSoul(next.soul);
      setSkills(enabledNames(next.skills));
      setToolsets(enabledNames(next.toolsets));
      setMcpServers(enabledNames(next.mcpServers));
    }).catch((cause) => active && setError(String(cause)));
    return () => { active = false; };
  }, [api, bot.name, loadAttempt]);

  const providerOptions = config?.providers ?? [];
  const currentProvider = providerOptions.find((item) => item.slug === provider);
  const modelOptions = currentProvider?.models ?? [];
  const toolsetSelectionInvalid = Boolean(config?.toolsets.length && toolsets.length === 0);
  const canSave = Boolean(config && !saving && !toolsetSelectionInvalid && (provider && model || !provider && !model));
  const selectionSummary = config
    ? t("{skills} skills · {tools} tools · {mcp} MCP", { skills: skills.length, tools: toolsets.length, mcp: mcpServers.length })
    : t("Loading capabilities…");
  const changedSections = config ? [
    title !== (bot.title || "") || description !== (bot.description || "") ? "identity" : "",
    provider !== config.provider || model !== config.model ? "model" : "",
    !sameNames(skills, enabledNames(config.skills)) || !sameNames(toolsets, enabledNames(config.toolsets)) || !sameNames(mcpServers, enabledNames(config.mcpServers)) ? "access" : "",
    soul !== config.soul ? "instructions" : ""
  ].filter(Boolean) : [];
  const isDirty = changedSections.length > 0;

  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  function requestClose() {
    if (isDirty && !window.confirm(t("Discard the unsaved Bot changes?"))) return;
    onClose();
  }

  const sections = [
    { id: "identity" as const, label: t("Identity"), detail: t("Mission and display"), icon: IdCard },
    { id: "model" as const, label: t("Model"), detail: provider && model ? model : t("Automatic model"), icon: Cpu },
    { id: "access" as const, label: t("Access"), detail: selectionSummary, icon: ShieldCheck },
    { id: "instructions" as const, label: t("Instructions"), detail: t("Behavior and boundaries"), icon: FileText }
  ];

  const capabilityGroups = config ? {
    skills: { label: t("Skills"), items: config.skills, selected: skills },
    toolsets: { label: t("Tools"), items: config.toolsets, selected: toolsets },
    mcp: { label: t("MCP servers"), items: config.mcpServers, selected: mcpServers }
  } : null;
  const activeCapabilities = capabilityGroups?.[capabilityKind];
  const visibleCapabilities = useMemo(() => {
    if (!activeCapabilities) return [];
    const normalized = capabilityFilter.trim().toLocaleLowerCase(locale);
    return activeCapabilities.items.filter((item) => {
      if (activeOnly && !activeCapabilities.selected.includes(item.name)) return false;
      return !normalized || `${item.name} ${item.description || ""}`.toLocaleLowerCase(locale).includes(normalized);
    });
  }, [activeCapabilities, activeOnly, capabilityFilter, locale]);

  function toggle(current: string[], name: string, setValue: (value: string[]) => void) {
    setValue(current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }

  function toggleCapability(name: string) {
    if (capabilityKind === "skills") toggle(skills, name, setSkills);
    if (capabilityKind === "toolsets") toggle(toolsets, name, setToolsets);
    if (capabilityKind === "mcp") toggle(mcpServers, name, setMcpServers);
  }

  function setVisibleCapabilities(enabled: boolean) {
    if (!activeCapabilities) return;
    const visibleNames = visibleCapabilities.filter((item) => !needsSetup(item)).map((item) => item.name);
    const next = enabled
      ? [...new Set([...activeCapabilities.selected, ...visibleNames])]
      : activeCapabilities.selected.filter((name) => !visibleNames.includes(name));
    if (capabilityKind === "skills") setSkills(next);
    if (capabilityKind === "toolsets") setToolsets(next);
    if (capabilityKind === "mcp") setMcpServers(next);
  }

  function changeProvider(next: string) {
    setProvider(next);
    if (!next) {
      setModel("");
      return;
    }
    const models = providerOptions.find((item) => item.slug === next)?.models ?? [];
    if (!models.includes(model)) setModel(models[0] || "");
  }

  function selectSection(next: EditorSection) {
    if (!config && next !== "identity") return;
    setSection(next);
  }

  function navigateSections(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!config || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + sections.length) % sections.length;
    const nextSection = sections[nextIndex].id;
    setSection(nextSection);
    window.requestAnimationFrame(() => document.getElementById(`bot-editor-tab-${nextSection}`)?.focus());
  }

  function navigateCapabilityTabs(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? CAPABILITY_KINDS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + CAPABILITY_KINDS.length) % CAPABILITY_KINDS.length;
    const nextKind = CAPABILITY_KINDS[nextIndex];
    setCapabilityKind(nextKind);
    setCapabilityFilter("");
    setActiveOnly(false);
    window.requestAnimationFrame(() => document.getElementById(`capability-tab-${nextKind}`)?.focus());
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!config || !api.updateBot || !canSave) return;
    setSaving(true);
    setError("");
    const input: BotUpdateInput = {
      title: title.trim(),
      description: description.trim(),
      provider,
      model,
      soul,
      disabledSkills: config.skills.filter((item) => !skills.includes(item.name)).map((item) => item.name),
      enabledToolsets: toolsets.length === config.toolsets.length ? [] : toolsets,
      enabledMcpServers: mcpServers
    };
    try {
      let result = await api.updateBot(bot.name, input);
      if (result.confirmRequired) {
        const accepted = window.confirm(result.confirmMessage || t("This model may cost more. Confirm this choice?"));
        if (!accepted) {
          setSaving(false);
          return;
        }
        result = await api.updateBot(bot.name, { provider, model, confirmExpensiveModel: true });
      }
      const failed = Object.entries(result.applied).filter(([, applied]) => !applied).map(([failedSection]) => failedSection);
      if (failed.length) throw new Error(t("Hermes did not save: {sections}", { sections: failed.join(", ") }));
      onSaved({ ...bot, title: title.trim(), description: description.trim() });
      onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  }

  return <DialogShell as="form" className="bot-editor" onSubmit={save} onClose={requestClose} ariaLabel={t("Configure {name}", { name: getBotDisplayName(bot) })}>
    <header className="editor-header">
      <BotAvatar bot={bot} size={46} />
      <div><small>{t("HERMES PROFILE")}</small><h2>{t("Configure {name}", { name: getBotDisplayName(bot) })}</h2><p>{config ? `${provider && model ? model : t("Automatic model")} · ${selectionSummary}` : t("Define its role and precisely limit its capabilities.")}</p></div>
      <IconButton className="editor-close" label={t("Close configuration")} onClick={requestClose}><X size={18} /></IconButton>
    </header>

    <nav className="editor-tabs" role="tablist" aria-label={t("Bot configuration sections")}>
      {sections.map(({ id, label, detail, icon: Icon }, index) => <button key={id} id={`bot-editor-tab-${id}`} type="button" role="tab" aria-selected={section === id} aria-controls={`bot-editor-panel-${id}`} tabIndex={section === id ? 0 : -1} disabled={!config && id !== "identity"} onClick={() => selectSection(id)} onKeyDown={(event) => navigateSections(event, index)}><Icon size={17} /><span><strong>{label}</strong><small>{detail}</small></span></button>)}
    </nav>

    <div className="editor-content" aria-busy={!config && !error}>
      {section === "identity" && <section id="bot-editor-panel-identity" className="editor-panel identity-settings" role="tabpanel" aria-labelledby="bot-editor-tab-identity">
        <div className="editor-section-title"><div><h3>{t("Identity and mission")}</h3><p>{t("Choose how this Bot appears and describe the result it should deliver.")}</p></div></div>
        <div className="identity-preview"><BotAvatar bot={{ ...bot, title: title.trim() || bot.name }} size={42} /><span><strong>{title.trim() || bot.name}</strong><small>{description.trim() || t("Mission shown in the Bot list")}</small></span><code>{bot.name}</code></div>
        <div className="editor-basic">
          <FormField label={t("Display title")}><input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder={bot.name} /></FormField>
          <FormField label={t("Description")}><TextareaControl resize="vertical" value={description} maxLength={10_000} onChange={(event) => setDescription(event.target.value)} placeholder={t("Mission shown in the Bot list")} /></FormField>
        </div>
      </section>}

      {section === "model" && config && <section id="bot-editor-panel-model" className="editor-panel model-settings" role="tabpanel" aria-labelledby="bot-editor-tab-model">
        <div className="editor-section-title"><div><h3>{t("Model")}</h3><p>{t("Choose a model configured in Hermes or inherit from the main profile.")}</p></div></div>
        <div className={`model-mode ${provider ? "manual" : "automatic"}`}><Cpu size={19} /><span><strong>{provider ? t("Custom model") : t("Automatic model")}</strong><small>{provider && model ? model : t("Inherited from the main profile")}</small></span></div>
        <div className="model-fields">
          <FormField label={t("Provider")}><SelectControl value={provider} onChange={(event) => changeProvider(event.target.value)}><option value="">{t("Inherit from main profile")}</option>{providerOptions.map((item) => <option key={item.slug} value={item.slug}>{item.name ? `${item.name} (${item.slug})` : item.slug}</option>)}</SelectControl></FormField>
          <FormField label={t("Model")}>{modelOptions.length ? <SelectControl value={model} disabled={!provider} onChange={(event) => setModel(event.target.value)}>{modelOptions.map((item) => <option key={item} value={item}>{item}</option>)}</SelectControl> : <input value={model} disabled={!provider} onChange={(event) => setModel(event.target.value)} placeholder={t("Model name")} />}</FormField>
        </div>
      </section>}

      {section === "access" && config && activeCapabilities && <section id="bot-editor-panel-access" className="editor-panel access-settings" role="tabpanel" aria-labelledby="bot-editor-tab-access">
        <div className="editor-section-title"><div><h3>{t("Authorized access")}</h3><p>{t("Grant only the capabilities required for this Bot's mission.")}</p></div></div>
        <div className="capability-tabs" role="tablist" aria-label={t("Capability families")}>
          {CAPABILITY_KINDS.map((kind, index) => { const group = capabilityGroups[kind]; return <button key={kind} id={`capability-tab-${kind}`} type="button" role="tab" aria-selected={capabilityKind === kind} aria-controls="capability-panel" tabIndex={capabilityKind === kind ? 0 : -1} onClick={() => { setCapabilityKind(kind); setCapabilityFilter(""); setActiveOnly(false); }} onKeyDown={(event) => navigateCapabilityTabs(event, index)}><span>{group.label}</span><small>{t("{active}/{total} active", { active: group.selected.length, total: group.items.length })}</small></button>; })}
        </div>
        <div id="capability-panel" className="capability-body" role="tabpanel" aria-labelledby={`capability-tab-${capabilityKind}`}>
          <div className="capability-toolbar">
            <label className="capability-search"><Search size={15} /><span className="sr-only">{t("Search capabilities")}</span><input value={capabilityFilter} onChange={(event) => setCapabilityFilter(event.target.value)} placeholder={t("Search {section}", { section: activeCapabilities.label.toLocaleLowerCase(locale) })} /></label>
            <label className="active-only"><input type="checkbox" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} /><span>{t("Active only")}</span></label>
          </div>
          <div className="capability-batch"><span>{t("{count} visible", { count: visibleCapabilities.length })}</span><button type="button" onClick={() => setVisibleCapabilities(true)}>{t("Enable visible")}</button><button type="button" onClick={() => setVisibleCapabilities(false)}>{t("Disable visible")}</button></div>
          {capabilityKind === "toolsets" && <p className="capability-guidance">{t("Keep only the tool families required for the mission.")}</p>}
          {capabilityKind === "mcp" && <p className="capability-guidance">{t("Integrations that require authentication must first be configured in Hermes.")}</p>}
          <CapabilityList items={visibleCapabilities} selected={activeCapabilities.selected} onToggle={toggleCapability} />
          {toolsetSelectionInvalid && capabilityKind === "toolsets" && <p className="field-error" role="alert">{t("Select at least one tool family.")}</p>}
        </div>
      </section>}

      {section === "instructions" && config && <section id="bot-editor-panel-instructions" className="editor-panel soul-settings" role="tabpanel" aria-labelledby="bot-editor-tab-instructions">
        <div className="editor-section-title"><div><h3>{t("Instructions for the Bot")}</h3><p>{t("These instructions define its tone, operating rules, limits, and escalation behavior.")}</p></div><span>SOUL.md</span></div>
        <div className="instruction-note"><ShieldCheck size={18} /><span><strong>{t("Keep important boundaries explicit")}</strong><small>{t("Hermes uses this text as the source of truth for the Bot's behavior.")}</small></span></div>
        <label className="sr-only" htmlFor="bot-soul">SOUL.md</label><TextareaControl id="bot-soul" resize="none" value={soul} onChange={(event) => setSoul(event.target.value)} spellCheck={false} />
      </section>}

      {!config && !error && <FeedbackState tone="loading" className="editor-loading">{t("Loading Hermes configuration…")}</FeedbackState>}
      {error && <div className="editor-load-error"><FeedbackState tone="error" className="editor-error" icon={<AlertTriangle size={17} />}>{formatError(error)}</FeedbackState>{!config && <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}><RotateCcw size={16} />{t("Try again")}</button>}</div>}
    </div>

    <DialogActions as="footer"><span className="editor-save-note">{toolsetSelectionInvalid ? t("Select at least one tool family.") : changedSections.length === 1 ? t("1 configuration section changed.") : isDirty ? t("{count} configuration sections changed.", { count: changedSections.length }) : t("No unsaved changes.")}</span><button type="button" onClick={requestClose}>{t("Cancel")}</button><button className="primary" type="submit" disabled={!canSave || !isDirty}>{saving ? t("Saving…") : t("Save")}</button></DialogActions>
  </DialogShell>;
}
