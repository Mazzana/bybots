import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, ArrowRight, ArrowUp, Bot as BotIcon, CalendarClock, ChevronLeft, ChevronRight, CirclePlus, FileText, Paperclip, Pencil, Plus, Reply, RotateCcw, Search, Settings, ShieldCheck, Users, X } from "lucide-react";
import { BotAvatar } from "./BotAvatar";
import { BotIdentity } from "./BotIdentity";
import { GatewayStatuses } from "./GatewayStatuses";
import { getBotDisplayName } from "./botDisplayName";
import { BotAppearancePicker } from "./BotAppearancePicker";
import { DialogActions, DialogShell } from "./Dialog";
import { FormField } from "./FormField";
import { FirstRunPanel } from "./FirstRunPanel";
import { HomeDashboard } from "./HomeDashboard";
import { IconButton } from "./IconButton";
import { isHermesReady, isLocalHermesUrl } from "./hermesConnectionUi";
import { MessageContent, type MessageMentions } from "./MessageContent";
import { TextareaControl } from "./TextareaControl";
import { SelectControl } from "./SelectControl";
import { useI18n, type TranslationValues } from "./i18n";
import { loadPreferences, savePreferences, type AppPreferences } from "./preferences";
import type { SettingsSection } from "./SettingsPanel";

const LAST_THREADS_STORAGE_KEY = "byfinity.lastThreads";
const LAST_ACTIVE_STORAGE_KEY = "byfinity.lastActive";
const ONBOARDING_COMPLETED_STORAGE_KEY = "bybots.onboardingCompleted";
const DRAFTS_STORAGE_KEY = "byfinity.drafts.v1";
const MAX_DRAFTS = 80;
const MAX_DRAFT_LENGTH = 100_000;
const MAX_DRAFT_STORAGE_CHARACTERS = 1_000_000;
const MAX_TEXT_ATTACHMENTS = 5;
const MAX_TEXT_ATTACHMENT_BYTES = 256 * 1024;
const MAX_TEXT_ATTACHMENTS_PAYLOAD_BYTES = 512 * 1024;
const MESSAGE_WINDOW_SIZE = 80;
const TEXT_ATTACHMENT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "json", "yaml", "yml", "xml", "html", "css", "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt", "swift", "sql", "log"]);

const BotEditor = lazy(() => import("./BotEditor").then((module) => ({ default: module.BotEditor })));
const SettingsPanel = lazy(() => import("./SettingsPanel").then((module) => ({ default: module.SettingsPanel })));
const ChatModelSelector = lazy(() => import("./ChatModelSelector").then((module) => ({ default: module.ChatModelSelector })));
const GroupAccessPreview = lazy(() => import("./GroupAccessPreview"));
const BotRoutines = lazy(() => import("./BotRoutines").then((module) => ({ default: module.BotRoutines })));

interface TextAttachment { name: string; type: string; size: number; content: string }

function loadDrafts(storage?: Pick<Storage, "getItem">) {
  if (!storage) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(storage.getItem(DRAFTS_STORAGE_KEY) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length <= MAX_DRAFT_LENGTH)
      .slice(-MAX_DRAFTS));
  } catch {
    return {};
  }
}

function saveDrafts(drafts: Record<string, string>, storage?: Pick<Storage, "setItem" | "removeItem">) {
  if (!storage) return;
  const entries: Array<[string, string]> = [];
  let remaining = MAX_DRAFT_STORAGE_CHARACTERS;
  for (const [key, value] of Object.entries(drafts).filter(([, value]) => value).slice(-MAX_DRAFTS).reverse()) {
    if (value.length > remaining) continue;
    entries.unshift([key, value]);
    remaining -= value.length;
  }
  try {
    if (entries.length) storage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    else storage.removeItem(DRAFTS_STORAGE_KEY);
  } catch {
    // A draft should never make the application unusable when storage is full.
  }
}

function sendDesktopNotification(title: string, body: string) {
  try {
    new Notification(title, { body });
  } catch {
    // Notification support can disappear when a browser policy changes at runtime.
  }
}

function textAttachmentSupported(file: File) {
  if (file.type.startsWith("text/")) return true;
  const extension = file.name.split(".").at(-1)?.toLocaleLowerCase() || "";
  return TEXT_ATTACHMENT_EXTENSIONS.has(extension) || ["application/json", "application/xml", "application/javascript"].includes(file.type);
}

function attachmentWireText(text: string, attachments: TextAttachment[], fallback: string) {
  if (!attachments.length) return text;
  const blocks = attachments.map((attachment) => {
    const safeName = attachment.name.replace(/[\r\n]/g, " ").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const safeType = attachment.type.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const safeContent = attachment.content.replace(/<\/attachment>/gi, "&lt;/attachment&gt;");
    return `<attachment name="${safeName}" type="${safeType || "text/plain"}">\n${safeContent}\n</attachment>`;
  });
  return `${text || fallback}\n\n${blocks.join("\n\n")}`;
}

export interface Bot {
  name: string;
  gatewayId?: string;
  gatewayLabel?: string;
  gatewayDefault?: boolean;
  profile?: string;
  system: boolean;
  displayName?: string;
  description?: string;
  title?: string;
  avatar?: { shape?: string; color?: string; image?: string };
  machine?: string;
}
export interface BotAvatarValue { shape?: string; color?: string; image?: string }
export interface AvatarPet { slug: string; displayName: string; spritesheetUrl?: string; installed?: boolean; curated?: boolean }
export interface BotCreateInput { name: string; title?: string; description?: string; avatar?: BotAvatarValue; gatewayId?: string }
export interface BotArchiveDownload { blob: Blob; filename: string }
export type AccessRole = "admin" | "operator" | "viewer";
export interface HermesMachine { id: string; name: string; url?: string; kind: "local" | "peer"; status: "connected" | "configured" | "needs_auth" }
export interface HermesConnection { baseUrl: string; defaultBaseUrl: string; hasToken: boolean; authMode?: "session" | "oauth"; secure: boolean; source: "environment" | "saved"; version?: string; requiresReauthentication?: boolean }
export interface HermesConnectionProbe { baseUrl: string; secure: boolean; version: string }
export interface HermesAuthProbe {
  baseUrl: string;
  reachable: boolean;
  authMode: "oauth" | "token" | "unknown";
  nativePkce: boolean;
  providers: Array<{ name: string; displayName: string; supportsPassword: boolean }>;
  version?: string;
  error?: string;
}
export interface DiagnosticCheck { status: "ready" | "warning" | "error"; version?: string; detail?: string }
export interface AppDiagnostics {
  checkedAt: string;
  supportedHermes: string;
  bridge: DiagnosticCheck;
  hermes: DiagnosticCheck & { baseUrl: string; compatible?: boolean };
  authentication: DiagnosticCheck;
  failure?: HermesFailure;
}
export interface DiagnosticsReport {
  schemaVersion: number;
  generatedAt: string;
  application: { name: string; version: string };
  runtime: { platform: string; architecture: string };
  connection: { target: "local" | "remote"; transport: "http" | "https"; secure: boolean };
  support: { hermes: string };
  checks: {
    bridge: { status: DiagnosticCheck["status"]; version?: string };
    hermes: { status: DiagnosticCheck["status"]; version?: string; compatible?: boolean };
    authentication: { status: DiagnosticCheck["status"] };
  };
  failure?: { reason: HermesFailureReason; retryable: boolean; action: HermesFailure["action"] };
  privacy: { excluded: string[] };
}
export interface BotCapability { name: string; description?: string; enabled: boolean; installed?: boolean; fromCatalog?: boolean; requires?: string[]; auth?: string; toolCount?: number }
export interface BotModelProvider { slug: string; name?: string; models: string[] }
export interface BotConfiguration { bot: string; provider: string; model: string; soul: string; skills: BotCapability[]; toolsets: BotCapability[]; mcpServers: BotCapability[]; providers: BotModelProvider[] }
export interface McpServerTest { server: string; toolCount: number; tools: string[] }
export interface BotUpdateInput { title?: string; description?: string; provider?: string; model?: string; soul?: string; disabledSkills?: string[]; enabledToolsets?: string[]; enabledMcpServers?: string[]; confirmExpensiveModel?: boolean }
export interface BotUpdateResult { applied: Record<string, boolean>; confirmRequired: boolean; confirmMessage?: string }
export type HermesFailureReason = "provider_auth_or_access" | "provider_quota_limit" | "provider_rate_limit" | "provider_server_error" | "context_overflow" | "missing_config" | "model_unavailable" | "runtime_offline" | "queued_expired" | "delivery_timeout" | "target_busy" | "agent_blocked" | "access_denied" | "invalid_request" | "unknown";
export interface HermesFailure { reason: HermesFailureReason; title: string; detail: string; hint: string; retryable: boolean; action: "retry" | "configure" | "wait" | "reconnect" | "none" }
export interface AgentMessageIdentity { displayName: string; profile?: string; gatewayId?: string; gatewayLabel?: string }
export interface AgentMessageAttribution { kind: "agent"; source: "hermes-delivery-prefix"; sender: AgentMessageIdentity; recipient: AgentMessageIdentity; status: "delivered" }
export interface ChatMessage { role: "user" | "assistant"; text: string; failure?: HermesFailure; attribution?: AgentMessageAttribution }
export interface AgentDispatch { id: string; target: string; status: "started" | "dispatched" | "failed" | "unknown" }
export interface Conversation { bot: string; sessionId: string; running: boolean; messages: ChatMessage[]; dispatches?: AgentDispatch[] }
export interface BotThread { id: string; bot: string; title: string; preview: string; startedAt: number; messageCount: number; running: boolean }
export type BotThreadStreamEvent =
  | { type: "conversation"; conversation: Conversation }
  | { type: "delta"; bot: string; threadId: string; text: string }
  | { type: "archived"; bot: string; threadId: string };
export type BotThreadStreamStatus = "connecting" | "connected" | "disconnected";
export interface GroupMessage { id: string; author: string; authorKind: "user" | "bot"; text: string; at: number; thread?: string }
export interface GroupActivity { kind: "failed" | "settled" | "capped" | "stopped"; member?: string; failure?: HermesFailure; at: number }
export interface GroupRoom { id: string; name: string; members: string[]; messages: GroupMessage[]; running: boolean; turn?: string; protocol?: { status: "running" | "settled" | "capped" | "stopped"; round: number; maxRounds: number; posted: number; maxMessages: number; thread?: string }; activity?: GroupActivity[] }
export interface BotRoutine { id: string; bot: string; name: string; prompt: string; schedule: string; scheduleDisplay: string; enabled: boolean; state: string; nextRunAt?: string; lastRunAt?: string; lastStatus?: string; lastError?: string }
export interface BotRoutineRun { id: string; startedAt: number; endedAt?: number; status: "running" | "success" | "error"; output?: string; error?: string }
export interface BotRoutineInput { name: string; prompt: string; schedule: string }
export interface Usage {
  bot: string;
  periodDays: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  actualCostUsd: number;
  estimatedCostUsd: number;
  sessions: number;
  apiCalls: number;
  byModel: Array<{ model: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number }>;
}
export interface BotsApi {
  listBots(): Promise<Bot[]>;
  getUsage(name: string, days: number): Promise<Usage>;
  createBot(input: BotCreateInput): Promise<Bot>;
  deleteBot(name: string): Promise<void>;
  exportBot?(name: string): Promise<BotArchiveDownload>;
  importBot?(archive: File, name?: string, gatewayId?: string): Promise<Bot>;
  updateBotAvatar?(name: string, avatar: BotAvatarValue): Promise<void>;
  listAvatarPets?(): Promise<AvatarPet[]>;
  getBotConfiguration?(name: string): Promise<BotConfiguration>;
  testMcpServer?(name: string, server: string): Promise<McpServerTest>;
  updateBot?(name: string, input: BotUpdateInput): Promise<BotUpdateResult>;
  getConversation?(name: string): Promise<Conversation>;
  sendMessage?(name: string, text: string): Promise<Conversation>;
  listThreads?(name: string): Promise<BotThread[]>;
  createThread?(name: string, title?: string): Promise<Conversation>;
  getThread?(name: string, threadId: string): Promise<Conversation>;
  sendThreadMessage?(name: string, threadId: string, text: string): Promise<Conversation>;
  renameThread?(name: string, threadId: string, title: string): Promise<BotThread>;
  archiveThread?(name: string, threadId: string): Promise<void>;
  watchThread?(name: string, threadId: string, listener: (event: BotThreadStreamEvent) => void, onStatus: (status: BotThreadStreamStatus, cause?: unknown) => void): () => void;
  listGroups?(): Promise<GroupRoom[]>;
  createGroup?(name: string, members: string[]): Promise<GroupRoom>;
  sendGroupMessage?(roomId: string, text: string, thread?: string): Promise<GroupRoom>;
  stopGroup?(roomId: string): Promise<GroupRoom>;
  listRoutines?(name: string): Promise<BotRoutine[]>;
  createRoutine?(name: string, input: BotRoutineInput): Promise<BotRoutine>;
  setRoutineEnabled?(name: string, routineId: string, enabled: boolean): Promise<BotRoutine>;
  runRoutine?(name: string, routineId: string): Promise<BotRoutine>;
  deleteRoutine?(name: string, routineId: string): Promise<void>;
  listRoutineRuns?(name: string, routineId: string): Promise<BotRoutineRun[]>;
  getAccess?(): Promise<{ role: AccessRole }>;
  listMachines?(): Promise<HermesMachine[]>;
  getHermesConnection?(): Promise<HermesConnection>;
  listGateways?(): Promise<import("./gateways").GatewayList>;
  getGatewayStatuses?(): Promise<{ gateways: import("./gateways").GatewayStatus[] }>;
  setDefaultGateway?(id: string): Promise<unknown>;
  setRelayPaused?(paused: boolean): Promise<unknown>;
  addGateway?(input: { label: string; baseUrl: string }): Promise<{ id: string }>;
  removeGateway?(id: string): Promise<unknown>;
  setGatewayRelay?(id: string, relay: boolean): Promise<unknown>;
  forGateway?(id: string): BotsApi;
  getDiagnostics?(): Promise<AppDiagnostics>;
  getDiagnosticsReport?(): Promise<DiagnosticsReport>;
  testHermesConnection?(input: { baseUrl: string; token?: string }): Promise<HermesConnectionProbe>;
  updateHermesConnection?(input: { baseUrl: string; token?: string }): Promise<HermesConnection>;
  resetHermesConnection?(): Promise<HermesConnection>;
  probeHermesAuth?(input: { baseUrl: string }): Promise<HermesAuthProbe>;
  startHermesOAuth?(input: { baseUrl: string }): Promise<{ authorizationUrl: string }>;
}

