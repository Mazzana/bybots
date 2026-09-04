import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

export function SelectControl({ children, className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className="select-control">
    <select {...props} className={className}>{children}</select>
    <ChevronDown size={16} aria-hidden="true" />
  </span>;
}
