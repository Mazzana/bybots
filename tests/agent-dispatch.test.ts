import { expect, it, vi } from "vitest";
import { agentDispatch, updateAgentDispatches, type AgentDispatch } from "../server/agent-dispatch";
import { BotChatService } from "../server/bot-chat-service";
import type { GatewayEvent } from "../server/hermes-gateway";

const event = (type = "tool.start", result?: unknown): GatewayEvent => ({
  type, sessionId: "runtime", payload: { tool_id: "call-1", name: "message_agent", args: { target: "@research", message: "private message" }, result }
});

it("normalizes tool identity without retaining message contents or raw diagnostics", () => {
  expect(agentDispatch(event())).toEqual({ id: "call-1", target: "@research", status: "started" });
  expect(agentDispatch(event("tool.complete", { status: "sent", process_id: "secret", detail: "private" })))
    .toEqual({ id: "call-1", target: "@research", status: "dispatched" });
  expect(agentDispatch(event("tool.complete", JSON.stringify({ error: "private diagnostic", reason: "target_busy" }))))
    .toEqual({ id: "call-1", target: "@research", status: "failed" });
});

it("does not infer receipt or success from malformed or unrelated results", () => {
  for (const result of [undefined, "not JSON", [], { status: "delivered" }, { success: true }, "x".repeat(65_537)]) {
    expect(agentDispatch(event("tool.complete", result))?.status).toBe("unknown");
  }
  expect(agentDispatch(event("tool.complete", { status: "sent", error: "refused" }))?.status).toBe("failed");
});

it("ignores malformed events, id-less calls and non-messaging tools", () => {
  for (const payload of [null, [], {}, { ...event().payload, tool_id: "" }, { ...event().payload, name: "terminal" },
    { ...event().payload, args: { target: "\nspoof" } }, { ...event().payload, args: { target: "x".repeat(257) } }]) {
    expect(agentDispatch({ ...event(), payload: payload as any })).toBeNull();
  }
  expect(agentDispatch(event("tool.started"))).toBeNull();
});

it("deduplicates replay, preserves terminal states and rejects changed targets", () => {
  const started = agentDispatch(event())!;
  const done = agentDispatch(event("tool.complete", { status: "sent" }))!;
  const list = updateAgentDispatches([started], done);
  expect(list).toEqual([done]);
  expect(updateAgentDispatches(list, started)).toBe(list);
  expect(updateAgentDispatches(list, done)).toBe(list);
  expect(updateAgentDispatches([started], { ...done, target: "@other" })).toEqual([started]);
  expect(updateAgentDispatches([{ ...started, status: "unknown" }], done)).toEqual([done]);
});

it("bounds retained activity to the last 50 calls", () => {
  let list: AgentDispatch[] = [];
  for (let index = 0; index < 70; index++) list = updateAgentDispatches(list, { id: String(index), target: "ops", status: "dispatched" });
  expect(list).toHaveLength(50);
  expect(list[0].id).toBe("20");
});

async function setup() {
  let emit!: (event: GatewayEvent) => void;
  const chat = new BotChatService({
    subscribe: (listener) => { emit = listener; return () => {}; },
    request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "session.list") return { sessions: [{ id: "stored", title: "Bot Chat" }] };
      if (method === "session.resume") return { session_id: params?.profile === "other" ? "other-runtime" : "runtime", stored_session_id: "stored", messages: [{ role: "assistant", text: "Earlier answer" }] };
      throw new Error(method);
    })
  });
  const observed: any[] = [];
  await chat.watchThread("finance", "stored", (value) => observed.push(value));
  await chat.watchThread("other", "stored", () => {});
  return { chat, emit, observed };
}

it("publishes dispatch snapshots without inserting fake transcript turns or crossing profiles", async () => {
  const { chat, emit, observed } = await setup();
  emit(event());
  emit(event("tool.complete", { status: "sent" }));
  emit(event());
  expect(observed).toHaveLength(3);
  expect(observed[1].conversation.dispatches[0].status).toBe("started");
  expect(observed[2].conversation.dispatches[0].status).toBe("dispatched");
  const current = await chat.getThread("finance", "stored");
  expect(current.messages).toEqual([{ role: "assistant", text: "Earlier answer" }]);
  expect(current.running).toBe(false);
  expect((await chat.getThread("other", "stored")).dispatches).toBeUndefined();
  current.dispatches![0].target = "tampered";
  expect((await chat.getThread("finance", "stored")).dispatches![0].target).toBe("@research");
});

it("handles completion without start and marks missing acknowledgements unknown at turn end", async () => {
  const { chat, emit } = await setup();
  emit(event());
  emit({ type: "message.complete", sessionId: "runtime", payload: { text: "Done" } });
  expect((await chat.getThread("finance", "stored")).dispatches![0].status).toBe("unknown");
  emit(event("tool.complete", { status: "sent" }));
  emit({ ...event("tool.complete", { error: "no access" }), payload: { ...event("tool.complete", { error: "no access" }).payload, tool_id: "call-2" } });
  expect((await chat.getThread("finance", "stored")).dispatches!.map((item) => item.status)).toEqual(["dispatched", "failed"]);
});
