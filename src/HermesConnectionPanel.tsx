import { useEffect, useRef, useState } from "react";
import { CheckCircle2, KeyRound, Link2, LockKeyhole, RotateCcw, Server, ShieldAlert } from "lucide-react";
import type { AccessRole, BotsApi, HermesAuthProbe, HermesConnection } from "./App";
import { FeedbackState } from "./FeedbackState";
import { FormField } from "./FormField";
import { DEFAULT_LOCAL_HERMES_URL, isHermesReady, isLocalHermesUrl } from "./hermesConnectionUi";
import { useI18n } from "./i18n";

interface HermesConnectionPanelProps {
  api: BotsApi;
  role: AccessRole;
  initialLocalUnavailable?: boolean;
  autoReconnect?: boolean;
  onConnected(): void | Promise<void>;
}

function secureTransport(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || isLocalHermesUrl(value);
  } catch {
    return true;
  }
}

export function HermesConnectionPanel({ api, role, initialLocalUnavailable = false, autoReconnect = false, onConnected }: HermesConnectionPanelProps) {
  const { t, formatError } = useI18n();
  const [connection, setConnection] = useState<HermesConnection | null>(null);
  const [target, setTarget] = useState<"local" | "remote">("local");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [authProbe, setAuthProbe] = useState<HermesAuthProbe | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"test" | "save" | "reset" | "oauth" | "">("");
  const [error, setError] = useState("");
  const [localUnavailable, setLocalUnavailable] = useState(false);
  const [success, setSuccess] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryComplete, setRecoveryComplete] = useState(false);
  const oauthAttempt = useRef(0);
  const supported = Boolean(api.getHermesConnection && api.testHermesConnection && api.updateHermesConnection && api.resetHermesConnection);
  const canManage = supported && role === "admin";
  const recovering = autoReconnect && target === "local" && !loading && !busy && !recoveryComplete && Boolean(api.getDiagnostics);

  useEffect(() => {
    if (!recovering) return;
    let active = true;
    let timer = 0;
    async function check() {
      try {
        const diagnostics = await api.getDiagnostics!();
        if (!active) return;
        if (isHermesReady(diagnostics) && isLocalHermesUrl(diagnostics.hermes.baseUrl)) {
          await onConnected();
          if (active) { setRecoveryError(""); setRecoveryComplete(true); }
          return;
        }
        setRecoveryError(diagnostics.hermes.compatible === false ? t("Hermes version is not supported") : diagnostics.failure ? t(diagnostics.failure.hint) : "");
      } catch {
        if (active) setRecoveryError(t("The connection could not be completed. Retry or open the setup guide below."));
      }
      if (active) timer = window.setTimeout(() => void check(), 4_000);
    }
    timer = window.setTimeout(() => void check(), 4_000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [api, onConnected, recovering, t]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("hermesOauth") === "error") setError(query.get("message") || t("Hermes OAuth sign-in failed."));
    if (query.has("hermesOauth")) {
      query.delete("hermesOauth");
      query.delete("message");
      window.history.replaceState(null, "", `${window.location.pathname}${query.size ? `?${query}` : ""}${window.location.hash}`);
    }
  }, [t]);

  useEffect(() => () => { oauthAttempt.current += 1; }, []);

  useEffect(() => {
    if (!api.getHermesConnection) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    api.getHermesConnection()
      .then((next) => {
        if (!active) return;
        setConnection(next);
        setBaseUrl(next.baseUrl);
        setTarget(next.baseUrl === next.defaultBaseUrl ? "local" : "remote");
      })
      .catch((cause) => active && setError(formatError(cause)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [api, formatError]);

  useEffect(() => {
    const candidate = baseUrl.trim();
    if (target !== "remote" || !api.probeHermesAuth || !/^https?:\/\//i.test(candidate)) {
      setAuthProbe(null);
      setAuthLoading(false);
      return;
    }
    let active = true;
    setAuthProbe(null);
    setAuthLoading(true);
    const timer = window.setTimeout(() => {
      api.probeHermesAuth!({ baseUrl: candidate })
        .then((next) => { if (active) setAuthProbe(next); })
        .catch((cause) => {
          if (!active) return;
          setAuthProbe({ baseUrl: candidate, reachable: false, authMode: "unknown", nativePkce: false, providers: [], error: formatError(cause) });
        })
        .finally(() => { if (active) setAuthLoading(false); });
    }, 500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, baseUrl, formatError, target]);

  function input() {
    return { baseUrl: baseUrl.trim(), ...(token ? { token } : {}) };
  }

  async function test() {
    if (!api.testHermesConnection) return;
    setBusy("test");
    setError("");
    setSuccess("");
    try {
      const probe = await api.testHermesConnection(input());
      if (connection?.baseUrl === probe.baseUrl) setConnection({ ...connection, version: probe.version, secure: probe.secure });
      setSuccess(t("Connection successful · Hermes {version}", { version: probe.version }));
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!api.updateHermesConnection) return;
    setBusy("save");
    setError("");
    setSuccess("");
    try {
      const next = await api.updateHermesConnection(input());
      setConnection(next);
      setBaseUrl(next.baseUrl);
      setTarget("remote");
      setToken("");
      await onConnected();
      setSuccess(t("Connected to Hermes {version}", { version: next.version || "" }));
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusy("");
    }
  }

  async function reset() {
    if (!api.resetHermesConnection) return;
    setBusy("reset");
    setLocalUnavailable(false);
    setError("");
    setSuccess("");
    setRecoveryError("");
    let restored = false;
    try {
      const next = await api.resetHermesConnection();
      restored = true;
      setConnection(next);
      setBaseUrl(next.baseUrl);
      setTarget("local");
      setToken("");
      await onConnected();
      setRecoveryComplete(true);
      setSuccess(t("Default Hermes gateway restored."));
    } catch (cause) {
      if (!restored) { setLocalUnavailable(true); setError(formatError(cause)); }
      else setRecoveryError(t("The connection could not be completed. Retry or open the setup guide below."));
    } finally {
      setBusy("");
    }
  }

  async function connectWithOAuth() {
    if (!api.startHermesOAuth) return;
    setBusy("oauth");
    setError("");
    setSuccess("");
    try {
      const requestedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
      const { authorizationUrl } = await api.startHermesOAuth({ baseUrl: requestedBaseUrl });
      const attempt = ++oauthAttempt.current;
      window.location.assign(authorizationUrl);
      if (!document.documentElement.dataset.desktop || !api.getHermesConnection) return;

      for (let remaining = 600; remaining > 0 && oauthAttempt.current === attempt; remaining -= 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        if (oauthAttempt.current !== attempt) return;
        try {
          const next = await api.getHermesConnection();
          if (next.baseUrl.replace(/\/+$/, "") !== requestedBaseUrl || next.authMode !== "oauth" || !next.hasToken || next.requiresReauthentication) continue;
          setConnection(next);
          setBaseUrl(next.baseUrl);
          await onConnected();
          setSuccess(t("Connected to Hermes {version}", { version: next.version || "" }));
          setBusy("");
          return;
        } catch {
          // The local Bridge can briefly be unavailable while the browser completes OAuth.
        }
      }
      if (oauthAttempt.current === attempt) {
        setError(t("Hermes OAuth authorization expired or is invalid"));
        setBusy("");
      }
    } catch (cause) {
      setError(formatError(cause));
      setBusy("");
    }
  }

  if (loading) return <FeedbackState tone="loading">{t("Loading Hermes connection…")}</FeedbackState>;
  if (!supported) return <FeedbackState tone="unavailable" icon={<Link2 size={20} />} title={t("Gateway selection unavailable")}>{t("This version of the Bridge cannot manage Hermes gateways.")}</FeedbackState>;

  const detectedAuthMode = api.probeHermesAuth ? authProbe?.authMode : "token";
  const oauthProviderLabel = authProbe?.providers.map((provider) => provider.displayName || provider.name).join(" / ") || "";
  const oauthReady = detectedAuthMode === "oauth" && authProbe?.reachable && authProbe.nativePkce;
  const showTokenForm = detectedAuthMode === "token";
  const localBaseUrl = connection?.defaultBaseUrl || DEFAULT_LOCAL_HERMES_URL;
  const showLocalUnavailable = target === "local" && (initialLocalUnavailable || localUnavailable);

  return <div className="gateway-settings">
    {recovering && <div className="local-gateway-note first-run-waiting" role="status"><RotateCcw size={18} /><span><strong>{t("Waiting for local Hermes…")}</strong><small>{t("ByBots checks the connection automatically every few seconds. Nothing needs to be reconfigured.")}</small></span></div>}
    {target === "local" && recoveryError && <FeedbackState tone="error">{recoveryError}</FeedbackState>}
    {connection && <div className="settings-status"><span className={`machine-dot ${connection.version && !connection.requiresReauthentication ? "connected" : ""}`} /><span><strong>{t("Active gateway")}</strong><small>{connection.baseUrl}{connection.version ? ` · Hermes ${connection.version}` : ""}</small></span><em>{connection.requiresReauthentication ? t("Sign in again") : connection.authMode === "oauth" ? t("OAuth") : connection.source === "saved" ? t("Saved") : t("Default")}</em></div>}
    {connection?.requiresReauthentication && <FeedbackState tone="note" icon={<ShieldAlert size={18} />} title={t("Hermes session expired")}>{t("Sign in again to restore this remote gateway connection.")}</FeedbackState>}

    <div className="gateway-options" role="group" aria-label={t("Connection choices")}>
      <button type="button" aria-pressed={target === "local"} disabled={!canManage || Boolean(busy)} onClick={() => { setTarget("local"); void reset(); }}>
        <Server size={18} /><span><strong>{busy === "reset" ? t("Connecting…") : t("Local Hermes")}</strong><small>{localBaseUrl}</small></span>
      </button>
      <button type="button" aria-pressed={target === "remote"} disabled={!canManage || Boolean(busy)} onClick={() => { setTarget("remote"); setLocalUnavailable(false); if (connection && baseUrl === connection.defaultBaseUrl) setBaseUrl(""); setError(""); setSuccess(""); }}>
        <LockKeyhole size={18} /><span><strong>{t("Remote Hermes")}</strong><small>{t("HTTPS or trusted private network")}</small></span>
      </button>
    </div>

    {target === "local" ? showLocalUnavailable ? <div className="local-gateway-error" role="alert">
      <ShieldAlert size={19} /><div><strong>{t("Local Hermes is not available")}</strong><p>{t("ByBots could not reach Hermes at {url}. Start Hermes on this computer, then try again. The local session is detected automatically; no URL or token is required.", { url: localBaseUrl })}</p><button type="button" disabled={!canManage || Boolean(busy)} onClick={() => void reset()}><RotateCcw size={15} />{busy === "reset" ? t("Connecting…") : t("Retry local connection")}</button></div>
    </div> : <div className="local-gateway-note">
      <CheckCircle2 size={18} /><span><strong>{t("Managed automatically by ByBots")}</strong><small>{t("ByBots uses the private session already shared with the local Bridge.")}</small></span>
    </div> : <form className="gateway-form surface-card" onSubmit={(event) => { event.preventDefault(); if (showTokenForm) void save(); }}>
      <FormField label={t("Gateway URL")}><input type="url" inputMode="url" value={baseUrl} disabled={!canManage || Boolean(busy)} onChange={(event) => { setBaseUrl(event.target.value); setAuthProbe(null); setSuccess(""); }} placeholder="https://hermes.example.com" autoComplete="url" required /></FormField>
      {authLoading && <FeedbackState tone="loading">{t("Checking gateway authentication…")}</FeedbackState>}
      {!authLoading && authProbe && !authProbe.reachable && <FeedbackState tone="error" title={t("Gateway unavailable")}>{authProbe.error || t("Unable to detect the gateway authentication mode.")}</FeedbackState>}
      {!authLoading && authProbe?.reachable && authProbe.authMode === "unknown" && <FeedbackState tone="unavailable" title={t("Authentication not detected")}>{t("This Hermes gateway did not advertise a supported authentication mode.")}</FeedbackState>}
      {!authLoading && authProbe?.reachable && authProbe.authMode === "oauth" && !authProbe.nativePkce && <FeedbackState tone="unavailable" title={t("Native sign-in unavailable")}>{t("Update the remote Hermes gateway to use its native OAuth connection flow.")}</FeedbackState>}
      {api.startHermesOAuth && oauthReady && <><div className="local-gateway-note"><KeyRound size={18} /><span><strong>{t("Hermes OAuth detected")}</strong><small>{oauthProviderLabel ? t("Sign in securely with {provider}.", { provider: oauthProviderLabel }) : t("Sign in securely with your identity provider.")}</small></span></div><div className="gateway-actions">{busy === "oauth" && <button type="button" onClick={() => { oauthAttempt.current += 1; setBusy(""); }}>{t("Cancel")}</button>}<button className="primary" type="button" disabled={!canManage || !secureTransport(baseUrl) || Boolean(busy)} onClick={() => void connectWithOAuth()}><KeyRound size={16} />{busy === "oauth" ? t("Complete sign-in in your browser…") : oauthProviderLabel ? t("Sign in with {provider}", { provider: oauthProviderLabel }) : t("Sign in to Hermes")}</button></div></>}
      {showTokenForm && <>
        <FormField label={t("Hermes session token")} help={t("Remote gateway only. Use the HERMES_DASHBOARD_SESSION_TOKEN configured on the machine that runs Hermes.")}><input type="password" value={token} disabled={!canManage || Boolean(busy)} onChange={(event) => { setToken(event.target.value); setSuccess(""); }} placeholder={connection?.hasToken ? t("Leave blank to keep the current token") : t("Required for gateway access")} autoComplete="off" /></FormField>
      </>}
      {!secureTransport(baseUrl) && <div className="gateway-warning"><ShieldAlert size={18} /><p>{t("This remote gateway uses unencrypted HTTP. Prefer HTTPS or a trusted private tunnel.")}</p></div>}
      {showTokenForm && <div className="gateway-actions">
        <button type="button" disabled={!canManage || !baseUrl.trim() || Boolean(busy)} onClick={() => void test()}><Link2 size={16} />{busy === "test" ? t("Testing…") : t("Test connection")}</button>
        <button className="primary" type="submit" disabled={!canManage || !baseUrl.trim() || Boolean(busy)}><CheckCircle2 size={16} />{busy === "save" ? t("Connecting…") : t("Save and connect")}</button>
      </div>}
    </form>}

    {role !== "admin" && <p className="settings-help">{t("Only administrators can change the Hermes gateway.")}</p>}
    {success && <FeedbackState tone="success" icon={<CheckCircle2 size={16} />}>{success}</FeedbackState>}
    {error && !showLocalUnavailable && <FeedbackState tone="error">{error}</FeedbackState>}
  </div>;
}
