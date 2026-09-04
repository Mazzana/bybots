import { describe, expect, it, vi } from "vitest";
import { BotChatService } from "../server/bot-chat-service";
import { GroupChatService } from "../server/group-chat-service";
import { HermesGatewayError } from "../server/hermes-gateway";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("chat reliability regressions", () => {
  it("clears the running state and publishes a failure when a prompt is rejected", async () => {
    const gateway = {
      subscribe: vi.fn().mockReturnValue(() => undefined),
      request: vi.fn(async (method: string) => {
        if (method === "session.create") return { session_id: "runtime", stored_session_id: "thread" };
        if (method === "session.title") return {};
        throw new HermesGatewayError("Hermes gateway connection closed", { reason: "runtime_offline", retryable: true });
      })
    };
    const chat = new BotChatService(gateway);
    await chat.createThread("finance");
    const events: any[] = [];
    await chat.watchThread("finance", "thread", (event) => events.push(event));

    await expect(chat.sendThreadMessage("finance", "thread", "Hello")).rejects.toThrow("connection closed");
    const conversation = await chat.getThread("finance", "thread");
    expect(conversation.running).toBe(false);
    expect(conversation.messages.at(-1)).toMatchObject({ role: "assistant", failure: { reason: "runtime_offline" } });
    expect(events.at(-1)).toMatchObject({ type: "conversation", conversation });
  });

  it("rejects a second prompt without modifying an in-flight conversation", async () => {
    const accepted = deferred<{}>();
    const gateway = {
      subscribe: vi.fn().mockReturnValue(() => undefined),
      request: vi.fn(async (method: string) => {
        if (method === "session.create") return { session_id: "runtime", stored_session_id: "thread" };
        if (method === "session.title") return {};
        return accepted.promise;
      })
    };
    const chat = new BotChatService(gateway);
    await chat.createThread("finance");
    const first = chat.sendThreadMessage("finance", "thread", "First");
    await vi.waitFor(() => expect(gateway.request).toHaveBeenCalledWith("prompt.submit", expect.anything()));
    const second = chat.sendThreadMessage("finance", "thread", "Second");
    accepted.resolve({});
    await first;
    await expect(second).rejects.toThrow("already responding");
    expect((await chat.getThread("finance", "thread")).messages).toEqual([{ role: "user", text: "First" }]);
  });

  it("shares cold thread hydration so simultaneous sends use the same running guard", async () => {
    const gateway = {
      subscribe: vi.fn().mockReturnValue(() => undefined),
      request: vi.fn(async (method: string) => {
        if (method === "session.list") return { sessions: [{ id: "thread", source: "byfinity-bots" }] };
        if (method === "session.resume") return { session_id: "runtime", stored_session_id: "thread", messages: [] };
        return {};
      })
    };
    const chat = new BotChatService(gateway);
    const results = await Promise.allSettled([
      chat.sendThreadMessage("finance", "thread", "First"),
      chat.sendThreadMessage("finance", "thread", "Second")
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(gateway.request.mock.calls.filter(([method]) => method === "session.resume")).toHaveLength(1);
    expect(gateway.request.mock.calls.filter(([method]) => method === "prompt.submit")).toHaveLength(1);
    expect((await chat.getThread("finance", "thread")).messages).toEqual([{ role: "user", text: "First" }]);
  });

  it("releases failed thread hydration so a later attempt can recover", async () => {
    const gateway = {
      subscribe: vi.fn().mockReturnValue(() => undefined),
      request: vi.fn(async (method: string) => {
        if (method === "session.list") return { sessions: [{ id: "thread", source: "byfinity-bots" }] };
        return { session_id: "runtime", stored_session_id: "thread", messages: [] };
      })
    };
    gateway.request.mockRejectedValueOnce(new Error("offline"));
    const chat = new BotChatService(gateway);
    await expect(chat.getThread("finance", "thread")).rejects.toThrow("offline");
    await expect(chat.getThread("finance", "thread")).resolves.toMatchObject({ sessionId: "thread", running: false });
  });

  function groupHarness(onRequest: (method: string) => Promise<any> | undefined) {
    let listener: (event: any) => void = () => undefined;
    let snapshot: any = { version: 3, rooms: { "id:room": { name: "Team", roomId: "room", members: [{ name: "finance" }, { name: "ops" }], log: [] } } };
    const gateway = {
      subscribe: vi.fn((next: (event: any) => void) => { listener = next; return () => undefined; }),
      request: vi.fn(async (method: string, params: any) => {
        const override = onRequest(method);
        if (override) return override;
        if (method === "profiles.list") return { profiles: [{ name: "default", ui_meta: { "hermes-bots-groups": structuredClone(snapshot) } }] };
        if (method === "profiles.configure") { snapshot = params.ui_meta["hermes-bots-groups"]; return {}; }
        if (method === "session.list") return { sessions: [] };
        if (method === "session.create") return { session_id: "runtime" };
        return {};
      })
    };
    return { service: new GroupChatService(gateway), gateway, emit: (event: any) => listener(event) };
  }

  it("does not submit a group prompt after stop while session creation is pending", async () => {
    const created = deferred<{ session_id: string }>();
    const { service, gateway } = groupHarness((method) => method === "session.create" ? created.promise : undefined);
    const sending = service.sendMessage("room", "Hello");
    await vi.waitFor(() => expect(gateway.request).toHaveBeenCalledWith("session.create", expect.anything()));
    await service.stop("room");
    created.resolve({ session_id: "runtime" });
    await sending;
    expect(gateway.request.mock.calls.filter(([method]) => method === "prompt.submit")).toHaveLength(0);
    expect((await service.listGroups())[0]).toMatchObject({ running: false, protocol: { status: "stopped" } });
  });

  it("ignores completion events while stop is awaiting the interrupt response", async () => {
    const interrupted = deferred<{}>();
    const { service, gateway, emit } = groupHarness((method) => method === "session.interrupt" ? interrupted.promise : undefined);
    await service.sendMessage("room", "Hello");
    const stopping = service.stop("room");
    await vi.waitFor(() => expect(gateway.request).toHaveBeenCalledWith("session.interrupt", expect.anything()));
    emit({ type: "message.complete", sessionId: "runtime", payload: { text: "Late answer" } });
    // Drain async completion processing without resolving the interrupt request.
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    interrupted.resolve({});
    await stopping;
    expect(gateway.request.mock.calls.filter(([method]) => method === "prompt.submit")).toHaveLength(1);
    expect((await service.listGroups())[0].messages.map((message) => message.text)).toEqual(["Hello"]);
  });
});
