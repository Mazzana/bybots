import { Bot, Globe2 } from "lucide-react";
import type { AccessRole, BotsApi } from "./App";
import { HermesConnectionPanel } from "./HermesConnectionPanel";
import { LANGUAGE_OPTIONS, useI18n, type LanguagePreference } from "./i18n";
import { SelectControl } from "./SelectControl";

export function FirstRunPanel({ api, role, onConnected }: { api: BotsApi; role: AccessRole; onConnected(): void | Promise<void> }) {
  const { languagePreference, setLanguage, t } = useI18n();

  return <div className="first-run-backdrop">
    <main className="first-run-panel" aria-labelledby="first-run-title">
      <header>
        <span className="first-run-logo"><Bot size={25} /></span>
        <div><small>{t("WELCOME TO BYBOTS")}</small><h1 id="first-run-title">{t("Connect your Hermes gateway")}</h1><p>{t("Hermes on this computer is connected automatically. Choose a remote gateway only when Hermes runs on another machine.")}</p></div>
      </header>
      <div className="first-run-language"><Globe2 size={17} /><label><span>{t("Language")}</span><SelectControl value={languagePreference} onChange={(event) => setLanguage(event.target.value as LanguagePreference)}>{LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value === "system" ? t(option.label) : option.label}</option>)}</SelectControl></label></div>
      <HermesConnectionPanel api={api} role={role} onConnected={onConnected} />
    </main>
  </div>;
}
