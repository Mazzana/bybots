import { afterEach, expect, it, vi } from "vitest";
import { BotChatService, type BotThreadEvent } from "../server/bot-chat-service";
import type { GatewayEvent } from "../server/hermes-gateway";

afterEach(() => vi.useRealTimers());
function fixture() {
  let listener!: (event: GatewayEvent) => void;
  const request = vi.fn(async (method: string): Promise<any> => {
    if (method === "session.list") return { sessions: [{ id: "stored", title: "Bot Chat" }] };
    if (method === "session.resume") return { session_id: "runtime", stored_session_id: "stored", messages: [], running: false };
    return { accepted: true };
  });
  const chat = new BotChatService({ request, subscribe: (next) => { listener = next; return vi.fn(); } });
  return { chat, request, emit: (event: GatewayEvent) => listener(event) };
}
it("publishes the user turn and each token while prompt submission is still pending", async () => {
  const { chat, request, emit } = fixture();
  const events: BotThreadEvent[] = [];
  const stop = await chat.watchThread("writer", "stored", (event) => events.push(event));
  let finish!: (value: object) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const sending = chat.sendThreadMessage("writer", "stored", "Hello");
  await Promise.resolve();
  expect(events.at(-1)).toMatchObject({ type: "conversation", conversation: { running: true, messages: [{ role: "user", text: "Hello" }] } });
  emit({ type: "message.delta", sessionId: "runtime", payload: { text: "First" } });
  expect(events.at(-1)).toMatchObject({ type: "delta", text: "First" });
  emit({ type: "message.delta", sessionId: "runtime", payload: { text: " second" } });
  expect((await chat.getThread("writer", "stored")).messages.at(-1)?.text).toBe("First second");
  finish({ accepted: true }); await sending;
  stop(); chat.close();
});
it("reattaches a quiet watched session, recovers missed partial/final text and stops after unwatch", async () => {
  vi.useFakeTimers();
  const { chat, request } = fixture();
  const events: BotThreadEvent[] = [];
  const stop = await chat.watchThread("writer", "stored", (event) => events.push(event));
  request.mockResolvedValueOnce({ session_id: "runtime", messages: [], running: true, inflight: { user: "Hello", assistant: "Partial" } });
  await vi.advanceTimersByTimeAsync(3_000);
  expect(events.at(-1)).toMatchObject({ type: "conversation", conversation: { running: true, messages: [{ role: "user", text: "Hello" }, { role: "assistant", text: "Partial" }] } });
  request.mockResolvedValueOnce({ session_id: "runtime", messages: [{ role: "user", text: "Hello" }, { role: "assistant", text: "Final answer" }], running: false });
  await vi.advanceTimersByTimeAsync(3_000);
  expect(events.at(-1)).toMatchObject({ type: "conversation", conversation: { running: false, messages: expect.arrayContaining([{ role: "assistant", text: "Final answer" }]) } });
  stop(); const count = request.mock.calls.length;
  await vi.advanceTimersByTimeAsync(9_000);
  expect(request).toHaveBeenCalledTimes(count);
  chat.close();
});
it("never overwrites newer streamed text with a late recovery snapshot", async () => {
  vi.useFakeTimers();
  const { chat, request, emit } = fixture();
  const stop = await chat.watchThread("writer", "stored", () => {});
  let finish!: (value: object) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(3_000);
  emit({ type: "message.delta", sessionId: "runtime", payload: { text: "New text" } });
  finish({ messages: [], running: false });
  await vi.advanceTimersByTimeAsync(0);
  expect((await chat.getThread("writer", "stored")).messages.at(-1)?.text).toBe("New text");
  stop(); chat.close();
});
it("asks watchers to reconnect when OAuth replaces the old runtime", async () => {
  const { chat } = fixture();
  const events: BotThreadEvent[] = [];
  await chat.watchThread("writer", "stored", (event) => events.push(event));
  chat.close();
  expect(events.at(-1)).toEqual({ type: "reconnect", bot: "writer", threadId: "stored" });
});
