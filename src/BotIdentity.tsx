import type { ReactNode } from "react";
import { BotAvatar } from "./BotAvatar";
import { getBotDisplayName, type DisplayableBot } from "./botDisplayName";

interface BotIdentityProps {
  bot: DisplayableBot & { system?: boolean; avatar?: { shape?: string; color?: string; image?: string } };
  fallback?: string;
  size?: number;
  subtitle?: ReactNode;
  className?: string;
}

export function BotIdentity({ bot, fallback, size = 28, subtitle, className = "" }: BotIdentityProps) {
  return <span className={`bot-identity ${className}`.trim()}>
    <BotAvatar bot={bot} size={size} />
    <span className="bot-identity-copy"><strong>{getBotDisplayName(bot, fallback)}</strong>{subtitle && <small>{subtitle}</small>}</span>
  </span>;
}
