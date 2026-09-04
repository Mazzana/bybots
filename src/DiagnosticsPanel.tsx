import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppDiagnostics, BotsApi, DiagnosticCheck } from "./App";
import { FeedbackState } from "./FeedbackState";
import { useI18n } from "./i18n";

function StatusIcon({ status }: { status: DiagnosticCheck["status"] }) {
  return status === "ready" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />;
}

export function DiagnosticsPanel({ api, refreshKey = 0 }: { api: BotsApi; refreshKey?: number }) {
  const { t, formatError } = useI18n();
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!api.getDiagnostics) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    api.getDiagnostics()
      .then((result) => active && setDiagnostics(result))
      .catch((cause) => active && setError(formatError(cause)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [api, formatError, refreshKey, reload]);

  if (!api.getDiagnostics) return null;

  return <section className="diagnostics-card surface-card" aria-labelledby="diagnostics-heading">
    <div className="diagnostics-heading">
      <span><ShieldCheck size={19} /></span>
      <div><h4 id="diagnostics-heading">{t("Connection diagnostics")}</h4><p>{t("Bridge, Hermes, authentication, and compatibility in one place.")}</p></div>
      <button type="button" aria-label={t("Refresh diagnostics")} disabled={loading} onClick={() => setReload((value) => value + 1)}><RefreshCw size={16} />{t("Refresh")}</button>
    </div>
    {loading && <FeedbackState tone="loading">{t("Checking connection…")}</FeedbackState>}
    {!loading && diagnostics && <div className="diagnostics-list">
      <div data-status={diagnostics.bridge.status}><StatusIcon status={diagnostics.bridge.status} /><span><strong>{t("Byfinity Bridge")}</strong><small>{t("Ready · version {version}", { version: diagnostics.bridge.version || "—" })}</small></span></div>
      <div data-status={diagnostics.hermes.status}><StatusIcon status={diagnostics.hermes.status} /><span><strong>Hermes</strong><small>{diagnostics.hermes.status === "ready" ? t("Connected · version {version}", { version: diagnostics.hermes.version || "—" }) : diagnostics.failure ? t(diagnostics.failure.hint) : t("Connection needs attention")}</small></span></div>
      <div data-status={diagnostics.authentication.status}><StatusIcon status={diagnostics.authentication.status} /><span><strong>{t("Authentication")}</strong><small>{diagnostics.authentication.status === "ready" ? t("Session accepted") : t(diagnostics.authentication.detail || "Check the session token")}</small></span></div>
      <div data-status={diagnostics.hermes.compatible === false ? "warning" : "ready"}><StatusIcon status={diagnostics.hermes.compatible === false ? "warning" : "ready"} /><span><strong>{t("Compatibility")}</strong><small>{diagnostics.hermes.compatible === false ? t("Expected Hermes {version}", { version: diagnostics.supportedHermes }) : t("Supported contract · Hermes {version}", { version: diagnostics.supportedHermes })}</small></span></div>
    </div>}
    {error && <FeedbackState tone="error">{error}</FeedbackState>}
    {!loading && diagnostics?.failure && <p className="diagnostics-guidance">{t("Review the gateway URL and token below, then test the connection again.")}</p>}
  </section>;
}
