import { useState } from "react";
import { Check, Copy, ExternalLink, File, FileArchive, FileImage, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "./i18n";

const mediaLine = /^MEDIA:(.+)$/gim;
const markdownSyntax = /(^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|>\s|\d+[.)]\s|```)|(?:\*\*|__|~~|`|\[[^\]]+\]\(|\|)/m;

export interface MessageMention {
  kind: "user" | "bot";
  label: string;
}

export type MessageMentions = Record<string, MessageMention>;

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: { className?: string[] } };
}

function remarkMentions({ mentions }: { mentions: MessageMentions }) {
  const knownMentions = new Map(Object.entries(mentions).map(([handle, mention]) => [handle.toLocaleLowerCase(), mention]));
  return (tree: MarkdownNode) => {
    function transform(parent: MarkdownNode) {
      if (!parent.children || parent.type === "code" || parent.type === "inlineCode" || parent.data?.hProperties?.className?.includes("message-mention")) return;
      parent.children = parent.children.flatMap((child) => {
        if (child.type !== "text" || !child.value) return [child];
        const nodes: MarkdownNode[] = [];
        let cursor = 0;
        for (const match of child.value.matchAll(/@([\p{L}\p{N}_-]+)/giu)) {
          const mention = knownMentions.get(match[1].toLocaleLowerCase());
          if (!mention || match.index === undefined) continue;
          if (match.index > cursor) nodes.push({ type: "text", value: child.value.slice(cursor, match.index) });
          nodes.push({
            type: "strong",
            data: { hProperties: { className: ["message-mention", `message-mention-${mention.kind}`] } },
            children: [{ type: "text", value: `@${mention.label}` }]
          });
          cursor = match.index + match[0].length;
        }
        if (!nodes.length) return [child];
        if (cursor < child.value.length) nodes.push({ type: "text", value: child.value.slice(cursor) });
        return nodes;
      });
      parent.children.forEach(transform);
    }
    transform(tree);
  };
}

function artifactName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function artifactExtension(path: string) {
  const name = artifactName(path);
  const extension = name.includes(".") ? name.split(".").at(-1) : "";
  return extension?.toLocaleUpperCase() || "FILE";
}

function ArtifactIcon({ path }: { path: string }) {
  const extension = artifactExtension(path).toLocaleLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) return <FileImage size={19} />;
  if (["zip", "gz", "tar", "7z", "rar"].includes(extension)) return <FileArchive size={19} />;
  if (["md", "txt", "pdf", "doc", "docx", "csv", "xls", "xlsx"].includes(extension)) return <FileText size={19} />;
  return <File size={19} />;
}

function safeArtifactUrl(path: string) {
  try {
    const url = new URL(path);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function ArtifactCard({ path }: { path: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const artifactUrl = safeArtifactUrl(path);

  async function copyPath() {
    if (!navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(path);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return <article className="artifact-card">
    <span className="artifact-icon"><ArtifactIcon path={path} /></span>
    <span className="artifact-copy"><small>{t("GENERATED RESULT")}</small><strong>{artifactName(path)}</strong><em>{artifactExtension(path)}</em></span>
    <span className="artifact-actions">{artifactUrl && <a href={artifactUrl} target="_blank" rel="noreferrer" aria-label={t("Open {name}", { name: artifactName(path) })}><ExternalLink size={16} /><span>{t("Open")}</span></a>}<button type="button" disabled={!navigator.clipboard?.writeText} onClick={() => void copyPath()} aria-label={t("Copy the path to {name}", { name: artifactName(path) })}>{copied ? <Check size={16} /> : <Copy size={16} />}<span>{copied ? t("Copied") : t("Copy path")}</span></button></span>
    <details><summary>{t("File location")}</summary><code>{path}</code></details>
  </article>;
}

export function MessageContent({ text, mentions = {} }: { text: string; mentions?: MessageMentions }) {
  const { t } = useI18n();
  const artifacts = [...text.matchAll(mediaLine)].map((match) => match[1].trim()).filter(Boolean);
  const content = text.replace(mediaLine, "").replace(/\n{3,}/g, "\n\n").trim();
  const needsRichContent = markdownSyntax.test(content) || (content.includes("@") && Object.keys(mentions).length > 0);

  return <div className="message-content">
    {content && (needsRichContent
      ? <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMentions, { mentions }]]}>{content}</ReactMarkdown>
      : <p>{content}</p>)}
    {artifacts.length > 0 && <div className="artifact-list" aria-label={t(artifacts.length === 1 ? "Generated file" : "Generated files")}>{artifacts.map((path) => <ArtifactCard key={path} path={path} />)}</div>}
  </div>;
}
