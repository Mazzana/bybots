import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, Check, Cpu, LoaderCircle } from "lucide-react";
import type { AccessRole, Bot, BotConfiguration, BotsApi, BotUpdateResult } from "./App";
import { getBotDisplayName } from "./botDisplayName";
import { useI18n } from "./i18n";
import { SelectControl } from "./SelectControl";

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

  useEffect(() => {
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
    return () => { active = false; };
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

  async function changeModel(event: React.ChangeEvent<HTMLSelectElement>) {
    if (!config || !api.updateBot || saving) return;
    const nextValue = event.target.value;
    const previousValue = currentValue;
    const [provider, model] = parseModelValue(nextValue);
    setSelectedValue(nextValue);
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      let result = await api.updateBot(bot.name, { provider, model });
      if (result.confirmRequired) {
        const accepted = window.confirm(result.confirmMessage || t("This model may cost more. Confirm this choice?"));
        if (!accepted) {
          setSelectedValue(previousValue);
          return;
        }
        result = await api.updateBot(bot.name, { provider, model, confirmExpensiveModel: true });
      }
      if (modelWasRejected(result)) throw new Error(t("Hermes did not save the selected model."));
      setConfig((current) => current ? { ...current, provider, model } : current);
      setSaved(true);
    } catch (cause) {
      setSelectedValue(previousValue);
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  }

  if (!api.getBotConfiguration) return null;

  return <div className={`chat-model ${error ? "has-error" : ""}`} title={hint}>
    <label className="chat-model-control">
      <Cpu size={15} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <SelectControl
        aria-label={label}
        aria-describedby={statusId}
        aria-invalid={Boolean(error)}
        value={selectedValue}
        disabled={disabled}
        onChange={(event) => void changeModel(event)}
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
    </label>
    <span className="sr-only" id={statusId} role="status" aria-live="polite">
      {saving ? t("Changing model…") : saved ? t("Model saved.") : hint}
    </span>
  </div>;
}
