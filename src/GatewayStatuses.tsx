import { useEffect, useState } from "react";
import type { BotsApi } from "./App";
import type { GatewayStatus } from "./gateways";
import { useI18n } from "./i18n";

export function GatewayStatusLabel({ status }: { status: GatewayStatus["status"] }) {
  const { t } = useI18n();
  return <span className={`gateway-status ${status}`}><i aria-hidden="true" />{status === "connected" ? t("Connected") : status === "auth-required" ? t("Connection required") : status === "unavailable" ? t("Unavailable") : t("Checking connection…")}</span>;
}

export function GatewayStatuses({ api, onOpen }: { api: BotsApi; onOpen?(): void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<GatewayStatus[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!api.getGatewayStatuses) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await api.getGatewayStatuses!();
        if (!Array.isArray(result.gateways)) throw new Error("Invalid gateway status");
        if (active) { setRows(result.gateways); setFailed(false); }
      } catch { if (active) setFailed(true); }
      if (active) timer = setTimeout(() => void refresh(), 20_000);
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [api]);
  if (!api.getGatewayStatuses) return null;
  return <div className="sidebar-gateways" aria-label={t("Gateway connections")}>
    {rows.map((row) => onOpen ? <button key={row.id} type="button" onClick={onOpen}><span className="gateway-name" title={row.label}>{row.label}</span><GatewayStatusLabel status={failed ? "unavailable" : row.status} /></button> : <div className="gateway-status-row" key={row.id}><span className="gateway-name" title={row.label}>{row.label}</span><GatewayStatusLabel status={failed ? "unavailable" : row.status} /></div>)}
    {!rows.length && <small role="status">{failed ? t("Status unavailable") : t("Checking connection…")}</small>}
  </div>;
}
