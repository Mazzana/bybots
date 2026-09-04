import { Bot, Globe2 } from "lucide-react";
import type { AccessRole, BotsApi } from "./App";
import { HermesConnectionPanel } from "./HermesConnectionPanel";
import { LANGUAGE_OPTIONS, useI18n, type LanguagePreference } from "./i18n";
import { SelectControl } from "./SelectControl";
import { useDialogFocus } from "./useDialogFocus";

export function FirstRunPanel({ api, role, localHermesUnavailable = false, onConnected }: { api: BotsApi; role: AccessRole; localHermesUnavailable?: boolean; onConnected(): void | Promise<void> }) {
  const { languagePreference, setLanguage, t } = useI18n();
  const panelRef = useDialogFocus<HTMLElement>(true, () => {});

  return <div className="first-run-backdrop">
    <section ref={panelRef} className="first-run-panel" role="dialog" aria-modal="true" aria-labelledby="first-run-title" aria-describedby="first-run-description" tabIndex={-1}>
      <header>
        <span className="first-run-logo"><Bot size={25} /></span>
        <div><small>{t("WELCOME TO BYBOTS")}</small><h1 id="first-run-title">{t("Connect your Hermes gateway")}</h1><p id="first-run-description">{t("Hermes runs your Bots. Connect the Hermes installed on this computer, or use a remote gateway.")}</p></div>
      </header>
      <div className="first-run-language"><Globe2 size={17} /><label><span>{t("Language")}</span><SelectControl value={languagePreference} onChange={(event) => setLanguage(event.target.value as LanguagePreference)}>{LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value === "system" ? t(option.label) : option.label}</option>)}</SelectControl></label></div>
      <HermesConnectionPanel api={api} role={role} initialLocalUnavailable={localHermesUnavailable} autoReconnect onConnected={onConnected} />
      <p className="settings-help">{t("New to Hermes? It is installed separately from ByBots.")} <a className="gateway-reset" href="https://github.com/Mazzana/bybots/blob/main/docs/INSTALLATION.md#prepare-hermes" target="_blank" rel="noopener noreferrer">{t("Set up Hermes step by step")}</a></p>
    </section>
  </div>;
}
