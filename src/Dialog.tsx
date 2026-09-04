import type { FormEventHandler, ReactNode } from "react";
import { useDialogFocus } from "./useDialogFocus";

interface DialogShellProps {
  as?: "form" | "section";
  variant?: "modal" | "panel";
  ariaLabel?: string;
  ariaLabelledBy?: string;
  backdropClassName?: string;
  className?: string;
  children: ReactNode;
  onClose(): void;
  onSubmit?: FormEventHandler<HTMLFormElement>;
}

export function DialogShell({ as = "section", variant = "modal", ariaLabel, ariaLabelledBy, backdropClassName = "", className = "", children, onClose, onSubmit }: DialogShellProps) {
  const formRef = useDialogFocus<HTMLFormElement>(as === "form", onClose);
  const sectionRef = useDialogFocus<HTMLElement>(as !== "form", onClose);
  const dialogClassName = `${variant === "modal" ? "modal" : ""} ${className}`.trim();

  return <div className={`${variant === "modal" ? "modal-backdrop" : ""} ${backdropClassName}`.trim()} role="presentation">
    {as === "form"
      ? <form ref={formRef} className={dialogClassName} role="dialog" aria-modal="true" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} onSubmit={onSubmit}>{children}</form>
      : <section ref={sectionRef} className={dialogClassName} role="dialog" aria-modal="true" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}>{children}</section>}
  </div>;
}

export function DialogActions({ children, as = "div" }: { children: ReactNode; as?: "div" | "footer" }) {
  return as === "footer" ? <footer className="modal-actions">{children}</footer> : <div className="modal-actions">{children}</div>;
}
