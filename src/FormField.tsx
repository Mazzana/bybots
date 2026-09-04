import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

interface FormFieldProps {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, help, error, className = "", children }: FormFieldProps) {
  const control = isValidElement(children) && typeof label === "string"
    ? cloneElement(children as ReactElement<{ "aria-label"?: string }>, { "aria-label": (children.props as { "aria-label"?: string })["aria-label"] || label })
    : children;
  return <label className={`form-field ${className}`.trim()}>
    <span className="form-field-label">{label}</span>
    {control}
    {help && <small className="field-help">{help}</small>}
    {error && <small className="field-error" role="alert">{error}</small>}
  </label>;
}
