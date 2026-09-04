import { useEffect, useState } from "react";
import { CalendarClock, History, Pause, Play, Plus, Trash2, X } from "lucide-react";
import type { AccessRole, Bot, BotRoutine, BotRoutineInput, BotRoutineRun, BotsApi } from "./App";
import { getBotDisplayName } from "./botDisplayName";
import { DialogActions, DialogShell } from "./Dialog";
import { FormField } from "./FormField";
import { IconButton } from "./IconButton";
import { useI18n } from "./i18n";
import { SelectControl } from "./SelectControl";
import { TextareaControl } from "./TextareaControl";

const schedules = [
  { value: "0 9 * * *", label: "Every day at 09:00" },
  { value: "0 9 * * 1-5", label: "Monday to Friday at 09:00" },
  { value: "0 9 * * 1", label: "Every Monday at 09:00" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "custom", label: "Custom schedule" }
];

function dateTime(value: string | number | undefined, locale: string) {
  if (!value) return "—";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function BotRoutines({ api, bot, role }: { api: BotsApi; bot: Bot; role: AccessRole }) {
  const { locale, t, formatError } = useI18n();
  const enabled = Boolean(api.listRoutines && api.createRoutine && api.setRoutineEnabled && api.runRoutine && api.deleteRoutine && api.listRoutineRuns);
  const [routines, setRoutines] = useState<BotRoutine[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scheduleChoice, setScheduleChoice] = useState(schedules[0].value);
  const [customSchedule, setCustomSchedule] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, BotRoutineRun[]>>({});
  const canAdmin = role === "admin";
  const canRun = role !== "viewer";
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  useEffect(() => {
    let active = true;
    setRoutines([]);
    setError("");
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    api.listRoutines!(bot.name)
      .then((next) => { if (active) setRoutines(next); })
      .catch((cause) => { if (active) setError(String(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, bot.name, enabled]);

  if (!enabled) return null;

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const schedule = scheduleChoice === "custom" ? customSchedule.trim() : scheduleChoice;
    if (!schedule || !name.trim() || !prompt.trim()) return;
    setBusyId("new");
    setError("");
    try {
      const input: BotRoutineInput = { name: name.trim(), prompt: prompt.trim(), schedule };
      const routine = await api.createRoutine!(bot.name, input);
      setRoutines((current) => [...current, routine]);
      setCreating(false);
      setName("");
      setPrompt("");
      setScheduleChoice(schedules[0].value);
      setCustomSchedule("");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(routine: BotRoutine) {
    setBusyId(routine.id);
    setError("");
    try {
      const updated = await api.setRoutineEnabled!(bot.name, routine.id, !routine.enabled);
      setRoutines((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) { setError(String(cause)); }
    finally { setBusyId(null); }
  }

  async function run(routine: BotRoutine) {
    if (!window.confirm(t("Run the “{name}” routine now with this Bot's current access?", { name: routine.name }))) return;
    setBusyId(routine.id);
    setError("");
    try {
      const updated = await api.runRoutine!(bot.name, routine.id);
      setRoutines((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) { setError(String(cause)); }
    finally { setBusyId(null); }
  }

  async function remove(routine: BotRoutine) {
    if (!window.confirm(t("Delete the “{name}” routine and its schedule?", { name: routine.name }))) return;
    setBusyId(routine.id);
    setError("");
    try {
      await api.deleteRoutine!(bot.name, routine.id);
      setRoutines((current) => current.filter((item) => item.id !== routine.id));
      setHistoryId((current) => current === routine.id ? null : current);
    } catch (cause) { setError(String(cause)); }
    finally { setBusyId(null); }
  }

  async function toggleHistory(routine: BotRoutine) {
    if (historyId === routine.id) { setHistoryId(null); return; }
    setHistoryId(routine.id);
    setBusyId(routine.id);
    setError("");
    try {
      const nextRuns = await api.listRoutineRuns!(bot.name, routine.id);
      setRuns((current) => ({ ...current, [routine.id]: nextRuns }));
    } catch (cause) { setError(String(cause)); }
    finally { setBusyId(null); }
  }

  return <section id="bot-routines" className="routines-section" aria-labelledby="routines-title">
    <div className="routines-heading"><div><small>{t("ROUTINES")}</small><strong id="routines-title">{t("Hermes schedules")}</strong></div>{canAdmin && <IconButton label={t("Create a routine")} onClick={() => setCreating(true)}><Plus size={16} /></IconButton>}</div>
    {loading && <p className="routine-status">{t("Loading…")}</p>}
    {!loading && routines.length === 0 && <div className="routine-empty"><p>{canAdmin ? t("Automate a recurring task for this Bot.") : t("No routine configured for this Bot.")}</p>{canAdmin && <button type="button" onClick={() => setCreating(true)}>{t("Create a routine")}</button>}</div>}
    <div className="routine-list">{routines.map((routine) => <article key={routine.id} className="routine-card">
      <div className="routine-title"><span className={routine.enabled ? "active" : "paused"}><CalendarClock size={15} /></span><div><strong>{routine.name}</strong><small>{routine.scheduleDisplay}</small></div></div>
      <p>{routine.prompt}</p>
      <div className="routine-meta"><span>{routine.enabled ? t("Next: {date}", { date: dateTime(routine.nextRunAt, locale) }) : t("Paused")}</span>{routine.lastStatus && <em className={routine.lastStatus === "error" ? "failed" : ""}>{routine.lastStatus === "error" ? t("Failed") : t("Executed")}</em>}</div>
      {routine.lastError && <p className="routine-error" role="alert">{formatError(routine.lastError)}</p>}
      <div className="routine-actions">
        {canRun && <button type="button" disabled={busyId === routine.id} onClick={() => void run(routine)}><Play size={14} /> {t("Run")}</button>}
        {canAdmin && <button type="button" disabled={busyId === routine.id} onClick={() => void toggle(routine)}>{routine.enabled ? <Pause size={14} /> : <Play size={14} />}{routine.enabled ? t("Pause") : t("Resume")}</button>}
        <button type="button" aria-expanded={historyId === routine.id} disabled={busyId === routine.id} onClick={() => void toggleHistory(routine)}><History size={14} /> {t("History")}</button>
        {canAdmin && <IconButton className="routine-delete" label={t("Delete {name}", { name: routine.name })} disabled={busyId === routine.id} onClick={() => void remove(routine)}><Trash2 size={14} /></IconButton>}
      </div>
      {historyId === routine.id && <div className="routine-history">{(runs[routine.id] ?? []).map((entry) => <div key={entry.id}><span className={entry.status}>{entry.status === "running" ? t("In progress") : entry.status === "error" ? t("Failed") : t("Completed")}</span><time dateTime={new Date(entry.startedAt * 1000).toISOString()}>{dateTime(entry.startedAt, locale)}</time>{entry.output && <p>{entry.output}</p>}{entry.error && <p className="routine-error">{formatError(entry.error)}</p>}</div>)}{busyId !== routine.id && (runs[routine.id] ?? []).length === 0 && <p>{t("No recorded run.")}</p>}</div>}
    </article>)}</div>
    {error && <p className="routine-error" role="alert">{formatError(error)}</p>}

    {canAdmin && creating && <DialogShell as="form" backdropClassName="routine-backdrop" className="routine-modal" ariaLabel={t("Create a routine")} onSubmit={create} onClose={() => setCreating(false)}>
      <div className="routine-modal-head"><div><small>{t("NEW HERMES ROUTINE")}</small><h2>{t("Schedule a task")}</h2><p>{t("Hermes will run it with the {name} profile and capabilities.", { name: getBotDisplayName(bot) })}</p></div><IconButton label={t("Close")} onClick={() => setCreating(false)}><X size={18} /></IconButton></div>
      <FormField label={t("Name")}><input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("e.g. Morning report")} required /></FormField>
      <FormField label={t("Frequency")}><SelectControl value={scheduleChoice} onChange={(event) => setScheduleChoice(event.target.value)}>{schedules.map((item) => <option key={item.value} value={item.value}>{t(item.label)}</option>)}</SelectControl></FormField>
      <p className="routine-timezone">{t("Displayed in your local time zone: {zone}.", { zone: timeZone })}</p>
      {scheduleChoice === "custom" && <FormField label={t("Hermes schedule")} help={t("Hermes natural expressions or cron syntax.")}><input value={customSchedule} onChange={(event) => setCustomSchedule(event.target.value)} placeholder={t("e.g. every 2h or 0 9 * * *")} required /></FormField>}
      <FormField label={t("Instruction")}><TextareaControl resize="vertical" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("Describe the expected result, authorized sources, and boundaries…")} required /></FormField>
      <DialogActions><button type="button" onClick={() => setCreating(false)}>{t("Cancel")}</button><button className="primary" type="submit" disabled={busyId === "new" || !name.trim() || !prompt.trim() || (scheduleChoice === "custom" && !customSchedule.trim())}>{busyId === "new" ? t("Creating…") : t("Create routine")}</button></DialogActions>
    </DialogShell>}
  </section>;
}
