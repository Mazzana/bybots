import { randomUUID } from "node:crypto";
import type { GatewayEvent } from "./hermes-gateway";
import { hermesFailure, hermesFailureFromUnknown, type HermesFailure } from "./hermes-failure";

const BOT_META_KEY = "hermes-bots";
const GROUPS_META_KEY = "hermes-bots-groups";
const GROUP_MAX_ROUNDS = 3;
const GROUP_MAX_MESSAGES = 10;
const GROUP_HISTORY_LIMIT = 96;

interface HermesProfile {
  name: string;
  ui_meta?: Record<string, any>;
  ui_meta_revisions?: Record<string, number>;
}

interface NativeGroupEntry {
  id?: string;
  from?: { kind?: "user" | "member"; name?: string };
  text?: string;
  at?: number;
  thread?: string;
}

interface NativeGroupMember {
  name?: string;
}

interface NativeGroupRoom {
  name?: string;
  roomId?: string;
  revision?: number;
  log?: NativeGroupEntry[];
  members?: NativeGroupMember[];
  watermarks?: Record<string, number>;
}

interface NativeGroupSnapshot {
  version: number;
  updatedAt?: number;
  deleted?: Record<string, number>;
  rooms: Record<string, NativeGroupRoom>;
}

interface NativeState {
  defaultProfile?: HermesProfile;
  profiles: HermesProfile[];
  snapshot: NativeGroupSnapshot;
  supportsCas: boolean;
  uiMetaRevision: number;
  rooms: RoomRecord[];
}

interface RoomRecord extends GroupRoom {
  key: string;
  roomId?: string;
  revision: number;
  watermarks: Record<string, number>;
}

interface ActiveRun {
  roomId: string;
  thread: string;
  round: number;
  posted: number;
  spokeThisRound: number;
  queue: string[];
  currentSession?: string;
}

export interface GroupMessage {
  id: string;
  author: string;
  authorKind: "user" | "bot";
  text: string;
  at: number;
  thread?: string;
}

export interface GroupActivity {
  kind: "failed" | "settled" | "capped" | "stopped";
  member?: string;
  failure?: HermesFailure;
  at: number;
}

export interface GroupRoom {
  id: string;
  name: string;
  members: string[];
  messages: GroupMessage[];
  running: boolean;
  turn?: string;
  protocol?: { status: "running" | "settled" | "capped" | "stopped"; round: number; maxRounds: number; posted: number; maxMessages: number; thread?: string };
  activity?: GroupActivity[];
}

interface GroupGatewayPort {
  request(method: string, params?: Record<string, unknown>): Promise<any>;
  subscribe(listener: (event: GatewayEvent) => void): () => void;
}

export class GroupChatService {
  private readonly activeTurns = new Map<string, { roomId: string; member: string }>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly activity = new Map<string, GroupActivity[]>();

  constructor(private readonly gateway: GroupGatewayPort, private readonly idFactory: () => string = randomUUID) {
    gateway.subscribe((event) => {
      void this.onGatewayEvent(event);
    });
  }

  async listGroups(): Promise<GroupRoom[]> {
    const { rooms } = await this.readState();
    return rooms.map((room) => this.publicRoom(room));
  }

  async createGroup(name: string, members: string[]): Promise<GroupRoom> {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) throw new Error("Group name is required");
    if (trimmedName.length > 80) throw new Error("Group name is too long");
    const uniqueMembers = [...new Set(members.map((member) => member.trim()).filter(Boolean))];
    if (uniqueMembers.length < 2 || uniqueMembers.length > 6) throw new Error("A group requires 2 to 6 Bots");

    const state = await this.readState();
    if (state.rooms.some((group) => group.name.toLowerCase() === trimmedName.toLowerCase())) {
      throw new Error(`Group '${trimmedName}' already exists`);
    }

    for (const member of uniqueMembers) {
      const profile = state.profiles.find((entry) => entry.name === member);
      if (!profile) throw new Error(`Hermes profile '${member}' not found`);
      await this.persistMemberProfile(profile, trimmedName);
    }