interface ReplyTarget {
  scope: "bot" | "group";
  author: string;
  text: string;
  thread?: string;
}

interface FailedSend {
  scope: "bot" | "group";
  wireText: string;
  draftText: string;
  reply: ReplyTarget | null;
  failure: HermesFailure;
}

function ComposerAttachmentList({ attachments, onRemove }: { attachments: TextAttachment[]; onRemove(index: number): void }) {
  const { t } = useI18n();
  if (!attachments.length) return null;
  return <div className="composer-attachments" aria-label={t("Attached text files")}>{attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`}><FileText size={15} aria-hidden="true" /><span><strong>{attachment.name}</strong><small>{Math.max(1, Math.ceil(attachment.size / 1024))} KB</small></span><IconButton label={t("Remove {name}", { name: attachment.name })} onClick={() => onRemove(index)}><X size={14} /></IconButton></span>)}</div>;
}

function clippedPreview(value: string, fallback: string) {
  const text = value.replace(/[#*_`>\n\r]+/g, " ").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function technicalBotName(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length === 1 ? `${slug}-bot` : slug;
}

function storedLastThreads() {
  if (typeof window === "undefined") return {} as Record<string, string>;
  try {
    const value = JSON.parse(window.localStorage.getItem(LAST_THREADS_STORAGE_KEY) || "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function lastThreadForBot(bot: string) {
  return storedLastThreads()[bot];
}

function rememberLastThread(bot: string, threadId?: string) {
  if (typeof window === "undefined") return;
  const stored = storedLastThreads();
  if (threadId) stored[bot] = threadId;
  else delete stored[bot];
  if (Object.keys(stored).length) window.localStorage.setItem(LAST_THREADS_STORAGE_KEY, JSON.stringify(stored));
  else window.localStorage.removeItem(LAST_THREADS_STORAGE_KEY);
}

type LastActive = { scope: "bot"; id: string; threadId?: string } | { scope: "group"; id: string };

function storedLastActive(): LastActive | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(LAST_ACTIVE_STORAGE_KEY) || "null") as Partial<LastActive> | null;
    if (!value || (value.scope !== "bot" && value.scope !== "group") || typeof value.id !== "string") return null;
    if (value.scope === "bot") return { scope: "bot", id: value.id, ...(typeof value.threadId === "string" ? { threadId: value.threadId } : {}) };
    return { scope: "group", id: value.id };
  } catch {
    return null;
  }
}

function rememberLastActive(value: LastActive) {
  if (typeof window !== "undefined") window.localStorage.setItem(LAST_ACTIVE_STORAGE_KEY, JSON.stringify(value));
}

function isErrorMessage(text: string) {
  return /^(?:error|erreur|échec|echec|exception)\b|\b(?:failed|timed out|timeout|econnrefused|traceback|internal server error)\b/i.test(text.trim());
}

function fallbackFailure(detail: string): HermesFailure {
  return { reason: "unknown", title: "Hermes encountered an error", detail, hint: "Try again if the issue appears temporary.", retryable: true, action: "retry" };
}

function failureFromCause(cause: unknown): HermesFailure {
  if (cause && typeof cause === "object" && "failure" in cause) {
    const failure = (cause as { failure?: Partial<HermesFailure> }).failure;
    if (failure?.reason && failure.title && failure.detail && failure.hint && typeof failure.retryable === "boolean" && failure.action) {
      return failure as HermesFailure;
    }
  }
  return fallbackFailure(String(cause));
}

function replyWireText(text: string, reply: ReplyTarget | null, t: (key: string, values?: TranslationValues) => string) {
  if (!reply) return text;
  const quote = clippedPreview(reply.text, t("Message")).slice(0, 320);
  return `> **${t("In reply to {author}", { author: reply.author })}**\n> ${quote}\n\n${text}`;
}

function ReplyButton({ label, onClick }: { label: string; onClick(): void }) {
  const { t } = useI18n();
  return <IconButton className="message-reply" label={label} onClick={onClick}><Reply size={15} /><span>{t("Reply")}</span></IconButton>;
}

function RetryButton({ retrying, onClick }: { retrying: boolean; onClick(): void }) {
  const { t } = useI18n();
  return <button className="retry-button" type="button" disabled={retrying} onClick={onClick}><RotateCcw size={15} /><span>{retrying ? t("Trying again…") : t("Retry")}</span></button>;
}

function FailureBody({ failure }: { failure: HermesFailure }) {
  const { t } = useI18n();
  return <div className="failure-body"><strong>{t(failure.title)}</strong><p>{t(failure.hint)}</p><details><summary>{t("Technical details")}</summary><code>{failure.detail}</code></details></div>;
}

function FailureAction({ failure, retrying, onRetry, onConfigure }: { failure: HermesFailure; retrying: boolean; onRetry(): void; onConfigure?(): void }) {
  const { t } = useI18n();
  if (failure.action === "configure" && onConfigure) return <button className="retry-button" type="button" onClick={onConfigure}><Settings size={15} /><span>{t("Configure")}</span></button>;
  if (failure.retryable) return <RetryButton retrying={retrying} onClick={onRetry} />;
  return null;
}

function InlineSendError({ failure, retrying, onRetry, onConfigure }: { failure: HermesFailure; retrying: boolean; onRetry(): void; onConfigure?(): void }) {
  return <article className="inline-error" role="alert"><AlertTriangle size={18} /><FailureBody failure={failure} /><FailureAction failure={failure} retrying={retrying} onRetry={onRetry} onConfigure={onConfigure} /></article>;
}

function ReplyPreview({ target, onClose }: { target: ReplyTarget; onClose(): void }) {
  const { t } = useI18n();
  return <div className="reply-preview"><Reply size={15} /><div><strong>{t("Replying to {author}", { author: target.author })}</strong><span>{clippedPreview(target.text, t("Message"))}</span></div><IconButton label={t("Cancel reply")} onClick={onClose}><X size={16} /></IconButton></div>;
}

function AgentDelivery({ message, recipient, senderBot }: { message: ChatMessage; recipient: string; senderBot: Bot | null }) {
  const { t } = useI18n();
  const attribution = message.attribution!;
  const sender = attribution.sender.displayName || attribution.sender.profile || t("A Bot");
  return <article className="agent-delivery" role="note" aria-label={t("Bot-to-Bot message from {sender} to {recipient}", { sender, recipient })}>
    <div className="agent-delivery-route">
      {senderBot ? <BotAvatar bot={senderBot} size={28} /> : <span className="fallback-avatar"><BotIcon size={15} /></span>}
      <span className="agent-delivery-copy"><small>{t("Bot-to-Bot message")}</small><strong><span>{sender}</span><ArrowRight size={14} aria-hidden /><span>{recipient}</span></strong></span>
      <span className="agent-delivery-status">{t("Delivered")}</span>
    </div>
    {message.text && <div className="agent-delivery-body"><MessageContent text={message.text} /></div>}
  </article>;
}

