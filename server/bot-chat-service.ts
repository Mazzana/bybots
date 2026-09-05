import type { GatewayEvent } from "./hermes-gateway";
import { agentDispatch, updateAgentDispatches, type AgentDispatch } from "./agent-dispatch";
import { hermesFailure, hermesFailureFromUnknown, type HermesFailure } from "./hermes-failure";

const LEGACY_THREAD_TITLE = "Bot Chat";
const NEW_THREAD_TITLE = "New thread";
const THREAD_SOURCE = "byfinity-bots";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  failure?: HermesFailure;
  attribution?: AgentMessageAttribution;
}

export interface AgentMessageIdentity {
  displayName: string;
  profile?: string;
  gatewayId?: string;
  gatewayLabel?: string;
}

export interface AgentMessageAttribution {
  kind: "agent";
  source: "hermes-delivery-prefix";
  sender: AgentMessageIdentity;
  recipient: AgentMessageIdentity;
  status: "delivered";
}

export interface BotConversation {
  bot: string;
  sessionId: string;
  running: boolean;
  messages: ChatMessage[];
  dispatches?: AgentDispatch[];
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
  | { type: "reconnect"; bot: string; threadId: string }
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

// Hermes 0.21 delivers Bot-to-Bot messages as user-role turns so the receiving
// Bot can answer them. The prefix is the stable attribution convention used by
// Hermes Desktop; keep the legacy form so existing canonical chats hydrate too.
const HERMES_AGENT_MESSAGE_RE = /^(?:Message from (?:🤖\s*)?([^:\n(]{1,64}?)(?:\s*\(@([a-z0-9][a-z0-9_-]{0,63})\))?:\s*|\[Message from agent '([^']{1,64})'\]\s*)([\s\S]*)$/u;

export function parseHermesAgentMessage(text: string, recipientProfile: string): Pick<ChatMessage, "text" | "attribution"> | null {
  const match = HERMES_AGENT_MESSAGE_RE.exec(text);
  if (!match) return null;

  const displayName = String(match[1] || match[3] || "Agent").trim();
  const profile = String(match[2] || "").trim();
  return {
    text: String(match[4] || "").trim(),
    attribution: {
      kind: "agent",
      source: "hermes-delivery-prefix",
      sender: {
        displayName,
        ...(profile ? { profile } : {})
      },
      recipient: {
        displayName: recipientProfile,
        profile: recipientProfile
      },
      status: "delivered"
    }
  };
}

export class BotChatService {
  private readonly conversations = new Map<string, LiveConversation>();
  private readonly runtimeSessions = new Map<string, string>();
  private readonly openingConversations = new Map<string, Promise<LiveConversation>>();
  private readonly threadListeners = new Map<string, Set<(event: BotThreadEvent) => void>>();
  private readonly revisions = new Map<string, number>();
  private readonly activityAt = new Map<string, number>();
  private readonly refreshes = new Map<string, Promise<void>>();
  private readonly watchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(private readonly gateway: GatewayPort) {
    this.unsubscribe = gateway.subscribe((event) => this.onGatewayEvent(event));
  }

  close() {
    this.closed = true;
    this.unsubscribe();
    for (const [key, conversation] of this.conversations) {
      this.emit(key, { type: "reconnect", bot: conversation.bot, threadId: conversation.sessionId });
      this.stopWatching(key);
    }
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
    const conversation = await this.openThread(bot, threadId);
    await this.refreshQuietConversation(conversation);
    return this.publicConversation(conversation);
  }

  async watchThread(bot: string, threadId: string, listener: (event: BotThreadEvent) => void): Promise<() => void> {
    const conversation = await this.openThread(bot, threadId);
    if (this.closed) {
      listener({ type: "reconnect", bot, threadId });
      return () => {};
    }
    const key = this.key(bot, conversation.sessionId);
    const listeners = this.threadListeners.get(key) ?? new Set<(event: BotThreadEvent) => void>();
    listeners.add(listener);
    this.threadListeners.set(key, listeners);
    this.scheduleRefresh(key, conversation);
    try {
      listener({ type: "conversation", conversation: this.publicConversation(conversation) });
    } catch (cause) {
      listeners.delete(listener);
      if (listeners.size === 0) this.stopWatching(key);
      throw cause;
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.stopWatching(key);
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
    if (conversation.running) throw new Error("This Bot is already responding");
    const submittedMessage: ChatMessage = { role: "user", text };
    conversation.messages.push(submittedMessage);
    conversation.preview = text;
    conversation.running = true;
    // Publish the submitted turn before Hermes can emit its first token.
    this.emitConversation(conversation);
    try {
      await this.gateway.request("prompt.submit", { session_id: conversation.runtimeId, text });
    } catch (cause) {
      // An RPC rejection does not necessarily produce a message.complete event.
      // Release the composer and tell every watcher why this attempt failed.
      if (conversation.running && conversation.messages.filter((message) => message.role === "user").at(-1) === submittedMessage) {
        const failure = hermesFailureFromUnknown(cause);
        const last = conversation.messages.at(-1);
        if (last?.role === "assistant") last.failure = failure;
        else conversation.messages.push({ role: "assistant", text: "", failure });
        conversation.running = false;
        this.emitConversation(conversation);
      }
      throw cause;
    }
  }

  private stopWatching(key: string) {
    this.threadListeners.delete(key);
    clearTimeout(this.watchTimers.get(key));
    this.watchTimers.delete(key);
  }

  private scheduleRefresh(key: string, conversation: LiveConversation) {
    if (this.closed || this.watchTimers.has(key)) return;
    const timer = setTimeout(async () => {
      try { await this.refreshQuietConversation(conversation); }
      finally {
        this.watchTimers.delete(key);
        if (this.threadListeners.has(key)) this.scheduleRefresh(key, conversation);
      }
    }, 3_000);
    timer.unref?.();
    this.watchTimers.set(key, timer);
  }

  private refreshQuietConversation(conversation: LiveConversation): Promise<void> {
    const key = this.key(conversation.bot, conversation.sessionId);
    if (this.closed || Date.now() - (this.activityAt.get(key) ?? 0) < 3_000) return Promise.resolve();
    const existing = this.refreshes.get(key);
    if (existing) return existing;
    const revision = this.revisions.get(key) ?? 0;
    const refresh = (async () => {
      try {
        // Reattach the live session after a socket reconnect and recover missed
        // history/inflight text. A cached transcript is not a liveness check.
        let snapshot;
        try { snapshot = await this.gateway.request("session.activate", { session_id: conversation.runtimeId }); }
        catch (cause) {
          if ((cause as { code?: number }).code !== 4001) throw cause;
          snapshot = await this.gateway.request("session.resume", { session_id: conversation.sessionId, profile: conversation.bot });
        }
        if (this.closed || this.conversations.get(key) !== conversation || (this.revisions.get(key) ?? 0) !== revision) return;
        if (!Array.isArray(snapshot?.messages) || snapshot.messages_omitted || typeof snapshot.running !== "boolean") return;
        const messages: ChatMessage[] = snapshot.messages.filter((message: any) => message?.role === "user" || message?.role === "assistant")
          .map((message: any) => this.storedMessage(message, conversation.bot, conversation.title));
        const inflight = snapshot.inflight;
        if (inflight && (snapshot.running || inflight.error)) {
          const user = this.messageText(inflight.user);
          if (user && !(messages.at(-1)?.role === "user" && messages.at(-1)?.text === user)) messages.push(this.storedMessage({ role: "user", text: user }, conversation.bot, conversation.title));
          const assistant = this.messageText(inflight.assistant);
          if (assistant || inflight.error) messages.push({ role: "assistant", text: assistant, ...this.storedFailure(inflight) });
        }
        if (typeof snapshot.session_id === "string" && snapshot.session_id !== conversation.runtimeId) {
          this.runtimeSessions.delete(conversation.runtimeId);
          conversation.runtimeId = snapshot.session_id;
          this.runtimeSessions.set(conversation.runtimeId, key);
        }
        const changed = conversation.running !== snapshot.running || JSON.stringify(conversation.messages) !== JSON.stringify(messages);
        conversation.messages = messages; conversation.running = snapshot.running;
        if (changed) this.emitConversation(conversation);
      } catch { /* Keep existing text; the next watched refresh retries without resending. */ }
      finally { this.activityAt.set(key, Date.now()); }
    })().finally(() => this.refreshes.delete(key));
    this.refreshes.set(key, refresh);
    return refresh;
  }

  private async openCanonical(bot: string): Promise<LiveConversation> {
    const cached = [...this.conversations.values()].find((item) => item.bot === bot && item.title === LEGACY_THREAD_TITLE);
    if (cached) return cached;

    return this.openOnce(`canonical\u0000${bot}`, () => this.loadCanonical(bot));
  }

  private async loadCanonical(bot: string): Promise<LiveConversation> {
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

    return this.openOnce(`thread\u0000${this.key(bot, threadId)}`, () => this.loadThread(bot, threadId));
  }

  private async loadThread(bot: string, threadId: string): Promise<LiveConversation> {
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
    const cached = this.conversations.get(this.key(bot, stored.id));
    if (cached) return cached;
    return this.openOnce(`resume\u0000${this.key(bot, stored.id)}`, () => this.loadSession(bot, stored));
  }

  private openOnce(key: string, load: () => Promise<LiveConversation>): Promise<LiveConversation> {
    const pending = this.openingConversations.get(key);
    if (pending) return pending;
    const opening = load().finally(() => this.openingConversations.delete(key));
    this.openingConversations.set(key, opening);
    return opening;
  }

  private async loadSession(bot: string, stored: StoredSession): Promise<LiveConversation> {
    const resumed = await this.gateway.request("session.resume", {
      session_id: stored.resolved_id || stored.id,
      profile: bot
    });
    const title = String(stored.title || NEW_THREAD_TITLE);
    const conversation: LiveConversation = {
      bot,
      sessionId: resumed.stored_session_id || stored.id,
      runtimeId: resumed.session_id,
      title,
      preview: String(stored.preview || ""),
      startedAt: Number(stored.started_at || Date.now()),
      running: Boolean(resumed.running),
      messages: (resumed.messages ?? [])
        .filter((message: any) => message?.role === "user" || message?.role === "assistant")
        .map((message: any) => this.storedMessage(message, bot, title))
    };
    this.cache(conversation);
    return conversation;
  }

  private storedMessage(message: any, bot: string, title: string): ChatMessage {
    const text = this.messageText(message.text ?? message.content);
    const failure = this.storedFailure(message);
    if (title === LEGACY_THREAD_TITLE && message.role === "user") {
      const agentMessage = parseHermesAgentMessage(text, bot);
      if (agentMessage) return { role: "user", ...agentMessage, ...failure };
    }
    return { role: message.role, text, ...failure };
  }

  private cache(conversation: LiveConversation): void {
    const key = this.key(conversation.bot, conversation.sessionId);
    this.conversations.set(key, conversation);
    this.activityAt.set(key, Date.now());
    this.runtimeSessions.set(conversation.runtimeId, key);
  }

  private onGatewayEvent(event: GatewayEvent) {
    if (!event.sessionId) return;
    const key = this.runtimeSessions.get(event.sessionId);
    const conversation = key ? this.conversations.get(key) : undefined;
    if (!conversation) return;
    this.revisions.set(key!, (this.revisions.get(key!) ?? 0) + 1);
    this.activityAt.set(key!, Date.now());

    if (event.type === "message.start") {
      if (conversation.messages.at(-1)?.role === "assistant" && conversation.messages.at(-1)?.text) conversation.messages.push({ role: "assistant", text: "" });
      conversation.running = true;
      this.emitConversation(conversation);
    }

    const dispatch = agentDispatch(event);
    if (dispatch) {
      const previous = conversation.dispatches ?? [];
      const next = updateAgentDispatches(previous, dispatch);
      if (next !== previous) {
        conversation.dispatches = next;
        this.emitConversation(conversation);
      }
      return;
    }

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
      conversation.dispatches = conversation.dispatches?.map((item) => item.status === "started" ? { ...item, status: "unknown" } : item);
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
    const key = this.key(conversation.bot, conversation.sessionId);
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    this.activityAt.set(key, Date.now());
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
      ...(conversation.dispatches?.length ? { dispatches: conversation.dispatches.map((item) => ({ ...item })) } : {}),
      messages: conversation.messages.map((message) => ({
        ...message,
        ...(message.failure ? { failure: { ...message.failure } } : {})
      }))
    };
  }
}
