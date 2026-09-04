import type { ReactNode } from "react";

type FeedbackTone = "loading" | "unavailable" | "note" | "error" | "success";

interface FeedbackStateProps {
  tone: FeedbackTone;
  icon?: ReactNode;
  title?: ReactNode;
  children: ReactNode;
  compact?: boolean;
  className?: string;
}

export function FeedbackState({ tone, icon, title, children, compact = false, className = "" }: FeedbackStateProps) {
  const classes = `settings-${tone} ${compact ? "compact" : ""} ${className}`.trim();
  if (tone === "loading") return <div className={classes} role="status" aria-live="polite"><span aria-hidden="true" />{children}</div>;
  if (tone === "unavailable" || tone === "note") return <div className={classes}>{icon}<div>{title && <strong>{title}</strong>}<p>{children}</p></div></div>;
  return <p className={classes} role={tone === "error" ? "alert" : "status"}>{icon}{children}</p>;
}
