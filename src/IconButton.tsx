import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function IconButton({ label, children, className = "", type = "button", ...props }: IconButtonProps) {
  return <button {...props} type={type} className={`icon-button ${className}`.trim()} aria-label={label}>{children}</button>;
}
