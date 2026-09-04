export interface DisplayableBot {
  name: string;
  title?: string;
  displayName?: string;
}

export function getBotDisplayName(bot: DisplayableBot | null | undefined, fallback = "") {
  return bot?.title || bot?.displayName || bot?.name || fallback;
}
