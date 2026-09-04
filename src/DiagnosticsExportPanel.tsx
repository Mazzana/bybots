import { CheckCircle2, Download, FileJson, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { BotsApi, DiagnosticsReport } from "./App";
import { FeedbackState } from "./FeedbackState";
import { useI18n } from "./i18n";

function reportJson(report: DiagnosticsReport) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function reportFilename(generatedAt: string) {
  const day = generatedAt.slice(0, 10) || "report";
  return `bybots-diagnostics-${day}.json`;
}

export function DiagnosticsExportPanel({ api }: { api: BotsApi }) {
  const { t, formatError } = useI18n();
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState(false);

  if (!api.getDiagnosticsReport) {
    return <FeedbackState tone="unavailable" icon={<FileJson size={20} />} title={t("Diagnostics export unavailable")}>{t("Connect a compatible Byfinity Bridge to prepare a sanitized report.")}</FeedbackState>;
  }

  async function prepare() {
    if (!api.getDiagnosticsReport) return;
    setLoading(true);
    setError("");
    setDownloaded(false);
    try {
      setReport(await api.getDiagnosticsReport());
    } catch (cause) {
      setReport(null);
      setError(formatError(cause));
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!report) return;
    const href = URL.createObjectURL(new Blob([reportJson(report)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = reportFilename(report.generatedAt);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 0);
    setDownloaded(true);
  }

  return <section className="diagnostics-export" aria-labelledby="diagnostics-export-heading">
    <div className="diagnostics-export-heading">
      <span><ShieldCheck size={19} /></span>
      <div><h4 id="diagnostics-export-heading">{t("Sanitized diagnostics")}</h4><p>{t("Review the complete report before choosing whether to download it.")}</p></div>
    </div>
    <div className="diagnostics-export-actions">
      <button type="button" disabled={loading} onClick={() => void prepare()}>{report ? <RefreshCw size={16} /> : <FileJson size={16} />}{loading ? t("Preparing preview…") : report ? t("Refresh preview") : t("Prepare preview")}</button>
      <button className="primary" type="button" disabled={!report || loading} onClick={download}><Download size={16} />{t("Download diagnostics")}</button>
    </div>
    <p className="diagnostics-privacy"><ShieldCheck size={15} />{t("Credentials, gateway address, Bot names, conversations, and files are excluded.")}</p>
    {loading && <FeedbackState tone="loading" compact>{t("Preparing sanitized diagnostics…")}</FeedbackState>}
    {error && <FeedbackState tone="error">{error}</FeedbackState>}
    {report && !loading && <div className="diagnostics-preview"><div><strong>{t("Report preview")}</strong><small>{t("This is exactly what will be downloaded.")}</small></div><pre tabIndex={0} aria-label={t("Diagnostics report preview")}>{reportJson(report)}</pre></div>}
    {downloaded && <FeedbackState tone="success" icon={<CheckCircle2 size={16} />}>{t("Diagnostics report downloaded.")}</FeedbackState>}
  </section>;
}
