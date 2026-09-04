import { Maximize2, Minus, X } from "lucide-react";
import { useI18n } from "./i18n";

export function WindowControls() {
  const { t } = useI18n();
  const controls = window.byBotsDesktop?.windowControls;
  if (!controls) return null;

  return <div className="window-controls" role="group" aria-label={t("Window controls")}>
    <button type="button" className="window-control" aria-label={t("Minimize window")} title={t("Minimize window")} onClick={controls.minimize}><Minus size={15} aria-hidden="true" /></button>
    <button type="button" className="window-control" aria-label={t("Maximize or restore window")} title={t("Maximize or restore window")} onClick={controls.toggleMaximize}><Maximize2 size={14} aria-hidden="true" /></button>
    <button type="button" className="window-control close" aria-label={t("Close window")} title={t("Close window")} onClick={controls.close}><X size={15} aria-hidden="true" /></button>
  </div>;
}
