import { useEffect, useMemo, useState } from "react";
import { Gauge } from "lucide-react";
import type { Bot, BotsApi, Usage } from "./App";
import { FeedbackState } from "./FeedbackState";
import { SelectControl } from "./SelectControl";
import { getBotDisplayName } from "./botDisplayName";
import { useI18n } from "./i18n";
import type { AppPreferences } from "./preferences";

interface UsagePanelProps {
  api: BotsApi;
  bots: Bot[];
  preferences: AppPreferences;
  onPreferencesChange(preferences: AppPreferences): void;
}

export function UsagePanel({ api, bots, preferences, onPreferencesChange }: UsagePanelProps) {
  const { locale, t, formatError } = useI18n();
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const percentage = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);
  const [requestedBot, setRequestedBot] = useState(bots[0]?.name || "");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedBot = bots.some((bot) => bot.name === requestedBot) ? requestedBot : bots[0]?.name || "";
  const modelTokenTotal = useMemo(() => (usage?.byModel ?? []).reduce((total, entry) => total + entry.inputTokens + entry.outputTokens, 0), [usage]);
  const summarizedTokenTotal = usage ? usage.inputTokens + usage.outputTokens : 0;

  useEffect(() => {
    if (!selectedBot) {
      setUsage(null);
      setLoading(false);
      setError("");
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    setUsage(null);
    api.getUsage(selectedBot, preferences.usageDays)
      .then((next) => active && setUsage(next))
      .catch((cause) => active && setError(formatError(cause)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [api, formatError, preferences.usageDays, selectedBot]);

  return <section aria-labelledby="settings-usage">
    <div className="settings-section-heading"><h3 id="settings-usage">{t("Usage")}</h3><p>{t("Review token consumption without displaying cost estimates.")}</p></div>
    {bots.length === 0 ? <FeedbackState tone="unavailable" icon={<Gauge size={20} />} title={t("No usage available")}>{t("Create a Bot to start tracking model usage.")}</FeedbackState> : <>
      <label className="mcp-bot-picker"><span>{t("Usage for")}</span><SelectControl aria-label={t("Usage for")} value={selectedBot} onChange={(event) => setRequestedBot(event.target.value)}>{bots.map((bot) => <option key={bot.name} value={bot.name}>{getBotDisplayName(bot)}</option>)}</SelectControl></label>
      <div className="setting-card"><div className="setting-copy"><span><strong>{t("Usage period")}</strong><small>{t("Used for token and model summaries.")}</small></span></div><SelectControl aria-label={t("Usage period")} value={preferences.usageDays} onChange={(event) => onPreferencesChange({ ...preferences, usageDays: Number(event.target.value) as 7 | 30 | 90 })}><option value={7}>{t("7 days")}</option><option value={30}>{t("30 days")}</option><option value={90}>{t("90 days")}</option></SelectControl></div>
      {loading && <FeedbackState tone="loading">{t("Loading usage…")}</FeedbackState>}
      {!loading && error && <FeedbackState tone="error">{t("Usage unavailable")} · {error}</FeedbackState>}
      {!loading && !error && usage && <>
        <div className="metrics">
          <article><small>{t("TOTAL TOKENS")}</small><strong>{number.format(usage.totalTokens)}</strong><p>{number.format(usage.inputTokens)} {t("input")} · {number.format(usage.outputTokens)} {t("output")}</p></article>
          <article><small>{t("REASONING")}</small><strong>{number.format(usage.reasoningTokens)}</strong><p>{number.format(usage.cacheReadTokens)} {t("cache reads")}</p></article>
          <article><small>{t("SESSIONS")}</small><strong>{number.format(usage.sessions)}</strong><p>{t("{count} model calls", { count: number.format(usage.apiCalls) })}</p></article>
        </div>
        {(usage.byModel ?? []).length > 0 ? <section className="usage-breakdown" aria-label={t("Usage by model")}><small>{t("BY MODEL")}</small>{usage.byModel.map((entry, index) => {
          const tokens = entry.inputTokens + entry.outputTokens;
          const share = modelTokenTotal > 0 ? (tokens / modelTokenTotal) * 100 : 0;
          const formattedShare = percentage.format(share);
          const color = `hsl(${Math.round((index * 137.508 + 210) % 360)} 72% 64%)`;
          return <div className="usage-model" key={entry.model}><div><span><strong>{entry.model}</strong><small>{number.format(entry.inputTokens)} {t("input")} · {number.format(entry.outputTokens)} {t("output")}</small></span><b>{number.format(tokens)} {t("tokens")} · {formattedShare}%</b></div><span className="usage-progress" role="progressbar" aria-label={t("{model}: {percent}% of model tokens", { model: entry.model, percent: formattedShare })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(share.toFixed(1))}><i style={{ width: `${share}%`, backgroundColor: color }} /></span></div>;
        })}{modelTokenTotal !== summarizedTokenTotal && <p className="usage-explanation">{t("Hermes reports total and per-model tokens independently, so these figures may not reconcile exactly.")}</p>}</section> : <FeedbackState tone="unavailable">{t("No model usage recorded for this period.")}</FeedbackState>}
      </>}
    </>}
  </section>;
}
