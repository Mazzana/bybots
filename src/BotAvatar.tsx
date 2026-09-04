import { blobatar } from "blobatar/blob";
import { useI18n } from "./i18n";
import { getBotDisplayName } from "./botDisplayName";

interface AvatarBot {
  name: string;
  system?: boolean;
  displayName?: string;
  title?: string;
  avatar?: { shape?: string; color?: string; image?: string };
}

const shapeTraits: Record<string, number> = {
  round: 0.11, organic: 0.35, boxy: 0.54, capsule: 0.65, nub: 0.745,
  cloud: 0.825, droplet: 0.8875, hexagon: 0.9325, sun: 0.965, triangle: 0.99
};

const blobSvgCache = new Map<string, string>();

function cachedBlobAvatar(seed: string, size: number, kind?: string) {
  const key = `${seed}:${size}:${kind ?? "default"}`;
  const cached = blobSvgCache.get(key);
  if (cached) return cached;
  const svg = blobatar(seed, { size, ...(kind && shapeTraits[kind] ? { traits: { shape: shapeTraits[kind] } } : {}) });
  blobSvgCache.set(key, svg);
  return svg;
}

export function BotAvatar({ bot, size = 40 }: { bot: AvatarBot; size?: number }) {
  const { t } = useI18n();
  const label = getBotDisplayName(bot);
  if (bot.avatar?.image) {
    return <img className="bot-avatar-image" src={bot.avatar.image} alt={t("Avatar for {name}", { name: label })} width={size} height={size} />;
  }
  const shape = bot.avatar?.shape;
  if (!shape || shape === "blobatar" || shape.startsWith("blobatar:")) {
    const parts = shape?.split(":") ?? [];
    const seed = parts[1] || bot.name;
    const kind = parts[2];
    const svg = cachedBlobAvatar(seed, size, kind);
    return <span data-bot-avatar className="bot-avatar-blob" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  return <span data-bot-avatar className={`avatar avatar-${shape}`} style={{ width: size, height: size, background: bot.avatar?.color }}>{label.slice(0, 1).toUpperCase()}</span>;
}
