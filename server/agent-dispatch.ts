import type { GatewayEvent } from "./hermes-gateway";

export interface AgentDispatch {
  id: string;
  target: string;
  status: "started" | "dispatched" | "failed" | "unknown";
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Tool acknowledgements describe dispatch, never confirmed receipt or gateway identity. */
export function agentDispatch(event: GatewayEvent): AgentDispatch | null {
  if (event.type !== "tool.start" && event.type !== "tool.complete") return null;
  const payload = record(event.payload);
  if (!payload || payload.name !== "message_agent") return null;
  const id = payload.tool_id;
  const target = record(payload.args)?.target;
  if (typeof id !== "string" || !id.trim() || id.length > 256 || typeof target !== "string"
    || !target.trim() || target.length > 256 || /[\u0000-\u001f\u007f]/u.test(id + target)) return null;
  if (event.type === "tool.start") return { id, target: target.trim(), status: "started" };

  let result = payload.result;
  if (typeof result === "string" && result.length <= 65_536) {
    try { result = JSON.parse(result); } catch { result = null; }
  }
  const ack = record(result);
  const status = ack?.error || payload.is_error === true ? "failed"
    : ack?.status === "sent" ? "dispatched" : "unknown";
  return { id, target: target.trim(), status };
}

export function updateAgentDispatches(current: AgentDispatch[], incoming: AgentDispatch): AgentDispatch[] {
  const previous = current.find((item) => item.id === incoming.id);
  // Replayed starts cannot revert an acknowledgement; conflicting identities are ignored.
  if (previous && (previous.target !== incoming.target || incoming.status === "started"
    || previous.status === "dispatched" || previous.status === "failed")) return current;
  return [...current.filter((item) => item.id !== incoming.id), incoming].slice(-50);
}
