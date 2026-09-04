import type { GatewayEvent } from "./hermes-gateway";
import { hermesFailure, type HermesFailure } from "./hermes-failure";

const LEGACY_THREAD_TITLE = "Bot Chat";
const NEW_THREAD_TITLE = "New thread";
const THREAD_SOURCE = "byfinity-bots";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  failure?: HermesFailure;
}

export interface BotConversation {
  bot: string;
  sessionId: string;
  running: boolean;
  messages: ChatMessage[];
}

export interface BotThreadSummary {
  id: string;
  bot: string;
  title: string;
  preview: string;
  startedAt: number;
  messageCount: number;
  running: boolean;
}

export type BotThreadEvent =
  | { type: "conversation"; conversation: BotConversation }
  | { type: "delta"; bot: string; threadId: string; text: string }
  | { type: "archived"; bot: string; threadId: string };

interface GatewayPort {
  request(method: string, params?: Record<string, unknown>): Promise<any>;
  subscribe(listener: (event: GatewayEvent) => void): () => void;
  patchSession?(profile: string, sessionId: string, fields: Record<string, unknown>): Promise<unknown>;
}

interface LiveConversation extends BotConversation {
  runtimeId: string;
  title: string;
  preview: string;
  startedAt: number;
}

interface StoredSession {
  id: string;
  resolved_id?: string;
  title?: string;
  preview?: string;
  started_at?: number;
  message_count?: number;
  source?: string;
}

export class BotChatService {
  private readonly conversations = new Map<string, LiveConversation>();
  private readonly runtimeSessions = new Map<string, string>();
  private readonly threadListeners = new Map<string, Set<(event: BotThreadEvent) => void>>();

  constructor(private readonly gateway: GatewayPort) {
    gateway.subscribe((event) => this.onGatewayEvent(event));
  }

  async listThreads(bot: string): Promise<BotThreadSummary[]> {
    const listed = await this.gateway.request("session.list", {
      profile: bot,
      limit: 200,
      include_hidden: true
    });
    const stored: BotThreadSummary[] = (listed.sessions ?? [])
      .filter((session: StoredSession) => this.isOwnedSession(session))
      .map((session: StoredSession) => this.storedSummary(bot, session));
    const merged = new Map<string, BotThreadSummary>(stored.map((thread) => [thread.id, thread]));

    for (const conversation of this.conversations.values()) {
      if (conversation.bot !== bot) continue;
      merged.set(conversation.sessionId, this.liveSummary(conversation));
    }

    // Hermes already returns session.list by most recent activity. Preserve
    // that order: sorting again by creation time would reopen a newer but
    // inactive thread instead of the thread the user actually used last.
    return [...merged.values()];
  }

  async createThread(bot: string, title = NEW_THREAD_TITLE): Promise<BotConversation> {
    const normalizedTitle = title.trim() || NEW_THREAD_TITLE;
    const created = await this.gateway.request("session.create", {
      profile: bot,
      title: normalizedTitle,
      source: THREAD_SOURCE,
      hidden: true,
      follow_profile_config: true
    });
    await this.gateway.request("session.title", { session_id: created.session_id, title: normalizedTitle });
    const conversation: LiveConversation = {
      bot,
      sessionId: created.stored_session_id,
      runtimeId: created.session_id,
      title: normalizedTitle,
      preview: "",
      startedAt: Date.now(),
      running: false,
      messages: []
    };
    this.cache(conversation);
    return this.publicConversation(conversation);
  }

  async getThread(bot: string, threadId: string): Promise<BotConversation> {
    return this.publicConversation(await this.openThread(bot, threadId));
  }

  async watchThread(bot: string, threadId: string, listener: (event: BotThreadEvent) => void): Promise<() => void> {
    const conversation = await this.openThread(bot, threadId);
    const key = this.key(bot, conversation.sessionId);
    const listeners = this.threadListeners.get(key) ?? new Set<(event: BotThreadEvent) => void>();
    listeners.add(listener);
    this.threadListeners.set(key, listeners);
    try {
      listener({ type: "conversation", conversation: this.publicConversation(conversation) });
    } catch (cause) {
      listeners.delete(listener);
      if (listeners.size === 0) this.threadListeners.delete(key);
      throw cause;
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.threadListeners.delete(key);
    };
  }

