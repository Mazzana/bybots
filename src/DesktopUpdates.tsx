import { useEffect, useRef, useState } from "react";
import type { ReleaseCheck } from "../electron/release-checker";
import { FeedbackState } from "./FeedbackState";
import { useI18n } from "./i18n";

export function DesktopUpdates() {
  const { t } = useI18n();
  const updates = window.byBotsDesktop?.updates;
  const alive = useRef(false);
  const busy = useRef(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ReleaseCheck>();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (!updates) return null;
  async function check() {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    setResult(undefined);
    try {
      const next = await updates!.check();
      if (alive.current) setResult(next);
    } catch { if (alive.current) setResult({ status: "unavailable" }); }
    finally { busy.current = false; if (alive.current) setChecking(false); }
  }
  return <section className="detail-section" aria-label={t("Application updates")}>
    <strong>{t("Application updates")}</strong>
    <p>{t("Checks GitHub for stable releases only. Nothing is downloaded or installed automatically.")}</p>
    <button type="button" className="gateway-reset" disabled={checking} onClick={() => void check()}>{t("Check for updates")}</button>
    {checking && <FeedbackState tone="loading">{t("Checking GitHub…")}</FeedbackState>}
    {result && <FeedbackState tone={result.status === "unavailable" ? "error" : "success"}>
      {result.status === "available" ? t("Version {version} is available.", { version: result.version })
        : result.status === "current" ? t("No newer stable release is available.")
        : result.status === "no-stable-release" ? t("No stable release is published yet. Preview builds are not included.")
        : t("Unable to check GitHub. Check your connection and try again in a minute.")}
    </FeedbackState>}
    {result?.status === "available" && <a className="gateway-reset" href={result.url} target="_blank" rel="noreferrer">{t("View release on GitHub")}</a>}
  </section>;
}
