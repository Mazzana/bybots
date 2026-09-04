export type HermesFailureReason =
  | "provider_auth_or_access"
  | "provider_quota_limit"
  | "provider_rate_limit"
  | "provider_server_error"
  | "context_overflow"
  | "missing_config"
  | "model_unavailable"
  | "runtime_offline"
  | "queued_expired"
  | "delivery_timeout"
  | "target_busy"
  | "agent_blocked"
  | "access_denied"
  | "invalid_request"
  | "unknown";

export type HermesFailureAction = "retry" | "configure" | "wait" | "reconnect" | "none";

export interface HermesFailure {
  reason: HermesFailureReason;
  title: string;
  detail: string;
  hint: string;
  retryable: boolean;
  action: HermesFailureAction;
}

const reasons = new Set<HermesFailureReason>([
  "provider_auth_or_access", "provider_quota_limit", "provider_rate_limit", "provider_server_error",
  "context_overflow", "missing_config", "model_unavailable", "runtime_offline", "queued_expired",
  "delivery_timeout", "target_busy", "agent_blocked", "access_denied", "invalid_request", "unknown"
]);

const presentation: Record<HermesFailureReason, Omit<HermesFailure, "reason" | "detail">> = {
  provider_auth_or_access: { title: "Provider connection required", hint: "Reconnect this profile to its provider in Hermes.", retryable: false, action: "configure" },
  provider_quota_limit: { title: "Provider quota reached", hint: "Check the quota or balance before trying again.", retryable: false, action: "none" },
  provider_rate_limit: { title: "Too many requests", hint: "Wait a moment, then try again.", retryable: true, action: "wait" },
  provider_server_error: { title: "Provider temporarily unavailable", hint: "You can retry without changing the Bot.", retryable: true, action: "retry" },
  context_overflow: { title: "Conversation too long", hint: "Hermes reached the context limit. Try again after recovery.", retryable: true, action: "retry" },
  missing_config: { title: "Incomplete configuration", hint: "Choose a provider and model for this Bot.", retryable: false, action: "configure" },
  model_unavailable: { title: "Model unavailable", hint: "Choose another model configured in Hermes.", retryable: false, action: "configure" },
  runtime_offline: { title: "Hermes is offline", hint: "Restore the runtime connection, then try again.", retryable: true, action: "reconnect" },
  queued_expired: { title: "Queued message expired", hint: "The message was not delivered in time. You can send it again.", retryable: true, action: "retry" },
  delivery_timeout: { title: "Delivery timed out", hint: "The Bot did not respond within the expected time.", retryable: true, action: "retry" },
  target_busy: { title: "Bot already busy", hint: "Wait for its current work to finish, then try again.", retryable: true, action: "wait" },
  agent_blocked: { title: "Bot waiting for input", hint: "Approval or clarification is required before continuing.", retryable: false, action: "none" },
  access_denied: { title: "Action not allowed", hint: "Ask an administrator for a higher access level.", retryable: false, action: "none" },
  invalid_request: { title: "Invalid request", hint: "Correct the fields, then try again.", retryable: false, action: "none" },
  unknown: { title: "Hermes encountered an error", hint: "Try again if the issue appears temporary.", retryable: true, action: "retry" }
};

export function classifyFailureReason(detail: string, supplied?: unknown): HermesFailureReason {
  if (typeof supplied === "string" && reasons.has(supplied as HermesFailureReason)) return supplied as HermesFailureReason;
  const text = detail.toLowerCase();
  if (/no (?:llm |inference |hermes )?provider configured|no access token|missing config/.test(text)) return "missing_config";
  if (/\b401\b|\b403\b|unauthorized|forbidden|authentication|invalid.?api.?key|credentials? (?:are )?(?:invalid|expired)/.test(text)) return "provider_auth_or_access";
  if (/quota|out of funds|insufficient (?:credits?|funds|balance)|payment required|\b402\b|billing/.test(text)) return "provider_quota_limit";
  if (/rate.?limit|too many requests|\b429\b/.test(text)) return "provider_rate_limit";
  if (/context (?:window|length|overflow)|maximum context|too many tokens/.test(text)) return "context_overflow";
  if (/model .*(?:unavailable|not found|invalid)|invalid model/.test(text)) return "model_unavailable";
  if (/econnrefused|runtime.*offline|connection refused|websocket.*(?:closed|unavailable)|hermes (?:health check|gateway connection).*(?:failed|timed out|not report ready)/.test(text)) return "runtime_offline";
  if (/target.*busy|already responding|already.*working/.test(text)) return "target_busy";
  if (/delivery.*timeout|timed out.*deliver/.test(text)) return "delivery_timeout";
  if (/queued?.*expired|expired.*queue/.test(text)) return "queued_expired";
  if (/\bblocked\b|awaiting approval/.test(text)) return "agent_blocked";
  if (/invalid profile name|profile .* already exists|profile name .* reserved|cannot create a profile named|profile archive|archive (?:path )?is required|archive not found|cannot import as|hermes gateway url|valid hermes gateway url|credentials in the hermes gateway url/.test(text)) return "invalid_request";
  if (/provider|gateway|internal server error|\b5\d\d\b/.test(text)) return "provider_server_error";
  return "unknown";
}

export function hermesFailure(detail: string, suppliedReason?: unknown, suppliedRetryable?: unknown): HermesFailure {
  const reason = classifyFailureReason(detail, suppliedReason);
  const base = presentation[reason];
  const retryable = typeof suppliedRetryable === "boolean" && !["provider_auth_or_access", "provider_quota_limit", "missing_config", "model_unavailable", "agent_blocked", "access_denied", "invalid_request"].includes(reason)
    ? suppliedRetryable
    : base.retryable;
  return { reason, detail: detail.trim() || base.title, ...base, retryable };
}

export function hermesFailureFromUnknown(cause: unknown): HermesFailure {
  const record = cause && typeof cause === "object" ? cause as Record<string, any> : {};
  const detail = String(record.message || cause || "Hermes error");
  const data = record.data && typeof record.data === "object" ? record.data : {};
  return hermesFailure(detail, data.reason || record.reason, data.retryable ?? record.retryable);
}

export function failureHttpStatus(reason: HermesFailureReason): number {
  if (reason === "provider_rate_limit" || reason === "provider_quota_limit") return 429;
  if (["runtime_offline", "provider_server_error", "delivery_timeout", "target_busy"].includes(reason)) return 503;
  if (reason === "access_denied") return 403;
  if (reason === "invalid_request") return 400;
  if (["provider_auth_or_access", "missing_config", "model_unavailable", "context_overflow", "agent_blocked"].includes(reason)) return 409;
  return 500;
}
