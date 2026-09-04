import { describe, expect, it, vi } from "vitest";
import { BotChatService, parseHermesAgentMessage } from "../server/bot-chat-service";

describe("BotChatService", () => {
  it("parses current and legacy Hermes Bot-to-Bot delivery prefixes", () => {
    expect(parseHermesAgentMessage("Message from 🤖 Research Lead (@research): Verify this source", "finance")).toEqual({
      text: "Verify this source",
      attribution: {
        kind: "agent",
        source: "hermes-delivery-prefix",
        sender: { displayName: "Research Lead", profile: "research" },
        recipient: { displayName: "finance", profile: "finance" },
        status: "delivered"
      }
    });
    expect(parseHermesAgentMessage("[Message from agent 'ops'] Check deployment", "finance")).toMatchObject({
      text: "Check deployment",
      attribution: { sender: { displayName: "ops" }, recipient: { profile: "finance" } }
    });
    expect(parseHermesAgentMessage("I received a message from another Bot", "finance")).toBeNull();
  });

  it("lists only Byfinity-owned Hermes threads and keeps the legacy canonical chat", async () => {
    const gateway = {
      subscribe: vi.fn().mockReturnValue(() => undefined),
      request: vi.fn().mockResolvedValue({
        sessions: [
          { id: "thread-1", title: "Budget", preview: "Used most recently", started_at: 10, message_count: 6, source: "byfinity-bots" },
          { id: "thread-2", title: "Quarterly report", preview: "Ready", started_at: 20, message_count: 4, source: "byfinity-bots" },
          { id: "foreign", title: "Hermes CLI", source: "tui" },
          { id: "legacy", title: "Bot Chat", preview: "Legacy", started_at: 5, message_count: 2, source: "tui" }
        ]
      })
    };
    const chat = new BotChatService(gateway);

    await expect(chat.listThreads("finance")).resolves.toEqual([
      { id: "thread-1", bot: "finance", title: "Budget", preview: "Used most recently", startedAt: 10, messageCount: 6, running: false },
      { id: "thread-2", bot: "finance", title: "Quarterly report", preview: "Ready", startedAt: 20, messageCount: 4, running: false },
      { id: "legacy", bot: "finance", title: "Bot Chat", preview: "Legacy", startedAt: 5, messageCount: 2, running: false }
    ]);
    expect(gateway.request).toHaveBeenCalledWith("session.list", { profile: "finance", limit: 200, include_hidden: true });
  });

  it("creates, renames and archives a native Hermes thread", async () => {
    const gateway = {
      subscribe: vi.fn().mockReturnValue(() => undefined),
      patchSession: vi.fn().mockResolvedValue({ session: { archived: true } }),
      request: vi.fn(async (method: string) => {
        if (method === "session.create") return { session_id: "runtime-new", stored_session_id: "stored-new" };
        if (method === "session.title" || method === "session.close") return { ok: true };
        throw new Error(`unexpected ${method}`);
      })
    };
    const chat = new BotChatService(gateway);

    const created = await chat.createThread("research", "Sources");
    const renamed = await chat.renameThread("research", created.sessionId, "Verified sources");
    await chat.archiveThread("research", created.sessionId);

    expect(created).toMatchObject({ bot: "research", sessionId: "stored-new", running: false, messages: [] });
    expect(renamed).toMatchObject({ id: "stored-new", title: "Verified sources" });
    expect(gateway.request).toHaveBeenCalledWith("session.create", expect.objectContaining({ profile: "research", source: "byfinity-bots", hidden: true }));
    expect(gateway.request).toHaveBeenCalledWith("session.close", { session_id: "runtime-new" });
    expect(gateway.patchSession).toHaveBeenCalledWith("research", "stored-new", { archived: true });
  });

  it("opens the bot canonical conversation and returns its transcript", async () => {
    const gateway = {
      subscribe: vi.fn().mockReturnValue(() => undefined),
      request: vi.fn(async (method: string) => {
        if (method === "session.list") return { sessions: [{ id: "stored-1", title: "Bot Chat" }] };
        if (method === "session.resume") return {
          session_id: "runtime-1",
          stored_session_id: "stored-1",
          messages: [
            { role: "user", text: "Bonjour" },
            { role: "assistant", text: "Bonjour Ruben" }
          ]
        };
        throw new Error(`unexpected ${method}`);
      })
    };
    const chat = new BotChatService(gateway);

    await expect(chat.getConversation("finance")).resolves.toEqual({
      bot: "finance",
      sessionId: "stored-1",
      running: false,
      messages: [
        { role: "user", text: "Bonjour" },
        { role: "assistant", text: "Bonjour Ruben" }
      ]
    });
    expect(gateway.request).toHaveBeenCalledWith("session.list", expect.objectContaining({ profile: "finance", title: "Bot Chat" }));
    expect(gateway.request).toHaveBeenCalledWith("session.resume", { session_id: "stored-1", profile: "finance" });
  });

  it("adds structured attribution to Hermes agent deliveries only in the canonical Bot Chat", async () => {
    const gateway = {
      subscribe: vi.fn().mockReturnValue(() => undefined),
      request: vi.fn(async (method: string) => {
        if (method === "session.list") return { sessions: [{ id: "stored-1", title: "Bot Chat" }] };
        if (method === "session.resume") return {
          session_id: "runtime-1",
          stored_session_id: "stored-1",
          messages: [
            { role: "user", text: "Message from 🤖 Research Lead (@research): Verify this source" },
            { role: "assistant", text: "Verified." }
          ]
        };
        throw new Error(`unexpected ${method}`);
      })
    };
    const chat = new BotChatService(gateway);

    await expect(chat.getConversation("finance")).resolves.toMatchObject({
      messages: [
        {
          role: "user",
          text: "Verify this source",
          attribution: {
            kind: "agent",
            sender: { displayName: "Research Lead", profile: "research" },
            recipient: { profile: "finance" },
            status: "delivered"
          }
        },
        { role: "assistant", text: "Verified." }
      ]
    });
  });

  it("does not reinterpret an ordinary ByBots thread containing an agent-like prefix", async () => {
    const gateway = {
      subscribe: vi.fn().mockReturnValue(() => undefined),
      request: vi.fn(async (method: string) => {
        if (method === "session.list") return { sessions: [{ id: "stored-1", title: "Notes", source: "byfinity-bots" }] };
        if (method === "session.resume") return {
          session_id: "runtime-1",
          stored_session_id: "stored-1",
          messages: [{ role: "user", text: "Message from 🤖 Research (@research): quoted example" }]
        };
        throw new Error(`unexpected ${method}`);
      })
    };
    const chat = new BotChatService(gateway);

    await expect(chat.getThread("finance", "stored-1")).resolves.toMatchObject({
      messages: [{ role: "user", text: "Message from 🤖 Research (@research): quoted example" }]
    });
  });

  it("creates a canonical chat before sending the first message", async () => {
    const gateway = {
      subscribe: vi.fn().mockReturnValue(() => undefined),
      request: vi.fn(async (method: string) => {
        if (method === "session.list") return { sessions: [] };
        if (method === "session.create") return { session_id: "runtime-new", stored_session_id: "stored-new" };
        if (method === "session.title") return { ok: true };
        if (method === "prompt.submit") return { accepted: true };
        throw new Error(`unexpected ${method}`);
      })
    };
    const chat = new BotChatService(gateway);

    const conversation = await chat.sendMessage("research", "Analyse ce document");

    expect(conversation).toMatchObject({ bot: "research", sessionId: "stored-new", running: true });
    expect(conversation.messages).toEqual([{ role: "user", text: "Analyse ce document" }]);
    expect(gateway.request).toHaveBeenCalledWith("session.create", expect.objectContaining({ profile: "research", title: "Bot Chat", hidden: true }));
    expect(gateway.request).toHaveBeenCalledWith("session.title", { session_id: "runtime-new", title: "Bot Chat" });
    expect(gateway.request).toHaveBeenCalledWith("prompt.submit", { session_id: "runtime-new", text: "Analyse ce document" });
  });

  it("updates the transcript from streaming gateway events", async () => {
    let listener: ((event: any) => void) | undefined;
    const gateway = {
      subscribe: vi.fn((next: (event: any) => void) => { listener = next; return () => undefined; }),
      request: vi.fn(async (method: string) => {
        if (method === "session.list") return { sessions: [{ id: "stored-1" }] };
        if (method === "session.resume") return { session_id: "runtime-1", stored_session_id: "stored-1", messages: [] };
        if (method === "prompt.submit") return { accepted: true };
        throw new Error(`unexpected ${method}`);
      })
    };
    const chat = new BotChatService(gateway);
    await chat.sendMessage("finance", "Bonjour");

    listener?.({ type: "message.delta", sessionId: "runtime-1", payload: { text: "Bon" } });
    listener?.({ type: "message.complete", sessionId: "runtime-1", payload: { text: "Bonjour Ruben" } });

    await expect(chat.getConversation("finance")).resolves.toMatchObject({
      running: false,
      messages: [
        { role: "user", text: "Bonjour" },
        { role: "assistant", text: "Bonjour Ruben" }
      ]
    });
  });

  it("publishes scoped conversation snapshots to thread watchers", async () => {
    let gatewayListener: ((event: any) => void) | undefined;
    const gateway = {
      subscribe: vi.fn((next: (event: any) => void) => { gatewayListener = next; return () => undefined; }),
      request: vi.fn(async (method: string) => {
        if (method === "session.list") return { sessions: [{ id: "stored-1", title: "Report", source: "byfinity-bots" }] };
        if (method === "session.resume") return { session_id: "runtime-1", stored_session_id: "stored-1", messages: [] };
        if (method === "prompt.submit") return { accepted: true };
        throw new Error(`unexpected ${method}`);
      })
    };
    const chat = new BotChatService(gateway);
    const events: any[] = [];
    const unsubscribe = await chat.watchThread("finance", "stored-1", (event) => events.push(event));

    await chat.sendThreadMessage("finance", "stored-1", "Prepare the report");
    gatewayListener?.({ type: "message.delta", sessionId: "runtime-1", payload: { text: "Ready" } });
    unsubscribe();
    gatewayListener?.({ type: "message.complete", sessionId: "runtime-1", payload: { text: "Ready now" } });

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: "conversation", conversation: { sessionId: "stored-1", running: false, messages: [] } });
    expect(events[1]).toMatchObject({ type: "conversation", conversation: { running: true, messages: [{ role: "user", text: "Prepare the report" }] } });
    expect(events[2]).toEqual({ type: "delta", bot: "finance", threadId: "stored-1", text: "Ready" });
  });

  it("isolates a broken thread watcher from the remaining listeners", async () => {
    let gatewayListener: ((event: any) => void) | undefined;
    const gateway = {
      subscribe: vi.fn((next: (event: any) => void) => { gatewayListener = next; return () => undefined; }),
      request: vi.fn(async (method: string) => {
        if (method === "session.list") return { sessions: [{ id: "stored-1", title: "Report", source: "byfinity-bots" }] };
        if (method === "session.resume") return { session_id: "runtime-1", stored_session_id: "stored-1", messages: [] };
        throw new Error(`unexpected ${method}`);
      })
    };
    const chat = new BotChatService(gateway);
    await chat.watchThread("finance", "stored-1", () => undefined);
    await chat.watchThread("finance", "stored-1", (event) => {
      if (event.type === "delta") throw new Error("closed stream");
    });
    const delivered: unknown[] = [];
    await chat.watchThread("finance", "stored-1", (event) => delivered.push(event));

    gatewayListener?.({ type: "message.delta", sessionId: "runtime-1", payload: { text: "Ready" } });

    expect(delivered.at(-1)).toEqual({ type: "delta", bot: "finance", threadId: "stored-1", text: "Ready" });
  });

  it("preserves typed Hermes terminal failures and their recovery action", async () => {
    let listener: ((event: any) => void) | undefined;
    const gateway = {
      subscribe: vi.fn((next: (event: any) => void) => { listener = next; return () => undefined; }),
      request: vi.fn(async (method: string) => {
        if (method === "session.list") return { sessions: [{ id: "stored-1" }] };
        if (method === "session.resume") return { session_id: "runtime-1", stored_session_id: "stored-1", messages: [] };
        if (method === "prompt.submit") return { accepted: true };
        throw new Error(`unexpected ${method}`);
      })
    };
    const chat = new BotChatService(gateway);
    await chat.sendMessage("finance", "Prépare le rapport");

    listener?.({
      type: "message.complete",
      sessionId: "runtime-1",
      payload: { status: "error", error: "401 invalid API key", failure_reason: "provider_auth_or_access", recoverable: false }
    });

    await expect(chat.getConversation("finance")).resolves.toMatchObject({
      running: false,
      messages: [
        { role: "user", text: "Prépare le rapport" },
        { role: "assistant", text: "", failure: { reason: "provider_auth_or_access", retryable: false, action: "configure" } }
      ]
    });
  });
});