  async sendThreadMessage(bot: string, threadId: string, text: string): Promise<BotConversation> {
    const conversation = await this.openThread(bot, threadId);
    await this.submit(conversation, text);
    return this.publicConversation(conversation);
  }

  async renameThread(bot: string, threadId: string, title: string): Promise<BotThreadSummary> {
    const conversation = await this.openThread(bot, threadId);
    await this.gateway.request("session.title", { session_id: conversation.runtimeId, title });
    conversation.title = title;
    return this.liveSummary(conversation);
  }

  async archiveThread(bot: string, threadId: string): Promise<void> {
    if (!this.gateway.patchSession) throw new Error("This Hermes runtime cannot archive sessions");
    const conversation = await this.openThread(bot, threadId);
    if (conversation.running) throw new Error("Wait for the current response before archiving this thread");
    await this.gateway.request("session.close", { session_id: conversation.runtimeId });
    await this.gateway.patchSession(bot, conversation.sessionId, { archived: true });
    this.emit(this.key(bot, conversation.sessionId), { type: "archived", bot, threadId: conversation.sessionId });
    this.conversations.delete(this.key(bot, conversation.sessionId));
    this.runtimeSessions.delete(conversation.runtimeId);
  }

  /** Compatibility entrypoint for clients that still expect one canonical thread per Bot. */
  async getConversation(bot: string): Promise<BotConversation> {
    return this.publicConversation(await this.openCanonical(bot));
  }

  /** Compatibility entrypoint for clients that still expect one canonical thread per Bot. */
  async sendMessage(bot: string, text: string): Promise<BotConversation> {
    const conversation = await this.openCanonical(bot);
    await this.submit(conversation, text);
    return this.publicConversation(conversation);
  }

  private async submit(conversation: LiveConversation, text: string): Promise<void> {
    conversation.messages.push({ role: "user", text });
    conversation.preview = text;
    conversation.running = true;
    await this.gateway.request("prompt.submit", { session_id: conversation.runtimeId, text });
    this.emitConversation(conversation);
  }

  private async openCanonical(bot: string): Promise<LiveConversation> {
    const cached = [...this.conversations.values()].find((item) => item.bot === bot && item.title === LEGACY_THREAD_TITLE);
    if (cached) return cached;

    const listed = await this.gateway.request("session.list", {
      profile: bot,
      title: LEGACY_THREAD_TITLE,
      limit: 1,
      include_hidden: true
    });
    const stored = listed.sessions?.[0] as StoredSession | undefined;
    if (stored?.id) return this.resume(bot, { ...stored, title: stored.title || LEGACY_THREAD_TITLE });

    const created = await this.createThread(bot, LEGACY_THREAD_TITLE);
    return this.conversations.get(this.key(bot, created.sessionId))!;
  }

