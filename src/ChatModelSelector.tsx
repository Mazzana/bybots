import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Cpu, LoaderCircle, Search } from "lucide-react";
import type { AccessRole, Bot, BotConfiguration, BotsApi, BotUpdateResult } from "./App";
import { getBotDisplayName } from "./botDisplayName";
import { useI18n } from "./i18n";
import { SelectControl } from "./SelectControl";
import { IconButton } from "./IconButton";
import { rememberModel } from "./modelLibrary";

const ModelLibraryDialog = lazy(() => import("./ModelLibraryDialog"));

function modelValue(provider: string, model: string) {
  return JSON.stringify([provider, model]);
}

function parseModelValue(value: string): [string, string] {
  if (!value) return ["", ""];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length === 2
      ? [String(parsed[0]), String(parsed[1])]
      : ["", ""];
  } catch {
    return ["", ""];
  }
}

function modelWasRejected(result: BotUpdateResult) {
  return result.applied.model === false || result.applied.provider === false;
}

interface ChatModelSelectorProps {
  api: BotsApi;
  bot: Bot;
  role: AccessRole;
  running: boolean;
  refreshKey?: number;
}

export function ChatModelSelector({ api, bot, role, running, refreshKey = 0 }: ChatModelSelectorProps) {
  const { t, formatError } = useI18n();
  const statusId = useId();
  const [config, setConfig] = useState<BotConfiguration | null>(null);
  const [selectedValue, setSelectedValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    request.current += 1;
    setSaving(false);
    setLibraryOpen(false);
    if (!api.getBotConfiguration) {
      setLoading(false);
      return;
    }
    let active = true;
    setConfig(null);
    setSelectedValue("");
    setLoading(true);
    setError("");
    setSaved(false);
    void api.getBotConfiguration(bot.name).then((next) => {
      if (!active) return;
      setConfig(next);
      setSelectedValue(modelValue(next.provider, next.model));
    }).catch((cause) => {
      if (active) setError(String(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; request.current += 1; };
  }, [api, bot.name, refreshKey]);

  const providerOptions = useMemo(() => (config?.providers ?? [])
    .map((provider) => ({ ...provider, models: [...new Set(provider.models.filter(Boolean))] }))
    .filter((provider) => provider.models.length > 0), [config]);
  const currentValue = config ? modelValue(config.provider, config.model) : "";
  const hasCurrentModel = Boolean(config?.provider || config?.model);
  const currentIsListed = !hasCurrentModel || providerOptions.some((provider) =>
    provider.slug === config?.provider && provider.models.includes(config?.model ?? ""));
  const canChange = role === "admin" && Boolean(api.updateBot);
  const disabled = loading || saving || running || !config || !canChange;
  const label = t("Bot model for {name}", { name: getBotDisplayName(bot) });
  const hint = error
    ? formatError(error)
    : running
      ? t("Wait for the current response before changing models.")
      : !canChange
        ? t("Only administrators can change Bot models.")
        : t("Choose from the models available in Hermes.");

  async function changeModel(nextValue: string) {
    if (disabled || !config || !api.updateBot) return;
    const owner = request.current;
    const previousValue = currentValue;
    const [provider, model] = parseModelValue(nextValue);
    setSelectedValue(nextValue);
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      let result = await api.updateBot(bot.name, { provider, model });
      if (request.current !== owner) return;
      if (result.confirmRequired) {
        const accepted = window.confirm(result.confirmMessage || t("This model may cost more. Confirm this choice?"));
        if (!accepted) {
          setSelectedValue(previousValue);
          return;
        }
        result = await api.updateBot(bot.name, { provider, model, confirmExpensiveModel: true });
        if (request.current !== owner) return;
      }
      if (modelWasRejected(result)) throw new Error(t("Hermes did not save the selected model."));
      setConfig((current) => current ? { ...current, provider, model } : current);
      setSaved(true);
      rememberModel(nextValue);
      setLibraryOpen(false);
    } catch (cause) {
      if (request.current !== owner) return;
      setSelectedValue(previousValue);
      setError(String(cause));
    } finally {
      if (request.current === owner) setSaving(false);
    }
  }

  if (!api.getBotConfiguration) return null;

  return <div className={`chat-model ${error ? "has-error" : ""}`} title={hint}>
    <div className="chat-model-control">
      <Cpu size={15} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <SelectControl
        aria-label={label}
        aria-describedby={statusId}
        aria-invalid={Boolean(error)}
        value={selectedValue}
        disabled={disabled}
        onChange={(event) => void changeModel(event.target.value)}
      >
        {loading && <option value="">{t("Loading models…")}</option>}
        {!loading && !config && <option value="">{t("Models unavailable")}</option>}
        {config && <option value={modelValue("", "")}>{t("Inherit from main profile")}</option>}
        {config && !currentIsListed && <option value={currentValue}>{t("{model} (current)", { model: config.model || config.provider })}</option>}
        {providerOptions.map((provider) => <optgroup key={provider.slug} label={provider.name || provider.slug}>
          {provider.models.map((model) => <option key={model} value={modelValue(provider.slug, model)}>{model}</option>)}
        </optgroup>)}
      </SelectControl>
      {saving && <LoaderCircle className="spin" size={15} aria-hidden="true" />}
      {!saving && saved && <Check className="model-saved" size={15} aria-hidden="true" />}
      {!saving && error && <AlertTriangle size={15} aria-hidden="true" />}
    </div>
    <IconButton label={t("Find a model")} disabled={disabled} onClick={() => setLibraryOpen(true)}><Search size={15} /></IconButton>
    {libraryOpen && <Suspense fallback={<span role="status">{t("Loading models…")}</span>}><ModelLibraryDialog current={selectedValue} busy={saving || running} error={error ? formatError(error) : ""} options={providerOptions.flatMap((provider) => provider.models.map((model) => ({ value: modelValue(provider.slug, model), model, provider: provider.name || provider.slug })))} onChoose={(value) => void changeModel(value)} onClose={() => setLibraryOpen(false)} /></Suspense>}
    <span className="sr-only" id={statusId} role="status" aria-live="polite">
      {saving ? t("Changing model…") : saved ? t("Model saved.") : hint}
    </span>
  </div>;
}
