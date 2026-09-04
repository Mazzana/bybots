import { ArrowRight, Bot as BotIcon, FileSearch, ListChecks, Sparkles } from "lucide-react";
import type { Bot, BotThread } from "./App";
import { BotAvatar } from "./BotAvatar";
import { getBotDisplayName } from "./botDisplayName";
import { useI18n } from "./i18n";

interface HomeDashboardProps {
  bots: Bot[];
  recentThreads: BotThread[];
  canOperate: boolean;
  canAdmin: boolean;
  onOpenThread(thread: BotThread): void;
  onStartPrompt(bot: Bot, prompt: string): void;
  onCreateBot(): void;
}

export function HomeDashboard({ bots, recentThreads, canOperate, canAdmin, onOpenThread, onStartPrompt, onCreateBot }: HomeDashboardProps) {
  const { locale, t } = useI18n();
  const suggestedBot = bots.find((bot) => !bot.system) ?? bots[0];
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const suggestions = [
    { icon: ListChecks, title: t("Clarify my priorities"), description: t("Get the three next actions that matter."), prompt: t("Summarize my current priorities and propose the next three concrete actions.") },
    { icon: Sparkles, title: t("Build an action plan"), description: t("Turn an objective into clear steps."), prompt: t("Help me build a clear action plan for the objective I will describe.") },
    { icon: FileSearch, title: t("Analyze a document"), description: t("Extract decisions, risks, and next steps."), prompt: t("Analyze the document I will attach and extract decisions, risks, and next steps.") }
  ];

  return <section className="home-dashboard" aria-labelledby="home-title">
    <header className="home-hero">
      <span className="home-kicker">{t("YOUR WORKSPACE")}</span>
      <h2 id="home-title">{t("Pick up where you left off")}</h2>
      <p>{t("Your recent Hermes threads and useful starting points are gathered here.")}</p>
    </header>

    <div className="home-grid">
      <section className="resume-section" aria-labelledby="resume-title">
        <div className="home-section-heading"><div><span>{t("RECENT THREADS")}</span><h3 id="resume-title">{t("Resume")}</h3></div><small>{t("Synced with Hermes")}</small></div>
        {recentThreads.length > 0 ? <div className="recent-thread-list">{recentThreads.slice(0, 6).map((thread) => {
          const bot = bots.find((item) => item.name === thread.bot);
          return <button key={`${thread.bot}:${thread.id}`} type="button" onClick={() => onOpenThread(thread)}>
            <BotAvatar bot={bot ?? { name: thread.bot, system: false }} size={34} />
            <span><span><strong>{thread.title}</strong>{thread.running && <em>{t("In progress")}</em>}</span><small>{getBotDisplayName(bot, thread.bot)} · {thread.startedAt ? date.format(new Date(thread.startedAt * (thread.startedAt < 10_000_000_000 ? 1000 : 1))) : t("Recent")}</small><p>{thread.preview || t("Open this thread to continue.")}</p></span>
            <ArrowRight size={17} />
          </button>;
        })}</div> : <div className="resume-empty"><BotIcon size={23} /><div><strong>{t("No recent thread yet")}</strong><p>{t("Start below and your next conversations will stay ready to resume.")}</p></div></div>}
      </section>

      <section className="quick-start-section" aria-labelledby="quick-start-title">
        <div className="home-section-heading"><div><span>{t("QUICK START")}</span><h3 id="quick-start-title">{t("Get a first result")}</h3></div></div>
        {suggestedBot && canOperate ? <div className="suggestion-list">{suggestions.map(({ icon: Icon, title, description, prompt }) => <button key={title} type="button" onClick={() => onStartPrompt(suggestedBot, prompt)}><span><Icon size={18} /></span><span><strong>{title}</strong><small>{description}</small></span><ArrowRight size={16} /></button>)}</div> : <div className="quick-start-empty"><p>{canAdmin ? t("Create a mission-focused Bot to get your first result.") : t("Select an available thread to continue.")}</p>{canAdmin && <button type="button" onClick={onCreateBot}><BotIcon size={17} />{t("Create a Bot")}</button>}</div>}
        {suggestedBot && <p className="suggested-bot">{t("Suggested Bot: {name}", { name: getBotDisplayName(suggestedBot) })}</p>}
      </section>
    </div>
  </section>;
}
