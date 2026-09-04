import type { InputHTMLAttributes, ReactNode } from "react";

interface SwitchControlProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role"> {
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}

export function SwitchInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role">) {
  return <input {...props} type="checkbox" role="switch" />;
}

export function SwitchControl({ label, description, className = "", ...props }: SwitchControlProps) {
  return <label className={`setting-toggle ${className}`.trim()}>
    <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
    <SwitchInput {...props} />
  </label>;
}
