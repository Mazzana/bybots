import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccessRole, BotsApi } from "./App";
import type { GatewayList } from "./gateways";
import { HermesConnectionPanel } from "./HermesConnectionPanel";
import { FeedbackState } from "./FeedbackState";
import { FormField } from "./FormField";
import { SwitchControl } from "./SwitchControl";
import { useI18n } from "./i18n";
import { isLocalHermesUrl } from "./hermesConnectionUi";
import { GatewayStatuses } from "./GatewayStatuses";

export function GatewaysPanel({ api, role, onChanged, onDefaultChanged }: { api: BotsApi; role: AccessRole; onChanged(): void | Promise<void>; onDefaultChanged?(): void | Promise<void> }) {
  const { t, formatError } = useI18n();
  const [data, setData] = useState<GatewayList>({ gateways: [], activity: [] });
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState("");
  const scopedApi = useMemo(() => selected ? api.forGateway?.(selected) : undefined, [api, selected]);
  const refresh = useCallback(async () => { if (api.listGateways) setData(await api.listGateways()); }, [api]);
  const connected = useCallback(async () => { await refresh(); await onChanged(); }, [refresh, onChanged]);
  useEffect(() => {
    if (!api.listGateways || role !== "admin") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await api.listGateways!(); if (active) setData(next); }
      catch (cause) { if (active) setError(formatError(cause)); }
      if (active) timer = setTimeout(() => void poll(), 5_000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [api, role, formatError]);
  if (!api.listGateways || role !== "admin") return null;
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await operation(); await refresh(); } catch (cause) { setError(formatError(cause)); } finally { setBusy(false); }
  };
  const gatewayLabel = (id: string) => data.gateways.find((gateway) => gateway.id === id)?.label || id;
  const defaultUrl = data.gateways.find((gateway) => gateway.id === "primary")?.defaultBaseUrl;
  const localUrl = defaultUrl && isLocalHermesUrl(defaultUrl) ? defaultUrl : undefined;
  const savedLocal = data.gateways.find((gateway) => gateway.baseUrl === localUrl);
  const status = { disabled: "Relay disabled", checking: "Checking relay…", ready: "Relay ready", unavailable: "Relay unavailable — check connection and Hermes version" };
  const activityStatus = { delivering: "Delivering", replied: "Gateway responded", failed: "Delivery not confirmed", "reply-pending": "Waiting to return the reply", uncertain: "Outcome uncertain — check Bot Chat before resending" };
  return <section className="multi-gateway-panel" aria-label={t("Multiple gateways")}>
    <h3>{t("Multiple gateways")}</h3>
    <GatewayStatuses api={api} />
    {api.setRelayPaused && <SwitchControl label={t("Pause all Bot relay")} description={t("Stops new forwards without disconnecting gateways. Already accepted Bot turns may continue.")} checked={Boolean(data.safety?.paused)} disabled={busy || !data.safety} onChange={(event) => void run(() => api.setRelayPaused!(event.target.checked))} />}
    {(data.safety?.journalError || data.safety?.journalFull) && <FeedbackState tone="error">{t("Relay stopped: its safety journal needs attention. No messages will be resent automatically.")}</FeedbackState>}
    {data.safety?.rateLimited && <FeedbackState tone="note">{t("Relay cooling down: at most 30 forwards per 10 minutes across all gateways.")}</FeedbackState>}
    <p className="settings-help">{t("Keep local and remote Hermes connected together. Each Bot keeps its own gateway, credentials and conversations.")}</p>
    <p className="settings-help">{t("Adding a gateway keeps your existing connections. Bot relay is a separate permission, not a connection switch.")}</p>
    <p className="settings-help">{t("The main gateway is selected for new Bots. Changing it does not move existing Bots or disconnect other gateways.")}</p>
    <p className="settings-help">{t("Enable Bot relay on at least two trusted gateways to share their Bot roster and allow message_agent exchanges. Messages and replies cross these gateways; target Bots keep their existing tools and permissions. Keep ByBots running. Do not run another Desktop relay on the same gateways.")}</p>
    <div className="multi-gateway-list">{data.gateways.map((gateway) => <article className="surface-card" key={gateway.id}>
      <div className="multi-gateway-heading"><strong>{gateway.label}</strong><small>{gateway.requiresReauthentication ? t("Sign in again") : gateway.hasToken ? t("Session saved") : t("Connection required")}</small></div>
      <p className="gateway-address">{gateway.baseUrl}</p><small>{t("Relay address")}: <code>@bot@{gateway.id}</code></small>
      <SwitchControl label={t("Allow Bot relay")} description={t(status[gateway.relayStatus])} checked={gateway.relay} disabled={busy || (!gateway.hasToken && !gateway.relay)} onChange={(event) => void run(() => api.setGatewayRelay!(gateway.id, event.target.checked))} />
      <div className="gateway-actions">
        {api.setDefaultGateway && <button type="button" disabled={busy || gateway.isDefault} onClick={() => void run(async () => { await api.setDefaultGateway!(gateway.id); await onDefaultChanged?.(); })}>{gateway.isDefault ? t("Main gateway") : t("Set as main gateway")}</button>}
        <button type="button" disabled={busy} aria-expanded={selected === gateway.id} onClick={() => setSelected(selected === gateway.id ? "" : gateway.id)}>{t("Configure connection")}</button>
        {gateway.id !== "primary" && <button type="button" disabled={busy} onClick={() => setRemoving(gateway.id)}>{t("Remove gateway")}</button>}
      </div>
      {removing === gateway.id && <div role="alert"><p>{t("Remove this connection from ByBots? Bots and conversations on Hermes are not deleted.")}</p><div className="gateway-actions"><button type="button" disabled={busy} onClick={() => setRemoving("")}>{t("Cancel")}</button><button type="button" disabled={busy} onClick={() => void run(async () => { await api.removeGateway!(gateway.id); setRemoving(""); setSelected(""); await onChanged(); })}>{t("Confirm removal")}</button></div></div>}
    </article>)}</div>
    {selected && scopedApi && <HermesConnectionPanel key={selected} api={scopedApi} role={role} additional onConnected={connected} />}
    {localUrl && !savedLocal?.hasToken && <div className="surface-card"><p>{t("Connect local Hermes alongside your other gateways. Its session is detected automatically.")}</p><div className="gateway-actions"><button type="button" disabled={busy} onClick={() => void run(async () => {
      const gateway = savedLocal || await api.addGateway!({ label: t("Local Hermes"), baseUrl: localUrl });
      setSelected(gateway.id);
      await api.forGateway!(gateway.id).updateHermesConnection!({ baseUrl: localUrl });
      await onChanged();
    })}>{t("Connect local Hermes too")}</button></div></div>}
    <form className="gateway-form surface-card" onSubmit={(event) => { event.preventDefault(); void run(async () => { const gateway = await api.addGateway!({ label, baseUrl }); setSelected(gateway.id); setLabel(""); setBaseUrl(""); }); }}>
      <h4>{t("Add a gateway")}</h4>
      <FormField label={t("Gateway name")}><input required maxLength={48} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("Work server")} disabled={busy} /></FormField>
      <FormField label={t("Gateway URL")}><input required type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://hermes.example.com" disabled={busy} /></FormField>
      <div className="gateway-actions"><button type="submit" disabled={busy || !label.trim() || !baseUrl.trim()}>{t("Add and configure")}</button></div>
    </form>
    {data.activity.length > 0 && <div><h4>{t("Recent cross-gateway exchanges")}</h4><p className="settings-help">{t("A gateway response may be a queue acknowledgement, not a completed Bot answer. Message content is not shown here.")}</p><ul className="relay-activity">{data.activity.slice(0, 10).map((item) => <li key={`${item.source}:${item.id}`}><span>{gatewayLabel(item.source)} → {gatewayLabel(item.target)} · {item.profile}</span><small>{t(activityStatus[item.status])}</small></li>)}</ul></div>}
    {error && <FeedbackState tone="error">{error}</FeedbackState>}
  </section>;
}