export function App({ api }: { api: BotsApi }) {
  const { locale, t, formatError } = useI18n();
  const [bots, setBots] = useState<Bot[]>([]);
  const [botsLoading, setBotsLoading] = useState(true);
  const [botsError, setBotsError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNameEdited, setNewNameEdited] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAvatar, setNewAvatar] = useState<BotAvatarValue>({ shape: "blobatar::round" });
  const [createError, setCreateError] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [visibleBotMessageCount, setVisibleBotMessageCount] = useState(MESSAGE_WINDOW_SIZE);
  const [threads, setThreads] = useState<BotThread[]>([]);
  const [recentThreads, setRecentThreads] = useState<BotThread[]>([]);
  const [recentThreadsLoaded, setRecentThreadsLoaded] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadStreamStatus, setThreadStreamStatus] = useState<BotThreadStreamStatus | "idle">("idle");
  const [renamingThread, setRenamingThread] = useState<BotThread | null>(null);
  const [renameThreadTitle, setRenameThreadTitle] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>(() => loadDrafts(typeof window === "undefined" ? undefined : window.localStorage));
  const [botAttachments, setBotAttachments] = useState<TextAttachment[]>([]);
  const [groupAttachments, setGroupAttachments] = useState<TextAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [editingBot, setEditingBot] = useState(false);
  const [avatarValue, setAvatarValue] = useState<BotAvatarValue>({ shape: "blobatar::round" });
  const [groups, setGroups] = useState<GroupRoom[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(Boolean(api.listGroups));
  const [groupsError, setGroupsError] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupMentionIndex, setGroupMentionIndex] = useState(0);
  const [groupMentionDismissed, setGroupMentionDismissed] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [failedSend, setFailedSend] = useState<FailedSend | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [accessRole, setAccessRole] = useState<AccessRole>(api.getAccess ? "viewer" : "admin");
  const [accessLoading, setAccessLoading] = useState(Boolean(api.getAccess));
  const [accessError, setAccessError] = useState("");
  const [machines, setMachines] = useState<HermesMachine[]>([]);
  const [newBotGateway, setNewBotGateway] = useState("primary");
  const [availableGateways, setAvailableGateways] = useState<import("./gateways").GatewayView[]>([]);
  useEffect(() => {
    if (!creating || !api.listGateways) return;
    let active = true;
    api.listGateways().then((result) => {
      if (!active) return;
      setAvailableGateways(result.gateways);
      setNewBotGateway(result.gateways.find((gateway) => gateway.isDefault)?.id || result.gateways.find((gateway) => gateway.hasToken)?.id || "primary");
    }).catch((cause) => { if (active) setCreateError(String(cause)); });
    return () => { active = false; };
  }, [api, creating]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection>("general");
  const [firstRun, setFirstRun] = useState(false);
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(Boolean(api.getDiagnostics));
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const [preferences, setPreferences] = useState<AppPreferences>(() => loadPreferences(typeof window === "undefined" ? undefined : window.localStorage));
  const [botConfigurationVersion, setBotConfigurationVersion] = useState(0);
  const botInputRef = useRef<HTMLTextAreaElement>(null);
  const groupInputRef = useRef<HTMLTextAreaElement>(null);
  const botAttachmentInputRef = useRef<HTMLInputElement>(null);
  const groupAttachmentInputRef = useRef<HTMLInputElement>(null);
  const botMessagesRef = useRef<HTMLDivElement>(null);
  const groupMessagesRef = useRef<HTMLDivElement>(null);
  const botSticksToBottom = useRef(true);
  const groupSticksToBottom = useRef(true);
  const botAutoScrolling = useRef(false);
  const groupAutoScrolling = useRef(false);
  const lastScrollContext = useRef("");
  const pendingBotPrependHeight = useRef<number | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectionRequest = useRef(0);
  const gatewayGeneration = useRef(0);
  const autoRestoreAttempted = useRef(false);
  const previousBotRun = useRef({ key: "", running: false });
  const previousGroupRun = useRef({ key: "", running: false });
  const latestDrafts = useRef(drafts);
  const firstLaunch = useRef(typeof window !== "undefined"
    && window.localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY) !== "true"
    && !window.localStorage.getItem(LAST_ACTIVE_STORAGE_KEY)
    && !window.localStorage.getItem(LAST_THREADS_STORAGE_KEY));
  const selectedBot = bots.find((bot) => bot.name === selected) ?? null;
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId) ?? null;
  const activeTitle = selectedGroup?.name || (selectedBot ? getBotDisplayName(selectedBot, selectedBot.name) : "ByBots");
  const hasDetails = Boolean(selected || selectedGroup);
  const canOperate = accessRole !== "viewer";
  const roleLabel = accessRole === "admin" ? t("Administrator") : accessRole === "operator" ? t("Operator") : t("Read only");
  const currentUserLabel = preferences.displayName.trim() || roleLabel;
  const botDraftKey = selected ? `bot:${selected}:${selectedThreadId ?? "legacy"}` : "";
  const groupDraftKey = selectedGroupId ? `group:${selectedGroupId}` : "";
  const draft = botDraftKey ? drafts[botDraftKey] ?? "" : "";
  const groupDraft = groupDraftKey ? drafts[groupDraftKey] ?? "" : "";
  const setDraft = useCallback((next: string | ((current: string) => string)) => {
    if (!botDraftKey) return;
    setDrafts((current) => {
      const value = typeof next === "function" ? next(current[botDraftKey] ?? "") : next;
      const updated = { ...current };
      delete updated[botDraftKey];
      if (value) updated[botDraftKey] = value.slice(0, MAX_DRAFT_LENGTH);
      return updated;
    });
  }, [botDraftKey]);
  const setGroupDraft = useCallback((next: string | ((current: string) => string)) => {
    if (!groupDraftKey) return;
    setDrafts((current) => {
      const value = typeof next === "function" ? next(current[groupDraftKey] ?? "") : next;
      const updated = { ...current };
      delete updated[groupDraftKey];
      if (value) updated[groupDraftKey] = value.slice(0, MAX_DRAFT_LENGTH);
      return updated;
    });
  }, [groupDraftKey]);
  const groupMentions = useMemo<MessageMentions>(() => {
    const mentions: MessageMentions = { user: { kind: "user", label: currentUserLabel } };
    for (const bot of bots) mentions[bot.name.toLocaleLowerCase()] = { kind: "bot", label: getBotDisplayName(bot, bot.name) };
    return mentions;
  }, [bots, currentUserLabel]);
  const canAdmin = accessRole === "admin";
  const supportsThreads = Boolean(api.listThreads && api.createThread && api.getThread && api.sendThreadMessage && api.renameThread && api.archiveThread);
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase(locale);
  const localHermesUnavailable = Boolean(diagnostics && diagnostics.hermes.status === "error" && isLocalHermesUrl(diagnostics.hermes.baseUrl));
  const visibleBots = useMemo(() => bots.filter((bot) => {
    if (!normalizedSearch) return true;
    return [bot.name, bot.displayName, bot.title, bot.description, bot.gatewayLabel]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase(locale).includes(normalizedSearch));
  }), [bots, locale, normalizedSearch]);
  const botGateways = useMemo(() => {
    const sections = new Map<string, { id: string; label: string; isDefault: boolean; bots: Bot[] }>();
    for (const bot of visibleBots) {
      const id = bot.gatewayId || "primary";
      if (!sections.has(id)) sections.set(id, { id, label: bot.gatewayLabel || "Hermes", isDefault: Boolean(bot.gatewayDefault), bots: [] });
      sections.get(id)!.bots.push(bot);
    }
    return [...sections.values()].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }, [visibleBots]);
  const visibleGroups = useMemo(() => groups.filter((group) => {
    if (!normalizedSearch) return true;
    return [group.name, ...group.members].some((value) => value.toLocaleLowerCase(locale).includes(normalizedSearch));
  }), [groups, locale, normalizedSearch]);
  const visibleRecentThreads = useMemo(() => normalizedSearch ? recentThreads.filter((thread) => {
    const bot = bots.find((item) => item.name === thread.bot);
    return [thread.title, thread.preview, thread.bot, bot?.title, bot?.displayName]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase(locale).includes(normalizedSearch));
  }) : [], [bots, locale, normalizedSearch, recentThreads]);

  const lastBotMessage = conversation?.messages?.at(-1)?.text ?? "";
  const lastGroupMessage = selectedGroup?.messages?.at(-1)?.text ?? "";
  const previousUserMessages = useMemo(() => {
    let previous: Conversation["messages"][number] | undefined;
    return (conversation?.messages ?? []).map((message) => {
      const result = previous;
      if (message.role === "user" && !message.attribution) previous = message;
      return result;
    });
  }, [conversation?.messages]);
  const hiddenBotMessageCount = Math.max(0, (conversation?.messages.length ?? 0) - visibleBotMessageCount);
  const visibleBotMessages = conversation?.messages.slice(hiddenBotMessageCount) ?? [];

  const loadBots = useCallback(async () => {
    setBotsLoading(true);
    setBotsError("");
    try {
      setBots(await api.listBots());
    } catch (cause) {
      setBotsError(String(cause));
    } finally {
      setBotsLoading(false);
    }
  }, [api]);

  const loadGroups = useCallback(async () => {
    if (!api.listGroups) {
      setGroupsLoading(false);
      return;
    }
    setGroupsLoading(true);
    setGroupsError("");
    try {
      setGroups(await api.listGroups());
    } catch (cause) {
      setGroupsError(String(cause));
    } finally {
      setGroupsLoading(false);
    }
  }, [api]);

  const loadDiagnostics = useCallback(async () => {
    if (!api.getDiagnostics) {
      setDiagnosticsLoading(false);
      return;
    }
    setDiagnosticsLoading(true);
    setDiagnosticsError("");
    try {
      const result = await api.getDiagnostics();
      setDiagnostics(result);
      const needsAuthentication = result.authentication.status === "error" && result.authentication.detail === "Hermes session token is required";
      const unavailableOnFirstLaunch = firstLaunch.current && result.hermes.status === "error" && isLocalHermesUrl(result.hermes.baseUrl);
      if (needsAuthentication || unavailableOnFirstLaunch) {
        // An unavailable primary must not hide Bots on a healthy additional gateway.
        const available = await api.listBots().catch(() => []);
        setFirstRun(!available.some((bot) => bot.gatewayId && bot.gatewayId !== "primary"));
      }
      if (isHermesReady(result)) {
        firstLaunch.current = false;
        window.localStorage.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, "true");
      }
    } catch (cause) {
      setDiagnosticsError(String(cause));
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [api]);

  useLayoutEffect(() => {
    const container = selected ? botMessagesRef.current : selectedGroupId ? groupMessagesRef.current : null;
    if (!container) return;
    const context = selected
      ? `bot:${selected}:${selectedThreadId ?? conversation?.sessionId ?? "loading"}`
      : `group:${selectedGroupId ?? "loading"}`;
    const sticksToBottom = selected ? botSticksToBottom : groupSticksToBottom;
    const autoScrolling = selected ? botAutoScrolling : groupAutoScrolling;
    if (lastScrollContext.current !== context) sticksToBottom.current = true;
    lastScrollContext.current = context;
    if (!sticksToBottom.current) return;
    autoScrolling.current = true;
    let framesRemaining = 6;
    let frame = 0;
    const settleAtBottom = () => {
      container.scrollTop = container.scrollHeight;
      framesRemaining -= 1;
      if (framesRemaining > 0) frame = window.requestAnimationFrame(settleAtBottom);
      else frame = window.requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
        autoScrolling.current = false;
      });
    };
    settleAtBottom();
    return () => {
      window.cancelAnimationFrame(frame);
      autoScrolling.current = false;
    };
  }, [conversation?.messages.length, conversation?.dispatches, conversation?.sessionId, lastBotMessage, lastGroupMessage, selected, selectedGroupId, selectedThreadId]);

  useLayoutEffect(() => {
    const previousHeight = pendingBotPrependHeight.current;
    const container = botMessagesRef.current;
    if (previousHeight === null || !container) return;
    container.scrollTop += container.scrollHeight - previousHeight;
    pendingBotPrependHeight.current = null;
  }, [visibleBotMessageCount]);

  useEffect(() => {
    void loadBots();
    api.getAccess?.().then((access) => { setAccessRole(access.role); setAccessError(""); }).catch((cause) => { setAccessRole("viewer"); setAccessError(String(cause)); }).finally(() => setAccessLoading(false));
    api.listMachines?.().then(setMachines).catch(() => undefined);
    void loadDiagnostics();
  }, [api, loadBots, loadDiagnostics]);

  useEffect(() => {
    savePreferences(preferences, window.localStorage);
    document.documentElement.dataset.density = preferences.density;
    document.documentElement.classList.toggle("reduce-motion", preferences.reduceMotion);
    return () => {
      delete document.documentElement.dataset.density;
      document.documentElement.classList.remove("reduce-motion");
    };
  }, [preferences]);

  useEffect(() => {
    latestDrafts.current = drafts;
    const timer = window.setTimeout(() => saveDrafts(drafts, window.localStorage), 150);
    return () => window.clearTimeout(timer);
  }, [drafts]);

  useEffect(() => {
    const flushDrafts = () => saveDrafts(latestDrafts.current, window.localStorage);
    window.addEventListener("pagehide", flushDrafts);
    return () => {
      window.removeEventListener("pagehide", flushDrafts);
      flushDrafts();
    };
  }, []);

  useEffect(() => {
    const key = conversation && selected ? `${selected}:${conversation.sessionId}` : "";
    const previous = previousBotRun.current;
    if (key && previous.key === key && previous.running && !conversation?.running && preferences.desktopNotifications && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      sendDesktopNotification(t("Response ready"), t("{name} finished responding.", { name: activeTitle }));
    }
    previousBotRun.current = { key, running: Boolean(conversation?.running) };
  }, [activeTitle, conversation?.running, conversation?.sessionId, preferences.desktopNotifications, selected, t]);

  useEffect(() => {
    const key = selectedGroup?.id || "";
    const previous = previousGroupRun.current;
    if (key && previous.key === key && previous.running && !selectedGroup?.running && preferences.desktopNotifications && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      sendDesktopNotification(t("Group result ready"), t("{name} finished its discussion.", { name: activeTitle }));
    }
    previousGroupRun.current = { key, running: Boolean(selectedGroup?.running) };
  }, [activeTitle, preferences.desktopNotifications, selectedGroup?.id, selectedGroup?.running, t]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (!supportsThreads) {
      setRecentThreads([]);
      setRecentThreadsLoaded(true);
      return;
    }
    if (botsLoading) {
      setRecentThreadsLoaded(false);
      return;
    }
    let active = true;
    setRecentThreadsLoaded(false);
    Promise.allSettled(bots.map((bot) => api.listThreads!(bot.name))).then((results) => {
      if (!active) return;
      const next = results.flatMap((result) => result.status === "fulfilled" && Array.isArray(result.value) ? result.value : []);
      setRecentThreads(next.sort((left, right) => right.startedAt - left.startedAt).slice(0, 40));
      setRecentThreadsLoaded(true);
    });
    return () => { active = false; };
  }, [api, bots, botsLoading, supportsThreads]);

  useEffect(() => {
    if (autoRestoreAttempted.current || botsLoading || groupsLoading || accessLoading) return;
    const lastActive = storedLastActive();
    if (lastActive?.scope === "bot" && bots.some((bot) => bot.name === lastActive.id)) {
      autoRestoreAttempted.current = true;
      void selectBot(lastActive.id, lastActive.threadId);
      return;
    }
    if (lastActive?.scope === "group" && groups.some((group) => group.id === lastActive.id)) {
      autoRestoreAttempted.current = true;
      selectGroup(lastActive.id);
      return;
    }
    if (supportsThreads && !recentThreadsLoaded) return;
    autoRestoreAttempted.current = true;
    const latestThread = recentThreads[0];
    if (latestThread && bots.some((bot) => bot.name === latestThread.bot)) {
      void selectBot(latestThread.bot, lastThreadForBot(latestThread.bot) ?? latestThread.id);
    }
  }, [accessLoading, bots, botsLoading, groups, groupsLoading, recentThreads, recentThreadsLoaded, supportsThreads]);

  useEffect(() => {
    if (!selected || !selectedThreadId || !supportsThreads || !api.watchThread) {
      setThreadStreamStatus("idle");
      return;
    }
    setThreadStreamStatus("connecting");
    let active = true;
    const stop = api.watchThread(selected, selectedThreadId, (event) => {
      const owner = event.type === "conversation" ? event.conversation.bot : event.bot;
      const threadId = event.type === "conversation" ? event.conversation.sessionId : event.threadId;
      if (!active || owner !== selected || threadId !== selectedThreadId) return;
      if (event.type === "conversation") {
        setConversation(event.conversation);
        syncThread(event.conversation);
      } else if (event.type === "delta") {
        setConversation((current) => {
          if (!current || current.sessionId !== event.threadId) return current;
          const messages = current.messages.map((message) => ({ ...message }));
          const last = messages.at(-1);
          if (last?.role === "assistant") last.text += event.text;
          else messages.push({ role: "assistant", text: event.text });
          return { ...current, running: true, messages };
        });
        setThreads((current) => current.map((thread) => thread.id === event.threadId ? { ...thread, running: true } : thread));
      } else {
        setThreads((current) => current.filter((thread) => thread.id !== event.threadId));
        setRecentThreads((current) => current.filter((thread) => thread.bot !== event.bot || thread.id !== event.threadId));
        setConversation((current) => current?.sessionId === event.threadId ? null : current);
        setSelectedThreadId((current) => current === event.threadId ? null : current);
      }
    }, (status) => {
      if (active) setThreadStreamStatus(status);
    });
    return () => { active = false; stop(); };
  }, [api, selected, selectedThreadId, supportsThreads]);

  useEffect(() => {
    if (!selected || !conversation?.running || (!api.getConversation && !api.getThread)) return;
    if (supportsThreads && selectedThreadId && api.watchThread && threadStreamStatus !== "disconnected") return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const next = supportsThreads && selectedThreadId
          ? await api.getThread!(selected, selectedThreadId)
          : await api.getConversation!(selected);
        if (cancelled) return;
        setConversation(next);
        syncThread(next);
        if (next.running) timer = window.setTimeout(poll, 700);
      } catch (cause) {
        if (cancelled) return;
        setError(String(cause));
        timer = window.setTimeout(poll, 1_500);
      }
    };
    timer = window.setTimeout(poll, 700);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, conversation?.running, selected, selectedThreadId, supportsThreads, threadStreamStatus]);

  function syncThread(next: Conversation) {
    if (!supportsThreads) return;
    setThreads((current) => current.map((thread) => thread.id === next.sessionId ? {
      ...thread,
      preview: next.messages.at(-1)?.text || thread.preview,
      messageCount: next.messages.length,
      running: next.running
    } : thread));
    setRecentThreads((current) => current.map((thread) => thread.bot === next.bot && thread.id === next.sessionId ? {
      ...thread,
      preview: next.messages.at(-1)?.text || thread.preview,
      messageCount: next.messages.length,
      running: next.running
    } : thread));
  }

  function replaceRecentThreads(bot: string, nextThreads: BotThread[]) {
    setRecentThreads((current) => [...current.filter((thread) => thread.bot !== bot), ...nextThreads]
      .sort((left, right) => right.startedAt - left.startedAt)
      .slice(0, 40));
  }

  useEffect(() => {
    if (!selectedGroup?.running || !api.listGroups) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const next = await api.listGroups!();
        if (cancelled) return;
        setGroups(next);
        if (next.find((group) => group.id === selectedGroup.id)?.running) timer = window.setTimeout(poll, 700);
      } catch (cause) {
        if (cancelled) return;
        setError(String(cause));
        timer = window.setTimeout(poll, 1_500);
      }
    };
    timer = window.setTimeout(poll, 700);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, selectedGroup?.id, selectedGroup?.running]);

  async function selectBot(name: string, preferredThreadId?: string) {
    const requestId = ++selectionRequest.current;
    setSelected(name);
    setSelectedGroupId(null);
    setDetailsOpen(false);
    setReplyTarget(null);
    setFailedSend(null);
    setBotAttachments([]);
    setGroupAttachments([]);
    setAttachmentError("");
    setConversation(null);
    setConversationLoading(true);
    setConversationError("");
    setVisibleBotMessageCount(MESSAGE_WINDOW_SIZE);
    pendingBotPrependHeight.current = null;
    setThreads([]);
    setSelectedThreadId(null);
    setError("");
    botSticksToBottom.current = true;
    try {
      const nextThreads = supportsThreads ? await api.listThreads!(name) : [];
      if (selectionRequest.current !== requestId) return;
      if (supportsThreads) {
        let availableThreads = nextThreads;
        let nextConversation: Conversation | null = null;
        if (availableThreads[0]) {
          const rememberedThread = preferredThreadId || lastThreadForBot(name);
          const initialThread = availableThreads.find((thread) => thread.id === rememberedThread) ?? availableThreads[0];
          nextConversation = await api.getThread!(name, initialThread.id);
        } else if (canOperate) {
          nextConversation = await api.createThread!(name);
          availableThreads = await api.listThreads!(name);
        }
        if (selectionRequest.current !== requestId) return;
        replaceRecentThreads(name, availableThreads);
        setThreads(availableThreads);
        setSelectedThreadId(nextConversation?.sessionId ?? availableThreads[0]?.id ?? null);
        setConversation(nextConversation);
        rememberLastThread(name, nextConversation?.sessionId);
        rememberLastActive({ scope: "bot", id: name, ...(nextConversation?.sessionId ? { threadId: nextConversation.sessionId } : {}) });
      } else {
        const nextConversation = api.getConversation ? await api.getConversation(name) : null;
        if (selectionRequest.current !== requestId) return;
        setConversation(nextConversation);
        rememberLastActive({ scope: "bot", id: name });
      }
    } catch (cause) {
      if (selectionRequest.current === requestId) setConversationError(String(cause));
    } finally {
      if (selectionRequest.current === requestId) setConversationLoading(false);
    }
  }

  function selectGroup(groupId: string) {
    selectionRequest.current += 1;
    setSelected(null);
    setSelectedGroupId(groupId);
    setDetailsOpen(false);
    setReplyTarget(null);
    setFailedSend(null);
    setBotAttachments([]);
    setGroupAttachments([]);
    setAttachmentError("");
    setConversationLoading(false);
    setConversationError("");
    setConversation(null);
    setThreads([]);
    setSelectedThreadId(null);
    setError("");
    groupSticksToBottom.current = true;
    rememberLastActive({ scope: "group", id: groupId });
  }

  async function selectThread(threadId: string) {
    if (!selected || !api.getThread || threadId === selectedThreadId) return;
    const requestId = ++selectionRequest.current;
    setSelectedThreadId(threadId);
    setConversation(null);
    setConversationLoading(true);
    setConversationError("");
    setVisibleBotMessageCount(MESSAGE_WINDOW_SIZE);
    pendingBotPrependHeight.current = null;
    setReplyTarget(null);
    setFailedSend(null);
    setBotAttachments([]);
    setAttachmentError("");
    setError("");
    botSticksToBottom.current = true;
    try {
      const next = await api.getThread(selected, threadId);
      if (selectionRequest.current === requestId) {
        setConversation(next);
        rememberLastThread(selected, next.sessionId);
        rememberLastActive({ scope: "bot", id: selected, threadId: next.sessionId });
      }
    } catch (cause) {
      if (selectionRequest.current === requestId) setConversationError(String(cause));
    } finally {
      if (selectionRequest.current === requestId) setConversationLoading(false);
    }
  }

  function showOlderBotMessages() {
    const container = botMessagesRef.current;
    pendingBotPrependHeight.current = container?.scrollHeight ?? null;
    botSticksToBottom.current = false;
    setVisibleBotMessageCount((current) => Math.min(conversation?.messages.length ?? current, current + MESSAGE_WINDOW_SIZE));
  }

  async function createBotThread() {
    if (!selected || !api.createThread || !api.listThreads) return;
    const requestId = ++selectionRequest.current;
    setError("");
    setConversationLoading(true);
    setConversationError("");
    botSticksToBottom.current = true;
    try {
      const next = await api.createThread(selected);
      const availableThreads = await api.listThreads(selected);
      if (selectionRequest.current !== requestId) return;
      setThreads(availableThreads);
      replaceRecentThreads(selected, availableThreads);
      setSelectedThreadId(next.sessionId);
      setConversation(next);
      rememberLastThread(selected, next.sessionId);
      rememberLastActive({ scope: "bot", id: selected, threadId: next.sessionId });
      setReplyTarget(null);
      setFailedSend(null);
      window.requestAnimationFrame(() => botInputRef.current?.focus());
    } catch (cause) {
      if (selectionRequest.current === requestId) setConversationError(String(cause));
    } finally {
      if (selectionRequest.current === requestId) setConversationLoading(false);
    }
  }

  function beginRenameThread(thread: BotThread) {
    setRenamingThread(thread);
    setRenameThreadTitle(thread.title);
  }

  async function submitThreadRename(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !api.renameThread || !renamingThread) return;
    const title = renameThreadTitle.trim();
    if (!title) return;
    try {
      const updated = await api.renameThread(selected, renamingThread.id, title);
      setThreads((current) => current.map((item) => item.id === updated.id ? updated : item));
      setRecentThreads((current) => current.map((item) => item.bot === selected && item.id === updated.id ? updated : item));
      setRenamingThread(null);
      setRenameThreadTitle("");
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function archiveBotThread(thread: BotThread) {
    if (!selected || !api.archiveThread || !api.listThreads || !window.confirm(t("Archive the “{name}” thread?", { name: thread.title }))) return;
    try {
      await api.archiveThread(selected, thread.id);
      const remaining = await api.listThreads(selected);
      setThreads(remaining);
      replaceRecentThreads(selected, remaining);
      if (thread.id !== selectedThreadId) return;
      botSticksToBottom.current = true;
      const next = remaining[0];
      setSelectedThreadId(next?.id ?? null);
      setConversation(next && api.getThread ? await api.getThread(selected, next.id) : null);
      rememberLastThread(selected, next?.id);
      if (next) rememberLastActive({ scope: "bot", id: selected, threadId: next.id });
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function addTextAttachments(scope: "bot" | "group", files: FileList | null) {
    if (!files?.length) return;
    const requestId = selectionRequest.current;
    setAttachmentError("");
    const current = scope === "bot" ? botAttachments : groupAttachments;
    const available = Math.max(0, MAX_TEXT_ATTACHMENTS - current.length);
    const selectedFiles = [...files].slice(0, available);
    if (selectedFiles.length < files.length) {
      setAttachmentError(t("You can attach up to {count} text files.", { count: MAX_TEXT_ATTACHMENTS }));
    }
    const accepted: TextAttachment[] = [];
    for (const file of selectedFiles) {
      if (!textAttachmentSupported(file)) {
        setAttachmentError(t("{name} is not a supported text file.", { name: file.name }));
        continue;
      }
      if (file.size > MAX_TEXT_ATTACHMENT_BYTES) {
        setAttachmentError(t("{name} is larger than 256 KB.", { name: file.name }));
        continue;
      }
      let content = "";
      try {
        content = await file.text();
      } catch {
        if (selectionRequest.current !== requestId) return;
        setAttachmentError(t("Could not read {name}.", { name: file.name }));
        continue;
      }
      if (selectionRequest.current !== requestId) return;
      const attachment = { name: file.name, type: file.type || "text/plain", size: file.size, content };
      const encodedSize = new TextEncoder().encode(JSON.stringify([...current, ...accepted, attachment])).byteLength;
      if (encodedSize > MAX_TEXT_ATTACHMENTS_PAYLOAD_BYTES) {
        setAttachmentError(t("The attached files exceed 512 KB in total."));
        break;
      }
      accepted.push(attachment);
    }
    if (!accepted.length) return;
    if (scope === "bot") setBotAttachments((items) => [...items, ...accepted].slice(0, MAX_TEXT_ATTACHMENTS));
    else setGroupAttachments((items) => [...items, ...accepted].slice(0, MAX_TEXT_ATTACHMENTS));
  }

  async function submitMessage(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!selected || (!text && botAttachments.length === 0) || (!api.sendMessage && !api.sendThreadMessage)) return;
    const requestId = selectionRequest.current;
    const generation = gatewayGeneration.current;
    const sentAttachments = botAttachments;
    const reply = replyTarget?.scope === "bot" ? replyTarget : null;
    const wireText = replyWireText(attachmentWireText(text, botAttachments, t("Review the attached files and answer my request.")), reply, t);
    setDraft("");
    setReplyTarget(null);
    setFailedSend(null);
    setError("");
    try {
      const next = supportsThreads && selectedThreadId
        ? await api.sendThreadMessage!(selected, selectedThreadId, wireText)
        : await api.sendMessage!(selected, wireText);
      if (selectionRequest.current !== requestId) return;
      setConversation(next);
      syncThread(next);
      setBotAttachments((items) => items.filter((item) => !sentAttachments.includes(item)));
    } catch (cause) {
      if (gatewayGeneration.current !== generation) return;
      setDraft((current) => current ? `${text}\n\n${current}` : text);
      if (selectionRequest.current !== requestId) return;
      setReplyTarget(reply);
      setFailedSend({ scope: "bot", wireText, draftText: text, reply, failure: failureFromCause(cause) });
    }
  }

  async function submitGroupMessage(event: React.FormEvent) {
    event.preventDefault();
    const text = groupDraft.trim();
    if (!selectedGroup || (!text && groupAttachments.length === 0) || !api.sendGroupMessage) return;
    const requestId = selectionRequest.current;
    const generation = gatewayGeneration.current;
    const sentAttachments = groupAttachments;
    const reply = replyTarget?.scope === "group" ? replyTarget : null;
    const wireText = replyWireText(attachmentWireText(text, groupAttachments, t("Review the attached files and answer my request.")), reply, t);
    setGroupDraft("");
    setReplyTarget(null);
    setFailedSend(null);
    setError("");
    try {
      const nextGroup = reply?.thread ? await api.sendGroupMessage(selectedGroup.id, wireText, reply.thread) : await api.sendGroupMessage(selectedGroup.id, wireText);
      if (gatewayGeneration.current !== generation) return;
      setGroups((current) => current.map((group) => group.id === nextGroup.id ? nextGroup : group));
      if (selectionRequest.current !== requestId) return;
      setGroupAttachments((items) => items.filter((item) => !sentAttachments.includes(item)));
    } catch (cause) {
      if (gatewayGeneration.current !== generation) return;
      setGroupDraft((current) => current ? `${text}\n\n${current}` : text);
      if (selectionRequest.current !== requestId) return;
      setReplyTarget(reply);
      setFailedSend({ scope: "group", wireText, draftText: text, reply, failure: failureFromCause(cause) });
    }
  }

  async function stopGroup() {
    if (!selectedGroup || !api.stopGroup) return;
    setError("");
    try {
      const nextGroup = await api.stopGroup(selectedGroup.id);
      setGroups((current) => current.map((group) => group.id === nextGroup.id ? nextGroup : group));
    } catch (cause) { setError(String(cause)); }
  }

  function beginReply(scope: "bot" | "group", author: string, text: string, thread?: string) {
    setReplyTarget({ scope, author, text, ...(thread ? { thread } : {}) });
    setFailedSend(null);
    window.requestAnimationFrame(() => (scope === "bot" ? botInputRef.current : groupInputRef.current)?.focus());
  }

  async function retryWireText(scope: "bot" | "group", wireText: string, draftText = wireText, reply: ReplyTarget | null = null) {
    if (retrying) return;
    const requestId = selectionRequest.current;
    const generation = gatewayGeneration.current;
    const sentAttachments = scope === "bot" ? botAttachments : groupAttachments;
    setRetrying(true);
    setFailedSend(null);
    setError("");
    try {
      if (scope === "bot" && selected && (api.sendMessage || api.sendThreadMessage)) {
        const next = supportsThreads && selectedThreadId
          ? await api.sendThreadMessage!(selected, selectedThreadId, wireText)
          : await api.sendMessage!(selected, wireText);
        if (selectionRequest.current !== requestId) return;
        setConversation(next);
        syncThread(next);
        setDraft((current) => current === draftText ? "" : current);
        setBotAttachments((items) => items.filter((item) => !sentAttachments.includes(item)));
      } else if (scope === "group" && selectedGroup && api.sendGroupMessage) {
        const nextGroup = reply?.thread ? await api.sendGroupMessage(selectedGroup.id, wireText, reply.thread) : await api.sendGroupMessage(selectedGroup.id, wireText);
        if (gatewayGeneration.current !== generation) return;
        setGroups((current) => current.map((group) => group.id === nextGroup.id ? nextGroup : group));
        if (selectionRequest.current !== requestId) return;
        setGroupDraft((current) => current === draftText ? "" : current);
        setGroupAttachments((items) => items.filter((item) => !sentAttachments.includes(item)));
      }
    } catch (cause) {
      if (selectionRequest.current !== requestId) return;
      setFailedSend({ scope, wireText, draftText, reply, failure: failureFromCause(cause) });
    } finally {
      setRetrying(false);
    }
  }

  function retryFailedSend() {
    if (!failedSend) return;
    void retryWireText(failedSend.scope, failedSend.wireText, failedSend.draftText, failedSend.reply);
  }

  async function submitNewBot(event: React.FormEvent) {
    event.preventDefault();
    setCreateError("");
    try {
      const title = newTitle.trim();
      const description = newDescription.trim();
      const bot = await api.createBot({
        name: newName.trim().toLocaleLowerCase(locale),
        ...(api.listGateways ? { gatewayId: newBotGateway } : {}),
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
        avatar: newAvatar
      });
      setBots((current) => [...current, bot]);
      setCreating(false);
      setNewName("");
      setNewNameEdited(false);
      setNewTitle("");
      setNewDescription("");
      setNewAvatar({ shape: "blobatar::round" });
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function submitNewGroup(event: React.FormEvent) {
    event.preventDefault();
    if (!api.createGroup) return;
    const members = [...new Set(newGroupMembers)].slice(0, 6);
    if (members.length < 2 || members.length > 6 || !newGroupName.trim()) return;
    setError("");
    try {
      const group = await api.createGroup(newGroupName.trim(), members);
      setGroups((current) => [...current, group]);
      setSelected(null);
      setSelectedGroupId(group.id);
      setDetailsOpen(false);
      setCreatingGroup(false);
      setNewGroupName("");
      setNewGroupMembers([]);
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function removeSelectedBot() {
    if (!selected || !window.confirm(t("Permanently delete the “{name}” Bot?", { name: getBotDisplayName(selectedBot, selected) }))) return;
    try {
      await api.deleteBot(selected);
      setBots((current) => current.filter((bot) => bot.name !== selected));
      setSelected(null);
      setConversation(null);
    } catch (cause) {
      setError(String(cause));
    }
  }

  function openAvatarEditor() {
    if (!selectedBot) return;
    setAvatarValue(selectedBot.avatar?.image ? { image: selectedBot.avatar.image } : { shape: selectedBot.avatar?.shape || "blobatar::round", ...(selectedBot.avatar?.color ? { color: selectedBot.avatar.color } : {}) });
    setEditingAvatar(true);
  }

  function handleBotSaved(bot: Bot) {
    setBots((current) => current.map((item) => item.name === bot.name ? bot : item));
    setBotConfigurationVersion((version) => version + 1);
  }

  function handleBotImported(bot: Bot) {
    setBots((current) => [...current.filter((item) => item.name !== bot.name), bot]);
  }

  const handleGatewayChanged = useCallback(async () => {
    selectionRequest.current += 1;
    gatewayGeneration.current += 1;
    autoRestoreAttempted.current = true;
    setSelected(null);
    setSelectedGroupId(null);
    setSelectedThreadId(null);
    setConversation(null);
    setThreads([]);
    setRecentThreads([]);
    setBots([]);
    setMachines([]);
    setGroups([]);
    setBotsLoading(true);
    setBotsError("");
    setGroupsError("");
    setError("");
    try {
      const [nextBots, nextMachines, nextGroups, nextDiagnostics] = await Promise.all([
        api.listBots(),
        api.listMachines?.() ?? Promise.resolve([]),
        api.listGroups?.() ?? Promise.resolve([]),
        api.getDiagnostics?.()
      ]);
      if (nextDiagnostics) {
        setDiagnostics(nextDiagnostics);
        if (!isHermesReady(nextDiagnostics) && !nextBots.length) throw new Error("The connection could not be completed. Retry or open the setup guide below.");
      }
      if (!api.listGateways) {
        window.localStorage.removeItem(LAST_THREADS_STORAGE_KEY);
        window.localStorage.removeItem(LAST_ACTIVE_STORAGE_KEY);
      }
      setBots(nextBots);
      setMachines(nextMachines);
      setGroups(nextGroups);
      firstLaunch.current = false;
      window.localStorage.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, "true");
      setFirstRun(false);
    } catch (cause) {
      setError(String(cause));
      throw cause;
    } finally {
      setBotsLoading(false);
    }
  }, [api]);

  async function saveAvatar() {
    if (!selectedBot || !api.updateBotAvatar) return;
    try {
      const update = selectedBot.avatar?.image && !avatarValue.image ? { ...avatarValue, image: "" } : avatarValue;
      await api.updateBotAvatar(selectedBot.name, update);
      setBots((current) => current.map((bot) => bot.name === selectedBot.name
        ? { ...bot, avatar: avatarValue }
        : bot));
      setEditingAvatar(false);
    } catch (cause) {
      setError(String(cause));
    }
  }

  function toggleGroupMember(name: string) {
    setNewGroupMembers((current) => current.includes(name)
      ? current.filter((member) => member !== name)
      : current.length < 6 ? [...current, name] : current);
  }

  function findBot(name: string) {
    return bots.find((bot) => bot.name === name);
  }

  function botPreview(bot: Bot) {
    if (selected === bot.name && conversation?.running) return t("Hermes is working…");
    if (selected === bot.name && conversation?.messages.length) return clippedPreview(conversation.messages.at(-1)?.text || "", t("New Hermes thread"));
    return clippedPreview(bot.description || "", t("New Hermes thread"));
  }

  function threadLabel(thread: BotThread) {
    return thread.title === "New thread" ? t("New thread") : thread.title;
  }

  function navigateThreadTabs(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const lastIndex = threads.length - 1;
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = index === lastIndex ? 0 : index + 1;
    else if (event.key === "ArrowLeft") nextIndex = index === 0 ? lastIndex : index - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = lastIndex;
    else return;
    event.preventDefault();
    const nextThread = threads[nextIndex];
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[nextIndex]?.focus();
    if (nextThread) void selectThread(nextThread.id);
  }

  function groupPreview(group: GroupRoom) {
    if (group.running) return t("The Bots are consulting each other…");
    const last = group.messages.at(-1);
    if (last) return clippedPreview(last.text.replace(/@([\p{L}\p{N}_-]+)/giu, (token, handle: string) => {
      const mention = groupMentions[handle.toLocaleLowerCase()];
      return mention ? `@${mention.label}` : token;
    }), t("Group conversation"));
    return group.members.join(", ");
  }

  function submitOnEnter(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    const shouldSubmit = preferences.sendOnEnter ? !event.shiftKey : event.ctrlKey || event.metaKey;
    if (!shouldSubmit) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  const groupMentionQuery = groupDraft.match(/(?:^|\s)@([\p{L}\p{N}_-]*)$/u)?.[1].toLocaleLowerCase(locale) ?? null;
  const groupMentionSuggestions = selectedGroup && groupMentionQuery !== null && !groupMentionDismissed
    ? selectedGroup.members.filter((member) => {
      const bot = findBot(member);
      return [member, bot?.displayName, bot?.title]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase(locale).split(/\s+/).some((word) => word.startsWith(groupMentionQuery)));
    })
    : [];

  function insertGroupMention(member: string) {
    setGroupDraft((current) => current.replace(/(^|\s)@[\p{L}\p{N}_-]*$/u, `$1@${member} `));
    setGroupMentionIndex(0);
    setGroupMentionDismissed(false);
    window.requestAnimationFrame(() => groupInputRef.current?.focus());
  }

  function closeSettings() {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
  }

  function openSettings(section: SettingsSection = "general") {
    setSettingsInitialSection(section);
    setSettingsOpen(true);
  }

  function submitGroupOnEnter(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (groupMentionSuggestions.length > 0 && !event.nativeEvent.isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setGroupMentionIndex((current) => (current + direction + groupMentionSuggestions.length) % groupMentionSuggestions.length);
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        setGroupMentionIndex(event.key === "Home" ? 0 : groupMentionSuggestions.length - 1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setGroupMentionDismissed(true);
        return;
      }
    }
    const selectedMention = groupMentionSuggestions[Math.min(groupMentionIndex, groupMentionSuggestions.length - 1)];
    if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.nativeEvent.isComposing && selectedMention) {
      event.preventDefault();
      insertGroupMention(selectedMention);
      return;
    }
    submitOnEnter(event);
  }

  const initialLoading = botsLoading || (!botsError && bots.length === 0 && groupsLoading);
  const initialLoadError = bots.length === 0 && groups.length === 0 ? botsError || groupsError : "";
  const hasNoConversations = !botsLoading && !groupsLoading && !botsError && !groupsError && bots.length === 0 && groups.length === 0;

  function showHome() {
    selectionRequest.current += 1;
    setSelected(null);
    setSelectedGroupId(null);
    setSelectedThreadId(null);
    setConversation(null);
    setThreads([]);
    setDetailsOpen(false);
    setReplyTarget(null);
    setFailedSend(null);
    setError("");
    if (window.matchMedia?.("(max-width: 640px)").matches) {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }

  function openBotCreator() {
    setCreateError("");
    setNewNameEdited(false);
    setCreating(true);
  }

  function openRoutines() {
    setDetailsOpen(true);
    window.requestAnimationFrame(() => document.getElementById("bot-routines")?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  }

  function openRecentThread(thread: BotThread) {
    void selectBot(thread.bot, thread.id);
  }

  async function startSuggestedPrompt(bot: Bot, prompt: string) {
    await selectBot(bot.name);
    const key = `bot:${bot.name}:${lastThreadForBot(bot.name) ?? "legacy"}`;
    setDrafts((current) => ({ ...current, [key]: prompt }));
    window.requestAnimationFrame(() => botInputRef.current?.focus());
  }

  return (
    <main className={`shell ${hasDetails && detailsOpen ? "details-open" : "details-closed"} ${hasDetails ? "mobile-conversation" : "mobile-inbox"}`}>
      <aside className="sidebar" aria-label={t("Conversation threads")} aria-hidden={firstRun || undefined} inert={firstRun || undefined}>
        <div className="sidebar-topbar">
          <button className="brand" type="button" aria-label={t("Open ByBots home")} onClick={showHome}><strong>ByBots</strong></button>
          {canAdmin && <IconButton className="new-chat-button" label={t("New Bot")} onClick={openBotCreator}><Plus size={20} /></IconButton>}
        </div>

        <label className="search-box"><Search size={16} aria-hidden="true" /><span className="sr-only">{t("Search conversations")}</span><input ref={searchInputRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t("Search")} />{searchQuery && <button type="button" aria-label={t("Clear search")} onClick={() => setSearchQuery("")}><X size={14} /></button>}</label>

        <div className="thread-scroll">
          {normalizedSearch && visibleRecentThreads.length > 0 && <section className="thread-section search-thread-results" aria-labelledby="search-threads-heading">
            <div className="thread-section-head"><h2 id="search-threads-heading">{t("Threads")}</h2><span>{visibleRecentThreads.length}</span></div>
            <nav className="thread-list" aria-label={t("Matching threads")}>{visibleRecentThreads.slice(0, 8).map((thread) => { const bot = findBot(thread.bot); return <button key={`${thread.bot}:${thread.id}`} type="button" className="thread-row" aria-label={t("Open thread {name}", { name: thread.title })} onClick={() => openRecentThread(thread)}><BotAvatar bot={bot ?? { name: thread.bot, system: false }} size={34} /><span className="thread-copy"><span className="thread-line"><strong>{thread.title}</strong>{thread.running && <i className="activity-dot" aria-label={t("In progress")} />}</span><small>{getBotDisplayName(bot, thread.bot)} · {clippedPreview(thread.preview, t("Open this thread to continue."))}</small></span></button>; })}</nav>
          </section>}
          {api.listGroups && <section className="thread-section" aria-labelledby="groups-heading">
            <div className="thread-section-head"><h2 id="groups-heading">{t("Conversations")}</h2>{canAdmin && api.createGroup && <button className="text-action" type="button" aria-label={t("New group")} onClick={() => setCreatingGroup(true)}><CirclePlus size={17} /><span>{t("Group")}</span></button>}</div>
            <nav className="thread-list" aria-label={t("Group conversations")}>
              {visibleGroups.map((group) => <button key={group.id} type="button" className={`thread-row ${selectedGroupId === group.id ? "active" : ""}`} aria-label={t("Open group {name}", { name: group.name })} aria-current={selectedGroupId === group.id ? "page" : undefined} onClick={() => selectGroup(group.id)}><span className="group-avatar"><Users size={19} /><small>{group.members.length}</small></span><span className="thread-copy"><span className="thread-line"><strong>{group.name}</strong>{group.running && <i className="activity-dot" aria-label={t("In progress")} />}</span><small>{groupPreview(group)}</small></span></button>)}
            </nav>
            {groupsLoading && <div className="sidebar-loading" role="status"><span />{t("Loading conversations…")}</div>}
            {!groupsLoading && groupsError && <div className="sidebar-state error-state" role="alert"><strong>{t("Could not load group conversations.")}</strong><button type="button" onClick={() => void loadGroups()}><RotateCcw size={14} />{t("Try again")}</button></div>}
            {!groupsLoading && !groupsError && !normalizedSearch && groups.length === 0 && <p className="sidebar-state">{t("No group conversation yet.")}</p>}
          </section>}

          <section className="thread-section" aria-labelledby="bots-heading">
            <div className="thread-section-head"><h2 id="bots-heading">{t("Bots")}</h2><span>{visibleBots.length}</span></div>
            <nav className="thread-list" aria-label={t("Hermes Bots")}>
              {botGateways.map((gateway) => <section className="bot-gateway-section" key={gateway.id} aria-labelledby={`bot-gateway-${gateway.id}`}>
                <div className="bot-gateway-heading"><h3 id={`bot-gateway-${gateway.id}`} title={gateway.label}>{gateway.label}</h3>{gateway.isDefault && <small>{t("Main gateway")}</small>}<span>{gateway.bots.length}</span></div>
                {gateway.bots.map((bot) => <div className="bot-thread-block" key={bot.name}>
                  <button type="button" className={`thread-row ${selected === bot.name ? "active" : ""}`} aria-label={t("Open Bot {name}", { name: `${getBotDisplayName(bot, bot.name)}${bot.gatewayLabel ? ` · ${bot.gatewayLabel}` : ""}` })} aria-current={selected === bot.name ? "page" : undefined} onClick={() => selectBot(bot.name)}><BotAvatar bot={bot} size={38} /><span className="thread-copy"><span className="thread-line"><strong>{getBotDisplayName(bot, bot.name)}</strong>{bot.system && <em>Hermes</em>}</span><small>{botPreview(bot)}</small></span></button>
                </div>)}
              </section>)}
            </nav>
            {botsLoading && <div className="sidebar-loading" aria-live="polite"><span />{t("Loading Bots…")}</div>}
            {!botsLoading && botsError && <div className="sidebar-state error-state" role="alert"><strong>{t("Could not load Bots.")}</strong><button type="button" onClick={() => void loadBots()}><RotateCcw size={14} />{t("Try again")}</button></div>}
            {!botsLoading && !botsError && !normalizedSearch && bots.length === 0 && <p className="sidebar-state">{t("No Bot available")}</p>}
          </section>
          {normalizedSearch && visibleBots.length === 0 && visibleGroups.length === 0 && visibleRecentThreads.length === 0 ? <p className="no-results">{t("No conversation matches “{query}”.", { query: searchQuery })}</p> : null}
        </div>

        <div className="sidebar-footer"><GatewayStatuses api={api} onOpen={() => openSettings("hermes")} /><button ref={settingsButtonRef} type="button" aria-label={t("Settings")} onClick={() => openSettings()}><Settings size={18} /><span>{t("Settings")}</span></button><div className="account-row"><span className="account-avatar">B</span><span><strong>{accessLoading ? t("Checking access…") : accessError ? t("Access unavailable") : currentUserLabel}</strong>{!api.getGatewayStatuses && <small><i className={diagnostics?.hermes.status === "error" || diagnosticsError ? "offline" : diagnostics?.hermes.status === "warning" ? "warning" : ""} /> {diagnosticsLoading ? t("Checking connection…") : diagnosticsError || !diagnostics ? t("Status unavailable") : diagnostics.hermes.status === "error" ? t("Hermes unavailable") : diagnostics.hermes.status === "warning" ? t("Hermes needs attention") : t("Hermes connected")}</small>}</span></div></div>
      </aside>

      <section className="content" aria-label={t("Conversation")} aria-hidden={firstRun || undefined} inert={firstRun || undefined}>
        <header className="conversation-header"><div className="conversation-title">{hasDetails && <IconButton className="mobile-back-button" label={t("Back to conversations")} onClick={showHome}><ChevronLeft size={22} /></IconButton>}{selectedBot && <BotAvatar bot={selectedBot} size={30} />}{selectedGroup && <span className="mini-group-avatar"><Users size={16} /></span>}<div className="conversation-heading"><h1>{activeTitle}</h1></div></div><div className="conversation-actions">{selectedThread && canAdmin && <><IconButton className="header-icon-action" label={t("Rename thread")} onClick={() => beginRenameThread(selectedThread)}><Pencil size={16} /></IconButton><IconButton className="header-icon-action" label={t("Archive thread")} disabled={selectedThread.running} onClick={() => void archiveBotThread(selectedThread)}><Archive size={16} /></IconButton></>}{selectedBot && api.listRoutines && <button className="routines-shortcut" type="button" onClick={openRoutines}><CalendarClock size={16} /><span>{t("Routines")}</span></button>}{selectedBot && <Suspense fallback={null}><ChatModelSelector api={api} bot={selectedBot} role={accessRole} running={Boolean(conversation?.running)} refreshKey={botConfigurationVersion} /></Suspense>}{selectedGroup && <Suspense fallback={null}><GroupAccessPreview key={selectedGroup.id} api={api} bots={bots} members={selectedGroup.members} /></Suspense>}{hasDetails && <IconButton className="details-toggle" label={detailsOpen ? t("Hide details") : t("Show details")} aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>{detailsOpen ? <ChevronRight size={19} /> : <ChevronLeft size={19} />}<span className="sr-only">{t("Details")}</span></IconButton>}</div></header>

        {!firstRun && diagnosticsError && <div className="connection-banner error-banner" role="alert"><AlertTriangle size={18} /><span><strong>{t("Connection status unavailable")}</strong><small>{t("ByBots could not verify Hermes health.")}</small></span><button type="button" onClick={() => void loadDiagnostics()}><RotateCcw size={16} />{t("Try again")}</button></div>}
        {!firstRun && diagnostics && (diagnostics.hermes.status !== "ready" || diagnostics.hermes.compatible === false) && <div className={`connection-banner ${diagnostics.hermes.compatible === false ? "incompatible-banner" : "offline-banner"}`} role="alert"><AlertTriangle size={18} /><span><strong>{diagnostics.hermes.compatible === false ? t("Hermes version is not supported") : localHermesUnavailable ? t("Local Hermes is not available") : t("Hermes is unavailable")}</strong><small>{localHermesUnavailable ? t("Start Hermes on this computer, then try again. ByBots will reconnect automatically without asking for a token.") : diagnostics.failure ? t(diagnostics.failure.hint) : t("Open diagnostics to review the gateway connection.")}</small></span><button type="button" onClick={() => openSettings("hermes")}><Settings size={16} />{t("Open diagnostics")}</button></div>}
        {!accessLoading && accessError && <div className="permission-banner access-error" role="alert"><AlertTriangle size={18} /><span><strong>{t("Access status unavailable")}</strong><small>{t("Actions stay disabled until the Bridge confirms your access level.")}</small></span></div>}
        {!accessLoading && !accessError && accessRole === "viewer" && <div className="permission-banner" role="note"><AlertTriangle size={18} /><span><strong>{t("Read-only access")}</strong><small>{t("You can review Bots and conversations, but this access level cannot create, edit, or send.")}</small></span></div>}

        {selectedBot && supportsThreads && (threads.length > 0 || canOperate) && <div className="thread-tabs-bar">
          <nav className="thread-tabs" role="tablist" aria-label={t("Threads for {name}", { name: activeTitle })}>
            {threads.map((thread, index) => <button key={thread.id} id={`bot-thread-tab-${index}`} className={`thread-tab ${selectedThreadId === thread.id ? "active" : ""}`} type="button" role="tab" tabIndex={selectedThreadId === thread.id ? 0 : -1} aria-selected={selectedThreadId === thread.id} aria-controls="bot-thread-panel" onKeyDown={(event) => navigateThreadTabs(event, index)} onClick={() => void selectThread(thread.id)}><span>{threadLabel(thread)}</span>{thread.running && <i className="activity-dot" aria-label={t("In progress")} />}</button>)}
          </nav>
          {canOperate && <button className="thread-tab-new" type="button" aria-label={t("New thread")} onClick={() => void createBotThread()}><Plus size={17} /><span>{t("New")}</span></button>}
        </div>}

        {!selected && !selectedGroup && initialLoading && <div className="empty app-loading" aria-live="polite"><span /><h2>{t("Loading your Bots…")}</h2><p>{t("Connecting to Hermes and restoring your last conversations.")}</p></div>}
        {!selected && !selectedGroup && !initialLoading && initialLoadError && <div className="empty primary-error" role="alert"><div className="empty-icon"><AlertTriangle size={27} /></div><h2>{t("Conversations unavailable")}</h2><p>{formatError(initialLoadError)}</p><button type="button" onClick={() => { void loadBots(); if (api.listGroups) void loadGroups(); }}><RotateCcw size={18} />{t("Try again")}</button></div>}
        {!selected && !selectedGroup && !initialLoading && !initialLoadError && hasNoConversations && <div className="empty"><div className="empty-icon"><BotIcon size={27} /></div><h2>{t("No conversations yet")}</h2><p>{canAdmin ? t("Create a Bot or group to start your first Hermes conversation.") : t("No conversation is available for this access level.")}</p>{canAdmin && <button type="button" onClick={openBotCreator}><Plus size={18} /> {t("Create your first Bot")}</button>}</div>}
        {!selected && !selectedGroup && !initialLoading && !initialLoadError && !hasNoConversations && <HomeDashboard bots={bots} recentThreads={recentThreads} canOperate={canOperate} canAdmin={canAdmin} onOpenThread={openRecentThread} onStartPrompt={(bot, prompt) => void startSuggestedPrompt(bot, prompt)} onCreateBot={openBotCreator} />}

        {selected && (api.getConversation || api.getThread) && <section id="bot-thread-panel" className="chat-panel" role="tabpanel" aria-labelledby={selectedThread ? `bot-thread-tab-${threads.indexOf(selectedThread)}` : undefined} aria-label={selectedThread ? undefined : t("Conversation with {name}", { name: activeTitle })}>
          <div ref={botMessagesRef} className="messages" role="log" aria-live="polite" onScroll={(event) => { if (botAutoScrolling.current) return; const node = event.currentTarget; botSticksToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }} onLoadCapture={() => { const node = botMessagesRef.current; if (node && botSticksToBottom.current) node.scrollTop = node.scrollHeight; }}>
            {conversationLoading && <div className="chat-state loading-state" role="status"><span /><h2>{t("Loading conversation…")}</h2><p>{t("Restoring this Hermes thread.")}</p></div>}
            {!conversationLoading && conversationError && <div className="chat-state error-state" role="alert"><AlertTriangle size={28} /><h2>{t("Conversation unavailable")}</h2><p>{formatError(conversationError)}</p><button type="button" onClick={() => void selectBot(selected)}><RotateCcw size={16} />{t("Try again")}</button></div>}
            {!conversationLoading && !conversationError && hiddenBotMessageCount > 0 && <div className="history-load"><button type="button" onClick={showOlderBotMessages}>{t("Show {count} older messages", { count: Math.min(MESSAGE_WINDOW_SIZE, hiddenBotMessageCount) })}</button></div>}
            {!conversationLoading && !conversationError && visibleBotMessages.map((message, visibleIndex) => {
              const index = hiddenBotMessageCount + visibleIndex;
              if (message.attribution?.kind === "agent") {
                const senderProfile = message.attribution.sender.profile || message.attribution.sender.displayName;
                const senderBot = bots.find((bot) => bot.name.toLowerCase() === senderProfile.toLowerCase()) ?? null;
                return <AgentDelivery key={`agent-delivery-${index}`} message={message} recipient={activeTitle} senderBot={senderBot} />;
              }
              const messageFailure = message.role === "assistant" ? message.failure ?? (isErrorMessage(message.text) ? fallbackFailure(message.text) : null) : null;
              const messageIsError = Boolean(messageFailure);
              const previousUserMessage = previousUserMessages[index];
              const author = message.role === "user" ? t("You") : activeTitle;
              return <article key={`${message.role}-${index}`} className={`message ${message.role} ${messageIsError ? "error-message" : ""}`}>
                {message.role === "assistant" && selectedBot && <div className="message-author"><BotAvatar bot={selectedBot} size={24} /><strong>{getBotDisplayName(selectedBot, selected)}</strong></div>}
                <div className="message-bubble">
                  {messageFailure && <><div className="error-kicker"><AlertTriangle size={15} /><span>{t("Error message")}</span></div><FailureBody failure={messageFailure} /></>}
                  {message.text && (!messageFailure || message.text !== messageFailure.detail) && <MessageContent text={message.text} />}
                  {messageFailure && previousUserMessage && <FailureAction failure={messageFailure} retrying={retrying} onRetry={() => void retryWireText("bot", previousUserMessage.text)} onConfigure={() => setEditingBot(true)} />}
                </div>
                <ReplyButton label={t("Reply to {author}", { author })} onClick={() => beginReply("bot", author, message.text)} />
              </article>;
            })}
{!conversationLoading && !conversationError && Boolean(conversation?.dispatches?.length) && <section className="agent-delivery" aria-label={t("Outgoing Bot messages (live)")}><strong>{t("Outgoing Bot messages (live)")}</strong><p className="settings-help">{t("Dispatch is not confirmation of receipt.")}</p>{conversation!.dispatches!.map((item) => <p key={item.id} className="settings-help">{item.target} · {t(({ started: "Request started", dispatched: "Dispatched", failed: "Failed", unknown: "Status unavailable" })[item.status] || "Status unavailable")}</p>)}</section>}
            {!conversationLoading && !conversationError && failedSend?.scope === "bot" && <InlineSendError failure={failedSend.failure} retrying={retrying} onRetry={retryFailedSend} onConfigure={() => setEditingBot(true)} />}
            {!conversationLoading && !conversationError && conversation?.running && <div className="typing"><span /><span /><span /><small>{t("{name} is working", { name: activeTitle })}</small></div>}
            {!conversationLoading && !conversationError && conversation && conversation.messages.length === 0 && failedSend?.scope !== "bot" && <div className="chat-empty"><BotAvatar bot={selectedBot || { name: selected, system: false }} size={54} /><h2>{t("Write to {name}", { name: activeTitle })}</h2><p>{canOperate ? t("Start the conversation with this Bot.") : t("This thread is empty and your access is read only.")}</p></div>}
            {!conversationLoading && !conversationError && !conversation && <div className="chat-state"><BotIcon size={28} /><h2>{t("No thread available")}</h2><p>{canOperate ? t("Create a new thread to start chatting with this Bot.") : t("No thread is available for this Bot with read-only access.")}</p></div>}
          </div>
          {!conversationLoading && !conversationError && conversation && <form className={`composer ${replyTarget?.scope === "bot" ? "has-reply" : ""}`} onSubmit={submitMessage}>
            {replyTarget?.scope === "bot" && <ReplyPreview target={replyTarget} onClose={() => setReplyTarget(null)} />}
            <ComposerAttachmentList attachments={botAttachments} onRemove={(index) => setBotAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))} />
            {attachmentError && <p className="composer-error" role="alert">{attachmentError}</p>}
            <input ref={botAttachmentInputRef} className="sr-only" type="file" multiple accept="text/*,.md,.markdown,.csv,.json,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.sql,.log" aria-label={t("Choose text files")} onChange={(event) => { void addTextAttachments("bot", event.target.files); event.target.value = ""; }} />
            <IconButton className="composer-icon" label={t("Attach text files")} disabled={!canOperate || botAttachments.length >= MAX_TEXT_ATTACHMENTS} onClick={() => botAttachmentInputRef.current?.click()}><Paperclip size={19} /></IconButton>
            <label className="sr-only" htmlFor="message">{t("Message")}</label>
            <TextareaControl ref={botInputRef} autoGrow autoGrowKey={selectedThreadId ?? selected} resize="none" id="message" aria-label={t("Message")} rows={1} value={draft} onKeyDown={submitOnEnter} onChange={(event) => setDraft(event.target.value)} placeholder={canOperate ? t("Message {name}", { name: activeTitle }) : t("Read only")} disabled={!canOperate} />
            <IconButton className="send-button" type="submit" label={t("Send")} disabled={!canOperate || (!draft.trim() && botAttachments.length === 0)}><ArrowUp size={19} /></IconButton>
          </form>}
        </section>}

        {selectedGroup && <section className="chat-panel" aria-label={t("Group conversation {name}", { name: activeTitle })}>
          <div ref={groupMessagesRef} className="messages group-messages" role="log" aria-live="polite" onScroll={(event) => { if (groupAutoScrolling.current) return; const node = event.currentTarget; groupSticksToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }} onLoadCapture={() => { const node = groupMessagesRef.current; if (node && groupSticksToBottom.current) node.scrollTop = node.scrollHeight; }}>
            {selectedGroup.messages.map((message, index) => {
              const bot = message.authorKind === "bot" ? findBot(message.author) : null;
              const messageIsError = message.authorKind === "bot" && isErrorMessage(message.text);
              const previousUserMessage = [...selectedGroup.messages.slice(0, index)].reverse().find((item) => item.authorKind === "user");
              const author = message.authorKind === "user" ? t("You") : getBotDisplayName(bot, message.author);
              return <article key={message.id} className={`message ${message.authorKind === "user" ? "user" : "assistant"} ${messageIsError ? "error-message" : ""}`}>
                {message.authorKind === "bot" && <div className="message-author">{bot ? <BotAvatar bot={bot} size={24} /> : <span className="fallback-avatar">B</span>}<strong>{author}</strong></div>}
                <div className="message-bubble">
                  {messageIsError && <div className="error-kicker"><AlertTriangle size={15} /><span>{t("Error message")}</span></div>}
                  <MessageContent text={message.text} mentions={groupMentions} />
                  {messageIsError && previousUserMessage && <RetryButton retrying={retrying} onClick={() => void retryWireText("group", previousUserMessage.text)} />}
                </div>
                <ReplyButton label={t("Reply to {author}", { author })} onClick={() => beginReply("group", author, message.text, message.thread)} />
              </article>;
            })}
            {failedSend?.scope === "group" && <InlineSendError failure={failedSend.failure} retrying={retrying} onRetry={retryFailedSend} />}
            {selectedGroup.activity?.at(-1)?.kind === "failed" && <div className="group-activity failed" role="status"><AlertTriangle size={15} /><span>{t("{name} could not answer. The group continues.", { name: getBotDisplayName(findBot(selectedGroup.activity.at(-1)?.member || ""), selectedGroup.activity.at(-1)?.member || t("A Bot")) })}</span></div>}
            {selectedGroup.protocol?.status === "capped" && <div className="group-activity" role="status"><span>{t("Conversation stopped at the safety limit ({count} messages).", { count: selectedGroup.protocol.maxMessages })}</span></div>}
            {selectedGroup.protocol?.status === "stopped" && <div className="group-activity" role="status"><span>{t("Conversation stopped.")}</span></div>}
            {selectedGroup.running && <div className="typing group-typing"><span /><span /><span /><small>{selectedGroup.turn ? t("{name} is working", { name: getBotDisplayName(findBot(selectedGroup.turn), selectedGroup.turn) }) : t("The Bots are consulting each other")}{selectedGroup.protocol ? ` · ${t("round {current}/{max}", { current: selectedGroup.protocol.round, max: selectedGroup.protocol.maxRounds })}` : ""}</small>{api.stopGroup && <button type="button" onClick={() => void stopGroup()}>{t("Stop")}</button>}</div>}
            {selectedGroup.messages.length === 0 && failedSend?.scope !== "group" && <div className="chat-empty"><span className="group-empty-avatar"><Users size={25} /></span><h2>{selectedGroup.name}</h2><p>{t("Send a topic to everyone, or mention a Bot with @.")}</p></div>}
          </div>
          <form className={`composer ${replyTarget?.scope === "group" ? "has-reply" : ""}`} onSubmit={submitGroupMessage}>
            {replyTarget?.scope === "group" && <ReplyPreview target={replyTarget} onClose={() => setReplyTarget(null)} />}
              {groupMentionSuggestions.length > 0 && <div className="mention-menu" id="group-mention-menu" role="listbox" aria-label={t("Mention a Bot")}>{groupMentionSuggestions.map((member, index) => { const bot = findBot(member) ?? { name: member, system: false }; const active = index === Math.min(groupMentionIndex, groupMentionSuggestions.length - 1); return <button key={member} id={`group-mention-option-${index}`} type="button" role="option" tabIndex={-1} aria-selected={active} onMouseDown={(event) => event.preventDefault()} onClick={() => insertGroupMention(member)}><BotIdentity bot={bot} fallback={member} size={26} subtitle={`@${member}`} /></button>; })}</div>}
            <ComposerAttachmentList attachments={groupAttachments} onRemove={(index) => setGroupAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))} />
            {attachmentError && <p className="composer-error" role="alert">{attachmentError}</p>}
            <input ref={groupAttachmentInputRef} className="sr-only" type="file" multiple accept="text/*,.md,.markdown,.csv,.json,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.sql,.log" aria-label={t("Choose text files")} onChange={(event) => { void addTextAttachments("group", event.target.files); event.target.value = ""; }} />
            <IconButton className="composer-icon" label={t("Attach text files")} disabled={!canOperate || selectedGroup.running || groupAttachments.length >= MAX_TEXT_ATTACHMENTS} onClick={() => groupAttachmentInputRef.current?.click()}><Paperclip size={19} /></IconButton>
            <label className="sr-only" htmlFor="group-message">{t("Message the group")}</label>
            <TextareaControl ref={groupInputRef} autoGrow autoGrowKey={selectedGroupId} resize="none" id="group-message" aria-label={t("Message the group")} rows={1} value={groupDraft} onKeyDown={submitGroupOnEnter} onChange={(event) => { setGroupDraft(event.target.value); setGroupMentionIndex(0); setGroupMentionDismissed(false); }} placeholder={canOperate ? t("Message {name} · @ to target", { name: selectedGroup.name }) : t("Read only")} disabled={!canOperate || selectedGroup.running} aria-autocomplete="list" aria-controls={groupMentionSuggestions.length ? "group-mention-menu" : undefined} aria-activedescendant={groupMentionSuggestions.length ? `group-mention-option-${Math.min(groupMentionIndex, groupMentionSuggestions.length - 1)}` : undefined} aria-expanded={groupMentionSuggestions.length > 0} />
            <IconButton className="send-button" type="submit" label={t("Send to group")} disabled={!canOperate || (!groupDraft.trim() && groupAttachments.length === 0) || selectedGroup.running}><ArrowUp size={19} /></IconButton>
          </form>
        </section>}
        {error && <p className="error" role="alert">{formatError(error)}</p>}
      </section>

      {hasDetails && detailsOpen && <aside className="details-panel" aria-label={t("Details")}>
        <div className="details-head"><span />{canAdmin && selectedBot && api.getBotConfiguration && api.updateBot && <IconButton label={t("Configure {name}", { name: selected || "" })} onClick={() => setEditingBot(true)}><Settings size={18} /></IconButton>}{canAdmin && selectedBot && <IconButton className="avatar-action" label={t("Edit {name} avatar", { name: selected || "" })} onClick={openAvatarEditor}><BotIcon size={18} /></IconButton>}<IconButton label={t("Close details")} onClick={() => setDetailsOpen(false)}><X size={19} /></IconButton></div>
        <div className="computer-preview" aria-label={t("Hermes workspace preview")}><BotIcon size={24} /><span>{t("Hermes workspace")}</span><small>{conversation?.running || selectedGroup?.running ? t("Active") : t("Ready")}</small></div>
        {selected && <><section className="detail-section"><small>{t("SESSION")} · {selectedBot?.machine === "local" || !selectedBot?.machine ? t("THIS DEVICE") : selectedBot.machine}</small><strong>{conversationLoading ? t("Loading…") : conversation?.sessionId || t("No session")}</strong><p>{conversationLoading ? t("Restoring conversation") : conversationError ? t("Unavailable") : conversation?.running ? t("Running") : t("Available")}</p></section>{canAdmin && selected !== "default" && <button className="danger" type="button" onClick={removeSelectedBot}>{t("Delete this Bot")}</button>}</>}
          {selectedGroup && <><section className="detail-section"><small>{t("DISCUSSION")}</small><strong>{selectedGroup.running ? t("In progress") : t("Ready")}</strong><p>{t("{count} messages", { count: selectedGroup.messages.length })}</p></section><div className="detail-members"><small>{t("MEMBERS")}</small>{selectedGroup.members.map((member) => { const bot = findBot(member) ?? { name: member, system: false }; return <BotIdentity key={member} bot={bot} fallback={member} size={28} />; })}</div></>}
        {selectedBot && <Suspense fallback={null}><BotRoutines api={api} bot={selectedBot} role={accessRole} /></Suspense>}
      </aside>}

      {editingAvatar && selectedBot && <DialogShell className="avatar-modal" ariaLabel={t("Edit avatar")} onClose={() => setEditingAvatar(false)}><div className="modal-heading"><small>{t("HERMES APPEARANCE")}</small><h2>{getBotDisplayName(selectedBot, selectedBot.name)}</h2><p>{t("Choose a Hermes Blobatar shape or a Petdex companion.")}</p></div><BotAppearancePicker botName={selectedBot.name} value={avatarValue} onChange={setAvatarValue} loadPets={api.listAvatarPets} /><DialogActions><button type="button" onClick={() => setEditingAvatar(false)}>{t("Cancel")}</button><button className="primary" type="button" onClick={saveAvatar}>{t("Save avatar")}</button></DialogActions></DialogShell>}

      {editingBot && selectedBot && api.getBotConfiguration && api.updateBot && <Suspense fallback={null}><BotEditor api={api} bot={selectedBot} onClose={() => setEditingBot(false)} onSaved={handleBotSaved} /></Suspense>}

      {renamingThread && <DialogShell as="form" className="thread-rename-modal" ariaLabel={t("Rename thread")} onSubmit={submitThreadRename} onClose={() => setRenamingThread(null)}><div className="modal-heading"><small>{t("HERMES THREAD")}</small><h2>{t("Rename thread")}</h2><p>{t("Use a short title that makes this conversation easy to find.")}</p></div><FormField label={t("Thread title")}><input value={renameThreadTitle} onChange={(event) => setRenameThreadTitle(event.target.value)} maxLength={120} required /></FormField><DialogActions><button type="button" onClick={() => setRenamingThread(null)}>{t("Cancel")}</button><button className="primary" type="submit" disabled={!renameThreadTitle.trim()}>{t("Rename")}</button></DialogActions></DialogShell>}

      {creating && <DialogShell as="form" className="bot-create-modal" ariaLabel={t("Create a Bot")} onSubmit={submitNewBot} onClose={() => setCreating(false)}>
        <div className="modal-heading"><small>{t("NEW MISSION")}</small><h2>{t("Create a mission-focused Bot")}</h2><p>{t("Start with what this Bot should accomplish. ByBots prepares the technical profile name for you.")}</p></div>
        <div className="create-bot-fields">
          {availableGateways.length > 1 && <FormField label={t("Gateway")}><SelectControl value={newBotGateway} onChange={(event) => setNewBotGateway(event.target.value)}>{availableGateways.map((gateway) => <option key={gateway.id} value={gateway.id} disabled={!gateway.hasToken}>{gateway.label}</option>)}</SelectControl></FormField>}
          <FormField label={t("Visible name")}><input value={newTitle} onChange={(event) => { const title = event.target.value; setNewTitle(title); if (!newNameEdited) setNewName(technicalBotName(title || newDescription)); }} placeholder={t("e.g. Inbox Triage")} maxLength={120} required /></FormField>
          <FormField className="create-description" label={t("Mission")}><TextareaControl resize="vertical" value={newDescription} onChange={(event) => { const description = event.target.value; setNewDescription(description); if (!newNameEdited && !newTitle.trim()) setNewName(technicalBotName(description)); }} placeholder={t("What result should this Bot deliver?")} maxLength={600} required /></FormField>
          <FormField label={t("Technical name")} help={t("Generated automatically, editable if needed.")}><input data-dialog-initial-focus value={newName} onChange={(event) => { setNewNameEdited(true); setNewName(event.target.value); }} placeholder={t("e.g. inbox-triage")} pattern="[A-Za-z0-9][A-Za-z0-9-]{1,63}" required /></FormField>
        </div>
        <BotAppearancePicker botName={newName.trim() || "new-bot"} value={newAvatar} onChange={setNewAvatar} loadPets={api.listAvatarPets} />
        {createError && <p className="error modal-error" role="alert">{formatError(createError)}</p>}
        <DialogActions><button type="button" onClick={() => setCreating(false)}>{t("Cancel")}</button><button className="primary" type="submit" disabled={!newTitle.trim() || !newDescription.trim() || !newName.trim()}>{t("Create Bot")}</button></DialogActions>
      </DialogShell>}

      {creatingGroup && <DialogShell as="form" ariaLabel={t("Create a group")} onSubmit={submitNewGroup} onClose={() => setCreatingGroup(false)}><div><small>{t("NEW CONVERSATION")}</small><h2>{t("Create a group")}</h2><p>{t("Bring several Bots into one thread.")}</p>{bots.some((bot) => bot.gatewayId && bot.gatewayId !== "primary") && <p>{t("Groups use one gateway. For cross-gateway exchanges, use Bot Chat and message_agent.")}</p>}</div><FormField label={t("Group name")}><input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder={t("e.g. Leadership")} required /></FormField><div className="member-picker" role="group" aria-label={t("Group Bots")}>{bots.filter((bot) => !bot.system).map((bot) => <label key={bot.name} className={newGroupMembers.includes(bot.name) ? "checked" : ""}><input type="checkbox" disabled={newGroupMembers.length > 0 && !newGroupMembers.includes(bot.name) && (bots.find((member) => member.name === newGroupMembers[0])?.gatewayId || "primary") !== (bot.gatewayId || "primary")} checked={newGroupMembers.includes(bot.name)} onChange={() => toggleGroupMember(bot.name)} /><BotAvatar bot={bot} size={28} /><span className="member-copy"><strong>{getBotDisplayName(bot, bot.name)}</strong><small>{bot.gatewayLabel || bot.description || t("Hermes profile access")}</small></span></label>)}</div>{newGroupMembers.length > 0 && <div className="group-access-note" role="note"><ShieldCheck size={18} /><span><strong>{t("Accesses are combined in this group")}</strong><small>{t("Each Bot keeps its own tools and integrations. Review sensitive data before sending it to the group.")}</small></span></div>}{newGroupMembers.length > 0 && <Suspense fallback={null}><GroupAccessPreview api={api} bots={bots} members={newGroupMembers} inline /></Suspense>}<p className="modal-hint">{t("{count}/6 Bots selected. Minimum 2.", { count: newGroupMembers.length })}</p><DialogActions><button type="button" onClick={() => setCreatingGroup(false)}>{t("Cancel")}</button><button className="primary" type="submit" disabled={newGroupMembers.length < 2 || newGroupMembers.length > 6 || !newGroupName.trim()}>{t("Create group")}</button></DialogActions></DialogShell>}
      {settingsOpen && <Suspense fallback={null}><SettingsPanel api={api} bots={bots} machines={machines} role={accessRole} localHermesUnavailable={localHermesUnavailable} initialSection={settingsInitialSection} preferences={preferences} onPreferencesChange={setPreferences} onBotImported={handleBotImported} onGatewayChanged={handleGatewayChanged} onDefaultGatewayChanged={loadBots} onClose={closeSettings} /></Suspense>}
      {firstRun && <FirstRunPanel api={api} role={accessRole} localHermesUnavailable={localHermesUnavailable} onConnected={handleGatewayChanged} />}
    </main>
  );
}
