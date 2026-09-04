import { Bot, Globe2, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AccessRole, BotsApi } from "./App";
import { HermesConnectionPanel } from "./HermesConnectionPanel";
import { LANGUAGE_OPTIONS, useI18n, type LanguagePreference } from "./i18n";
import { SelectControl } from "./SelectControl";

export function FirstRunPanel({ api, role, localHermesUnavailable = false, onConnected }: { api: BotsApi; role: AccessRole; localHermesUnavailable?: boolean; onConnected(): void | Promise<void> }) {
  const { languagePreference, setLanguage, t } = useI18n();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => panelRef.current?.focus(), []);

  useEffect(() => {
    if (!localHermesUnavailable || !api.getDiagnostics) return;
    let active = true;
    let timer = 0;
    const checkConnection = async () => {
      try {
        const diagnostics = await api.getDiagnostics!();
        if (!active) return;
        if (diagnostics.hermes.status === "ready" && diagnostics.hermes.compatible !== false && diagnostics.authentication.status === "ready") {
          await onConnected();
          if (active) timer = window.setTimeout(() => void checkConnection(), 4_000);
          return;
        }
      } catch {
        // The first-run screen remains useful while the local service starts.
      }
      if (active) timer = window.setTimeout(() => void checkConnection(), 4_000);
    };
    timer = window.setTimeout(() => void checkConnection(), 4_000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, localHermesUnavailable, onConnected]);

  return <div className="first-run-backdrop">
    <section ref={panelRef} className="first-run-panel" role="dialog" aria-modal="true" aria-labelledby="first-run-title" aria-describedby="first-run-description" tabIndex={-1}>
      <header>
        <span className="first-run-logo"><Bot size={25} /></span>
        <div><small>{t("WELCOME TO BYBOTS")}</small><h1 id="first-run-title">{t("Connect your Hermes gateway")}</h1><p id="first-run-description">{localHermesUnavailable ? t("Hermes is not running yet. Keep ByBots open: your workspace will appear automatically as soon as Hermes is available.") : t("Hermes on this computer is connected automatically. Choose a remote gateway only when Hermes runs on another machine.")}</p></div>
      </header>
      <div className="first-run-language"><Globe2 size={17} /><label><span>{t("Language")}</span><SelectControl value={languagePreference} onChange={(event) => setLanguage(event.target.value as LanguagePreference)}>{LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value === "system" ? t(option.label) : option.label}</option>)}</SelectControl></label></div>
      {localHermesUnavailable && <div className="local-gateway-note first-run-waiting" role="status" aria-live="polite"><RefreshCw size={18} /><span><strong>{t("Waiting for local Hermes…")}</strong><small>{t("ByBots checks the connection automatically every few seconds. Nothing needs to be reconfigured.")}</small></span></div>}
      <HermesConnectionPanel api={api} role={role} initialLocalUnavailable={localHermesUnavailable} onConnected={onConnected} />
    </section>
  </div>;
}
