import { useEffect, useState } from "react";
import { Archive, CheckCircle2, Download, Upload } from "lucide-react";
import type { AccessRole, Bot, BotsApi } from "./App";
import { FeedbackState } from "./FeedbackState";
import { FormField } from "./FormField";
import { useI18n } from "./i18n";
import { SelectControl } from "./SelectControl";
import { getBotDisplayName } from "./botDisplayName";

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;

interface BotTransferPanelProps {
  api: BotsApi;
  bots: Bot[];
  role: AccessRole;
  onImported(bot: Bot): void;
}

export function BotTransferPanel({ api, bots, role, onImported }: BotTransferPanelProps) {
  const { t, formatError } = useI18n();
  const [exportName, setExportName] = useState(bots[0]?.name || "");
  const [archive, setArchive] = useState<File | null>(null);
  const [importName, setImportName] = useState("");
  const [working, setWorking] = useState<"export" | "import" | "">("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const canTransfer = role === "admin" && Boolean(api.exportBot && api.importBot);

  useEffect(() => {
    if (!bots.some((bot) => bot.name === exportName)) setExportName(bots[0]?.name || "");
  }, [bots, exportName]);

  async function download() {
    if (!api.exportBot || !exportName || !canTransfer) return;
    setWorking("export");
    setError("");
    setSuccess("");
    try {
      const result = await api.exportBot(exportName);
      const href = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = result.filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 0);
      const exported = bots.find((bot) => bot.name === exportName);
      setSuccess(t("Archive ready for {name}.", { name: getBotDisplayName(exported, exportName) }));
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setWorking("");
    }
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!api.importBot || !archive || !canTransfer) return;
    setWorking("import");
    setError("");
    setSuccess("");
    try {
      if (archive.size === 0) throw new Error(t("Choose a non-empty Hermes archive."));
      if (archive.size > MAX_ARCHIVE_BYTES) throw new Error(t("The archive must be 25 MB or smaller."));
      const bot = await api.importBot(archive, importName.trim() || undefined);
      onImported(bot);
      setArchive(null);
      setImportName("");
      setSuccess(t("{name} was imported.", { name: getBotDisplayName(bot) }));
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setWorking("");
    }
  }

  if (!api.exportBot || !api.importBot) {
    return <FeedbackState tone="unavailable" icon={<Archive size={20} />} title={t("Bot transfer unavailable")}>{t("Connect a compatible Hermes 0.21 runtime to import or export Bots.")}</FeedbackState>;
  }

  return <div className="bot-transfer">
    <article className="transfer-card surface-card">
      <span className="transfer-icon"><Download size={19} /></span>
      <div className="transfer-copy"><strong>{t("Export a Bot")}</strong><p>{t("Download a portable Hermes profile archive.")}</p></div>
      <FormField label={t("Bot to export")}><SelectControl value={exportName} disabled={!canTransfer || Boolean(working)} onChange={(event) => setExportName(event.target.value)}>{bots.map((bot) => <option key={bot.name} value={bot.name}>{getBotDisplayName(bot)}</option>)}</SelectControl></FormField>
      <button type="button" disabled={!canTransfer || !exportName || Boolean(working)} onClick={() => void download()}><Download size={16} />{working === "export" ? t("Preparing…") : t("Download archive")}</button>
    </article>

    <form className="transfer-card surface-card" onSubmit={upload}>
      <span className="transfer-icon"><Upload size={19} /></span>
      <div className="transfer-copy"><strong>{t("Import a Bot")}</strong><p>{t("Restore a Hermes profile from a .tar.gz archive.")}</p></div>
      <FormField className="archive-picker" label={t("Hermes archive")} help={archive ? archive.name : t("Maximum 25 MB")}><input aria-label={t("Hermes archive")} type="file" accept=".tar.gz,.tgz,application/gzip,application/x-gzip" disabled={!canTransfer || Boolean(working)} onChange={(event) => setArchive(event.target.files?.[0] || null)} /></FormField>
      <FormField label={t("New technical name")}><input aria-label={t("New technical name")} value={importName} disabled={!canTransfer || Boolean(working)} onChange={(event) => setImportName(event.target.value)} placeholder={t("Optional · keep archive name")} pattern="[A-Za-z0-9][A-Za-z0-9-]{1,63}" /></FormField>
      <button type="submit" disabled={!canTransfer || !archive || Boolean(working)}><Upload size={16} />{working === "import" ? t("Importing…") : t("Import Bot")}</button>
    </form>

    <FeedbackState tone="note" className="transfer-note" icon={<Archive size={18} />}>{t("Hermes removes credential files and redacts secret-shaped text. Archives can still contain private conversations and must be handled as sensitive data.")}</FeedbackState>
    {role !== "admin" && <p className="settings-help">{t("Only administrators can import or export Bots.")}</p>}
    {error && <FeedbackState tone="error">{error}</FeedbackState>}
    {success && <FeedbackState tone="success" icon={<CheckCircle2 size={16} />}>{success}</FeedbackState>}
  </div>;
}