    const roomId = this.idFactory();
    const room: RoomRecord = {
      id: roomId,
      key: `id:${roomId}`,
      roomId,
      name: trimmedName,
      members: uniqueMembers,
      messages: [],
      watermarks: {},
      revision: this.nextRevision(state),
      running: false
    };
    await this.persistRoom(state, room);
    return this.publicRoom(room);
  }

  async sendMessage(roomId: string, text: string, requestedThread?: string): Promise<GroupRoom> {
    const trimmedText = text.trim();
    if (!trimmedText) throw new Error("Group message is required");
    const state = await this.readState();
    const room = this.findRoom(state, roomId);
    if (!room) throw new Error(`Unknown group '${roomId}'`);
    if (room.members.length === 0) throw new Error("This group has no Bot member");
    if (room.running) throw new Error("This group is already responding");

    const thread = requestedThread && room.messages.some((message) => message.thread === requestedThread) ? requestedThread : this.idFactory();
    const updated: RoomRecord = {
      ...room,
      running: true,
      revision: this.nextRevision(state),
      messages: [
        ...room.messages,
        { id: this.idFactory(), author: "user", authorKind: "user", text: trimmedText, at: Date.now(), thread }
      ]
    };
    await this.persistRoom(state, updated);
    const mentioned = this.mentionedMembers(trimmedText, updated.members);
    const run: ActiveRun = { roomId: updated.id, thread, round: 0, posted: 0, spokeThisRound: 0, queue: mentioned.length ? mentioned : [...updated.members] };
    this.activeRuns.set(updated.id, run);
    this.activity.set(updated.id, []);
    try {
      await this.advanceRun(updated.id);
    } catch (cause) {
      if (this.activeRuns.get(updated.id) !== run) return this.publicRoom(updated);
      if (run.currentSession) this.activeTurns.delete(run.currentSession);
      this.activeRuns.delete(updated.id);
      this.recordActivity(updated.id, { kind: "failed", member: run.queue[0], failure: hermesFailureFromUnknown(cause), at: Date.now() });
      throw cause;
    }
    return this.publicRoom(updated);
  }

  async stop(roomId: string): Promise<GroupRoom> {
    const state = await this.readState();
    const room = this.findRoom(state, roomId);
    if (!room) throw new Error(`Unknown group '${roomId}'`);
    const run = this.activeRuns.get(room.id);
    // Invalidate the run before awaiting Hermes: interruption can itself emit
    // message.complete, and pending session creation can finish meanwhile.
    this.activeRuns.delete(room.id);
    this.recordActivity(room.id, { kind: "stopped", at: Date.now() });
    if (run?.currentSession) {
      this.activeTurns.delete(run.currentSession);
      await this.gateway.request("session.interrupt", { session_id: run.currentSession }).catch(() => undefined);
    }
    return this.publicRoom(room);
  }

  private async startTurn(room: RoomRecord, run: ActiveRun, member: string, delta: GroupMessage[]): Promise<void> {
    const title = `Group: ${room.roomId || room.name}`;
    const listed = await this.gateway.request("session.list", { profile: member, title, limit: 1, include_hidden: true });
    if (this.activeRuns.get(room.id) !== run) return;
    const stored = listed.sessions?.[0];
    let runtimeId: string;
    if (stored?.id) {
      const resumed = await this.gateway.request("session.resume", { session_id: stored.resolved_id || stored.id, profile: member });
      runtimeId = resumed.session_id;
    } else {
      const created = await this.gateway.request("session.create", {
        profile: member,
        title,
        room_plumbing: true,
        follow_profile_config: true,
        hidden: true
      });
      runtimeId = created.session_id;
    }
    if (this.activeRuns.get(room.id) !== run) return;
    run.currentSession = runtimeId;
    this.activeTurns.set(runtimeId, { roomId: room.id, member });
    await this.gateway.request("prompt.submit", { session_id: runtimeId, text: this.turnPrompt(room, member, delta) });
  }

  private async onGatewayEvent(event: GatewayEvent): Promise<void> {
    if (event.type !== "message.complete" || !event.sessionId) return;
    const turn = this.activeTurns.get(event.sessionId);
    if (!turn) return;
    const originatingRun = this.activeRuns.get(turn.roomId);
    if (!originatingRun) return;
    try {
      const state = await this.readState();
      const room = this.findRoom(state, turn.roomId);
      if (!room) {
        this.activeTurns.delete(event.sessionId);
        return;
      }
      const run = this.activeRuns.get(room.id);
      if (!run || run.currentSession !== event.sessionId) {
        this.activeTurns.delete(event.sessionId);
        return;
      }

      const text = String(event.payload.text ?? "").trim();
      const member = turn.member;
      const failed = event.payload.status === "error" || Boolean(event.payload.error);
      if (failed) {
        const detail = String(event.payload.error || text || "Hermes reported an error");
        const surface = event.payload.error_surface && typeof event.payload.error_surface === "object" ? event.payload.error_surface as Record<string, unknown> : {};
        this.recordActivity(room.id, { kind: "failed", member, failure: hermesFailure(detail, event.payload.failure_reason, surface.retryable ?? event.payload.recoverable), at: Date.now() });
      }
      const spoke = !failed && !this.isPassText(text);
      const nextMessages = spoke
        ? [...room.messages, { id: this.idFactory(), author: member, authorKind: "bot" as const, text, at: Date.now(), thread: run.thread }]
        : room.messages;
      if (spoke) {
        run.posted += 1;
        run.spokeThisRound += 1;
      }
      const markKey = `${run.thread}::${member}`;
      const updated: RoomRecord = {
        ...room,
        messages: nextMessages,
        watermarks: { ...room.watermarks, [markKey]: nextMessages.length },
        revision: this.nextRevision(state),
        running: true
      };
      await this.persistRoom(state, updated);
      if (this.activeRuns.get(room.id) !== run) return;
      this.activeTurns.delete(event.sessionId);
      run.currentSession = undefined;
      await this.advanceRun(room.id);
    } catch (cause) {
      if (this.activeRuns.get(turn.roomId) !== originatingRun) return;
      this.activeTurns.delete(event.sessionId);
      const run = this.activeRuns.get(turn.roomId);
      if (run?.currentSession === event.sessionId) run.currentSession = undefined;
      this.activeRuns.delete(turn.roomId);
      this.recordActivity(turn.roomId, { kind: "failed", member: turn.member, failure: hermesFailureFromUnknown(cause), at: Date.now() });
    }
  }

  private turnPrompt(room: GroupRoom, member: string, delta: GroupMessage[]): string {
    const transcript = delta.slice(-24).map((message) => `${message.authorKind === "user" ? "User" : message.author}${message.author === member ? " (you)" : ""}: ${message.text}`).join("\n\n");
    const peers = room.members.filter((candidate) => candidate !== member).map((candidate) => `@${candidate}`).join(", ");
    return [
      `[Group chat: "${room.name}"] Tu es @${member}, avec ${peers || "aucun autre Bot"} et l'utilisateur.`,
      "Nouveaux messages depuis ton dernier tour :",
      transcript,
      "Rules:",
      "- Reply with ONE message only when you add something new; do not repeat others.",
      "- If you have nothing useful to add, reply with exactly (pass).",
      "- Mention a colleague with @profile-name to hand over, or @user when a human decision is needed.",
      "- Never reveal content from your private conversations."
    ].join("\n\n");
  }

  private async advanceRun(roomId: string): Promise<void> {
    const run = this.activeRuns.get(roomId);
    if (!run) return;
    const state = await this.readState();
    if (this.activeRuns.get(roomId) !== run) return;
    const room = this.findRoom(state, roomId);
    if (!room) { this.activeRuns.delete(roomId); return; }

    while (run.queue.length) {
      if (run.posted >= GROUP_MAX_MESSAGES) return this.finishRun(roomId, "capped");
      const member = run.queue.shift()!;
      const markKey = `${run.thread}::${member}`;
      const seen = Math.max(0, room.watermarks[markKey] || 0);
      const delta = room.messages.slice(seen).filter((message) => message.thread === run.thread);
      if (!delta.length) continue;
      try {
        await this.startTurn(room, run, member, delta);
      } catch (cause) {
        if (this.activeRuns.get(roomId) !== run) return;
        if (run.currentSession) this.activeTurns.delete(run.currentSession);
        run.currentSession = undefined;
        this.recordActivity(room.id, { kind: "failed", member, failure: hermesFailureFromUnknown(cause), at: Date.now() });
        room.watermarks[markKey] = room.messages.length;
        room.revision = this.nextRevision(state);
        await this.persistRoom(state, room);
        if (this.activeRuns.get(roomId) !== run) return;
        await this.advanceRun(roomId);
      }
      return;
    }

    if (run.spokeThisRound === 0) return this.finishRun(roomId, "settled");
    run.round += 1;
    if (run.round >= GROUP_MAX_ROUNDS || run.posted >= GROUP_MAX_MESSAGES) return this.finishRun(roomId, "capped");
    run.spokeThisRound = 0;
    const responders = this.resolveResponders(room.messages.filter((message) => message.thread === run.thread), room.members);
    run.queue = this.rotate(responders, run.round);
    await this.advanceRun(roomId);
  }

  private finishRun(roomId: string, kind: "settled" | "capped"): void {
    const run = this.activeRuns.get(roomId);
    if (run?.currentSession) this.activeTurns.delete(run.currentSession);
    this.activeRuns.delete(roomId);
    this.recordActivity(roomId, { kind, at: Date.now() });
  }

  private resolveResponders(messages: GroupMessage[], members: string[]): string[] {
    const lastUserIndex = messages.map((message) => message.authorKind).lastIndexOf("user");
    const relevant = lastUserIndex >= 0 ? messages.slice(lastUserIndex) : messages;
    const all = relevant.some((message) => /@(all|everyone)\b/i.test(message.text));
    const mentioned = this.unique(relevant.flatMap((message) => this.mentionedMembers(message.text, members)));
    return all || mentioned.length === 0 ? [...members] : members.filter((member) => mentioned.includes(member));
  }

  private rotate(members: string[], round: number): string[] {
    if (members.length < 2) return members;
    const shift = round % members.length;
    return [...members.slice(shift), ...members.slice(0, shift)];
  }

  private recordActivity(roomId: string, entry: GroupActivity): void {
    this.activity.set(roomId, [...(this.activity.get(roomId) ?? []), entry].slice(-20));
  }

  private async persistMemberProfile(profile: HermesProfile, group: string): Promise<void> {
    const current = profile.ui_meta?.[BOT_META_KEY] ?? {};
    const groups = this.botGroups(current);
    const nextGroups = groups.includes(group) ? groups : [...groups, group];
    const result = await this.gateway.request("profiles.configure", {
      name: profile.name,
      ui_meta: {
        [BOT_META_KEY]: {
          ...current,
          groups: nextGroups,
          group: nextGroups[0] || null
        }
      }
    });
    if (result?.applied?.ui_meta === false) throw new Error("Hermes rejected group membership metadata");
  }

  private async persistRoom(state: NativeState, room: RoomRecord): Promise<void> {
    const drop = Math.max(0, room.messages.length - GROUP_HISTORY_LIMIT);
    const messages = drop ? room.messages.slice(drop) : room.messages;
    const watermarks = Object.fromEntries(Object.entries(room.watermarks).map(([key, value]) => [key, Math.max(0, value - drop)]));
    const snapshot = this.normalizeSnapshot(state.defaultProfile?.ui_meta?.[GROUPS_META_KEY]);
    const nextSnapshot: NativeGroupSnapshot = {
      ...snapshot,
      version: 3,
      updatedAt: Date.now(),
      rooms: {
        ...snapshot.rooms,
        [room.key]: {
          name: room.name,
          ...(room.roomId ? { roomId: room.roomId } : {}),
          revision: room.revision,
          log: messages.map((message) => this.toNativeEntry(message)),
          members: room.members.map((name) => ({ name })),
          watermarks
        }
      }
    };
    const params: Record<string, unknown> = {
      name: "default",
      ui_meta: { [GROUPS_META_KEY]: nextSnapshot }
    };
    if (state.supportsCas) {
      params.ui_meta_expected_revisions = { [GROUPS_META_KEY]: state.uiMetaRevision };
    }
    const result = await this.gateway.request("profiles.configure", params);
    if (result?.applied?.ui_meta === false) throw new Error("Hermes rejected group metadata");
  }

  private async readState(): Promise<NativeState> {
    const data = await this.gateway.request("profiles.list", {});
    const profiles: HermesProfile[] = Array.isArray(data.profiles) ? data.profiles : [];
    const defaultProfile = profiles.find((entry) => entry.name === "default");
    const snapshot = this.normalizeSnapshot(defaultProfile?.ui_meta?.[GROUPS_META_KEY]);
    const membersByGroup = this.membersByGroup(profiles);
    const roomsByKey = new Map<string, RoomRecord>();

    for (const [key, nativeRoom] of Object.entries(snapshot.rooms)) {
      const name = this.roomName(key, nativeRoom);
      const roomId = typeof nativeRoom.roomId === "string" && nativeRoom.roomId ? nativeRoom.roomId : undefined;
      const id = roomId || key;
      const projectedMembers = Array.isArray(nativeRoom.members)
        ? nativeRoom.members.map((member) => String(member?.name || "").trim()).filter(Boolean)
        : [];
      roomsByKey.set(key, {
        id,
        key,
        ...(roomId ? { roomId } : {}),
        name,
        revision: Math.max(0, Number(nativeRoom.revision || 0)),
        members: this.unique([...(membersByGroup.get(name) || []), ...projectedMembers]),
        messages: (Array.isArray(nativeRoom.log) ? nativeRoom.log : []).map((entry) => this.fromNativeEntry(entry)),
        watermarks: nativeRoom.watermarks && typeof nativeRoom.watermarks === "object" ? { ...nativeRoom.watermarks } : {},
        running: this.isRoomRunning(id)
      });
    }

    for (const [name, members] of membersByGroup) {
      if ([...roomsByKey.values()].some((room) => room.name === name)) continue;
      const key = `name:${name}`;
      roomsByKey.set(key, {
        id: key,
        key,
        name,
        members,
        messages: [],
        watermarks: {},
        revision: 0,
        running: this.isRoomRunning(key)
      });
    }

    return {
      defaultProfile,
      profiles,
      snapshot,
      supportsCas: Boolean(defaultProfile && Object.prototype.hasOwnProperty.call(defaultProfile, "ui_meta_revisions")),
      uiMetaRevision: Math.max(0, Number(defaultProfile?.ui_meta_revisions?.[GROUPS_META_KEY] || 0)),
      rooms: [...roomsByKey.values()]
    };
  }

  private normalizeSnapshot(value: unknown): NativeGroupSnapshot {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value as any : {};
    const rooms = source.rooms && typeof source.rooms === "object" && !Array.isArray(source.rooms) ? source.rooms : {};
    return {
      version: 3,
      ...(typeof source.updatedAt === "number" ? { updatedAt: source.updatedAt } : {}),
      ...(source.deleted && typeof source.deleted === "object" && !Array.isArray(source.deleted) ? { deleted: source.deleted } : {}),
      rooms
    };
  }

  private membersByGroup(profiles: HermesProfile[]): Map<string, string[]> {
    const byGroup = new Map<string, string[]>();
    for (const profile of profiles) {
      if (profile.name === "default") continue;
      for (const group of this.botGroups(profile.ui_meta?.[BOT_META_KEY])) {
        byGroup.set(group, [...(byGroup.get(group) || []), profile.name]);
      }
    }
    return byGroup;
  }

  private botGroups(meta?: Record<string, unknown> | null): string[] {
    const values = Array.isArray(meta?.groups) ? meta.groups : [meta?.group];
    return this.unique(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean));
  }

  private roomName(key: string, room: NativeGroupRoom): string {
    if (typeof room.name === "string" && room.name.trim()) return room.name.trim();
    return key.startsWith("name:") ? key.slice(5) : key;
  }

  private findRoom(state: NativeState, roomId: string): RoomRecord | undefined {
    return state.rooms.find((room) => room.id === roomId || room.key === roomId || room.name === roomId || room.roomId === roomId);
  }

  private publicRoom(room: RoomRecord): GroupRoom {
    const run = this.activeRuns.get(room.id);
    const latestActivity = this.activity.get(room.id) ?? [];
    const final = [...latestActivity].reverse().find((entry) => entry.kind === "settled" || entry.kind === "capped" || entry.kind === "stopped");
    return {
      id: room.id,
      name: room.name,
      members: [...room.members],
      messages: [...room.messages],
      running: Boolean(run),
      ...(run?.queue[0] || run?.currentSession ? { turn: run.currentSession ? this.activeTurns.get(run.currentSession)?.member : run.queue[0] } : {}),
      ...(run || final ? { protocol: {
        status: run ? "running" : (final?.kind === "capped" || final?.kind === "stopped" ? final.kind : "settled"),
        round: run ? run.round + 1 : 0,
        maxRounds: GROUP_MAX_ROUNDS,
        posted: run?.posted ?? 0,
        maxMessages: GROUP_MAX_MESSAGES,
        ...(run?.thread ? { thread: run.thread } : {})
      } } : {}),
      ...(latestActivity.length ? { activity: latestActivity.slice(-8) } : {})
    };
  }

  private toNativeEntry(message: GroupMessage): NativeGroupEntry {
    return {
      id: message.id,
      from: message.authorKind === "user"
        ? { kind: "user", name: "You" }
        : { kind: "member", name: message.author },
      text: message.text,
      at: message.at,
      ...(message.thread ? { thread: message.thread } : {})
    };
  }

  private fromNativeEntry(entry: NativeGroupEntry): GroupMessage {
    const kind = entry?.from?.kind === "member" ? "bot" : "user";
    return {
      id: String(entry?.id || this.idFactory()),
      author: kind === "user" ? "user" : String(entry?.from?.name || "Bot"),
      authorKind: kind,
      text: String(entry?.text || ""),
      at: Number(entry?.at || 0),
      ...(entry?.thread ? { thread: String(entry.thread) } : {})
    };
  }

  private nextRevision(state: NativeState): number {
    return state.supportsCas ? state.uiMetaRevision + 1 : Date.now();
  }

  private isRoomRunning(roomId: string): boolean {
    return this.activeRuns.has(roomId);
  }

  private mentionedMembers(text: string, members: string[]): string[] {
    const memberByLowerName = new Map(members.map((member) => [member.toLowerCase(), member]));
    const mentions = [...String(text).matchAll(/(^|[^\p{L}\p{N}_-])@([\p{L}\p{N}_-]+)/giu)]
      .map((match) => memberByLowerName.get(match[2].toLowerCase()))
      .filter((member): member is string => Boolean(member));
    return this.unique(mentions);
  }

  private isPassText(text: unknown): boolean {
    const trimmed = String(text || "").trim();
    if (!trimmed) return true;
    return /^(?:\[\s*)?\(?\s*pass\s*\)?(?:\s*\])?\.?$/i.test(trimmed);
  }

  private unique(values: string[]): string[] {
    return [...new Set(values)];
  }
}