  private async openThread(bot: string, threadId: string): Promise<LiveConversation> {
    const cached = this.conversations.get(this.key(bot, threadId));
    if (cached) return cached;

    const threads = await this.listThreads(bot);
    const thread = threads.find((item) => item.id === threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return this.resume(bot, {
      id: thread.id,
      title: thread.title,
      preview: thread.preview,
      started_at: thread.startedAt,
      message_count: thread.messageCount,
      source: THREAD_SOURCE
    });
  }

  private async resume(bot: string, stored: StoredSession): Promise<LiveConversation> {
    const resumed = await this.gateway.request("session.resume", {
      session_id: stored.resolved_id || stored.id,
      profile: bot
    });
    const conversation: LiveConversation = {
      bot,
      sessionId: resumed.stored_session_id || stored.id,
      runtimeId: resumed.session_id,
      title: String(stored.title || NEW_THREAD_TITLE),
      preview: String(stored.preview || ""),
      startedAt: Number(stored.started_at || Date.now()),
      running: Boolean(resumed.running),
      messages: (resumed.messages ?? [])
        .filter((message: any) => message?.role === "user" || message?.role === "assistant")
        .map((message: any) => ({
          role: message.role,
          text: this.messageText(message.text ?? message.content),
          ...this.storedFailure(message)
        }))
    };
    this.cache(conversation);
    return conversation;
  }

  private cache(conversation: LiveConversation): void {
    const key = this.key(conversation.bot, conversation.sessionId);
    this.conversations.set(key, conversation);
    this.runtimeSessions.set(conversation.runtimeId, key);
  }

  private onGatewayEvent(event: GatewayEvent) {
    if (!event.sessionId) return;
    const key = this.runtimeSessions.get(event.sessionId);
    const conversation = key ? this.conversations.get(key) : undefined;
    if (!conversation) return;

    if (event.type === "message.delta") {
      const delta = String(event.payload.text ?? event.payload.delta ?? "");
      const last = conversation.messages.at(-1);
      if (last?.role === "assistant") last.text += delta;
      else conversation.messages.push({ role: "assistant", text: delta });
      conversation.preview = conversation.messages.at(-1)?.text || conversation.preview;
      conversation.running = true;
      this.emit(this.key(conversation.bot, conversation.sessionId), {
        type: "delta",
        bot: conversation.bot,
        threadId: conversation.sessionId,
        text: delta
      });
    }

    if (event.type === "message.complete") {
      const text = String(event.payload.text ?? "");
      const last = conversation.messages.at(-1);
      const failed = event.payload.status === "error" || Boolean(event.payload.error);
      if (failed) {
        const detail = String(event.payload.error || text || "Hermes reported an error");
        const surface = event.payload.error_surface && typeof event.payload.error_surface === "object"
          ? event.payload.error_surface as Record<string, unknown>
          : {};
        const failure = hermesFailure(detail, event.payload.failure_reason, surface.retryable ?? event.payload.recoverable);
        const partial = Boolean(event.payload.partial);
        if (last?.role === "assistant") {
          if (partial && text) last.text = text;
          else if (!last.text && text !== detail) last.text = text;
          last.failure = failure;
        } else {
          conversation.messages.push({ role: "assistant", text: partial ? text : "", failure });
        }
      } else if (last?.role === "assistant") last.text = text || last.text;
      else if (text) conversation.messages.push({ role: "assistant", text });
      conversation.preview = conversation.messages.at(-1)?.text || conversation.preview;
      conversation.running = false;
      this.emitConversation(conversation);
    }
  }

  private emitConversation(conversation: LiveConversation): void {
    this.emit(this.key(conversation.bot, conversation.sessionId), {
      type: "conversation",
      conversation: this.publicConversation(conversation)
    });
  }

  private emit(key: string, event: BotThreadEvent): void {
    for (const listener of this.threadListeners.get(key) ?? []) {
      try {
        listener(event);
      } catch {
        // One broken stream must not block updates to the remaining listeners.
      }
    }
  }

  private isOwnedSession(session: StoredSession): boolean {
    return String(session.source || "").toLowerCase() === THREAD_SOURCE || session.title === LEGACY_THREAD_TITLE;
  }

  private storedSummary(bot: string, session: StoredSession): BotThreadSummary {
    return {
      id: session.id,
      bot,
      title: String(session.title || NEW_THREAD_TITLE),
      preview: String(session.preview || ""),
      startedAt: Number(session.started_at || 0),
      messageCount: Number(session.message_count || 0),
      running: false
    };
  }

  private liveSummary(conversation: LiveConversation): BotThreadSummary {
    return {
      id: conversation.sessionId,
      bot: conversation.bot,
      title: conversation.title,
      preview: conversation.preview || conversation.messages.at(-1)?.text || "",
      startedAt: conversation.startedAt,
      messageCount: conversation.messages.length,
      running: conversation.running
    };
  }

  private key(bot: string, threadId: string): string {
    return `${bot}\u0000${threadId}`;
  }

  private messageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((part) => typeof part === "string" ? part : String(part?.text ?? "")).join("");
    }
    return "";
  }

  private storedFailure(message: any): { failure?: HermesFailure } {
    const detail = String(message?.error || "").trim();
    if (!detail && !message?.failure_reason) return {};
    return { failure: hermesFailure(detail || this.messageText(message?.text ?? message?.content), message.failure_reason, message?.error_surface?.retryable ?? message?.recoverable) };
  }

  private publicConversation(conversation: LiveConversation): BotConversation {
    return {
      bot: conversation.bot,
      sessionId: conversation.sessionId,
      running: conversation.running,
      messages: conversation.messages.map((message) => ({
        ...message,
        ...(message.failure ? { failure: { ...message.failure } } : {})
      }))
    };
  }
}
