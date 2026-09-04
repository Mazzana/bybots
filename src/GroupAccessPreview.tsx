import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { Bot, BotConfiguration, BotsApi } from "./App";
import { BotIdentity } from "./BotIdentity";
import { DialogActions, DialogShell } from "./Dialog";
import { FeedbackState } from "./FeedbackState";
import { IconButton } from "./IconButton";
import { useI18n } from "./i18n";

type Access = Pick<BotConfiguration, "skills" | "toolsets" | "mcpServers">;
type Result = Access | "loading" | "unavailable";
export default function GroupAccessPreview({ api, bots, members, inline = false }: {
  api: BotsApi; bots: Bot[]; members: string[]; inline?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; results: Record<string, Result> }>({ key: "", results: {} });
  const key = JSON.stringify([...new Set(members)].slice(0, 6));
  const names: string[] = JSON.parse(key);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const timers: number[] = [];
    const requested: string[] = JSON.parse(key);
    setSnapshot({ key, results: {} });
    for (const name of requested) {
      let settled = false;
      const finish = (result: Result) => {
        if (!active || settled) return;
        settled = true;
        setSnapshot((current) => ({ key, results: { ...current.results, [name]: result } }));
      };
      const timer = window.setTimeout(() => finish("unavailable"), 15_000);
      timers.push(timer);
      void Promise.resolve().then(() => api.getBotConfiguration?.(name)).then((config) => {
        if (!config || config.bot !== name || ![config.skills, config.toolsets, config.mcpServers].every(Array.isArray)) {
          finish("unavailable"); return;
        }
        const clean = (items: Access["skills"]) => items.filter((item) => item && typeof item.name === "string" && item.enabled === true).map(({ name }) => ({ name, enabled: true }));
        finish({ skills: clean(config.skills), toolsets: clean(config.toolsets), mcpServers: clean(config.mcpServers) });
      }).catch(() => finish("unavailable")).finally(() => window.clearTimeout(timer));
    }
    return () => { active = false; timers.forEach(window.clearTimeout); };
  }, [api, key, open, attempt]);
  const content = <>
    <p className="settings-help">{t("Bots can receive messages shared with the group. Each keeps its own configured capabilities.")}</p>
    <p className="settings-help">{t("This is a configuration snapshot, not a verification of file permissions, credentials, or effective access. Refresh after changing Hermes.")}</p>
    {names.map((name) => {
      const result = snapshot.key === key ? snapshot.results[name] ?? "loading" : "loading";
      return <section className="detail-section" key={name} aria-label={t("Access for {name}", { name })}>
        <BotIdentity bot={bots.find((bot) => bot.name === name) ?? { name, system: false }} size={28} />
        {result === "loading" ? <FeedbackState tone="loading">{t("Loading configured access…")}</FeedbackState> : result === "unavailable" ? <FeedbackState tone="unavailable">{t("Access could not be verified. Do not assume this Bot has no access.")}</FeedbackState> : <>
          <p><strong>{t("Enabled skills")}</strong>{result.skills.map((item) => item.name).join(", ") || t("None reported by Hermes")}</p>
          <p><strong>{t("Enabled tools")}</strong>{result.toolsets.map((item) => item.name).join(", ") || t("None reported by Hermes")}</p>
          <p><strong>{t("Enabled MCP integrations")}</strong>{result.mcpServers.map((item) => item.name).join(", ") || t("None reported by Hermes")}</p>
        </>}
      </section>;
    })}
    <DialogActions><button type="button" onClick={() => setAttempt((value) => value + 1)}>{t("Refresh access")}</button>{!inline && <button type="button" onClick={() => setOpen(false)}>{t("Close")}</button>}</DialogActions>
  </>;
  if (inline) return <details className="group-access-preview" onToggle={(event) => setOpen(event.currentTarget.open)}><summary className="gateway-reset">{t("Review Bot access")}</summary>{open && content}</details>;
  return <div className="group-access"><IconButton label={t("Review Bot access")} onClick={() => setOpen(true)}><ShieldCheck size={18} /></IconButton>{open && <DialogShell className="group-access-preview" ariaLabel={t("Review Bot access")} onClose={() => setOpen(false)}><h2>{t("Review Bot access")}</h2>{content}</DialogShell>}</div>;
}
