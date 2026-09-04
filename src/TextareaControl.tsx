import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

interface TextareaControlProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoGrow?: boolean;
  autoGrowKey?: unknown;
  resize?: "none" | "vertical";
}

export const TextareaControl = forwardRef<HTMLTextAreaElement, TextareaControlProps>(function TextareaControl({ autoGrow = false, autoGrowKey, resize, style, value, ...props }, forwardedRef) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement, []);

  useLayoutEffect(() => {
    const textarea = innerRef.current;
    if (!autoGrow || !textarea) return;
    textarea.style.height = "auto";
    const maxHeight = Number.parseFloat(window.getComputedStyle(textarea).maxHeight) || 132;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [autoGrow, autoGrowKey, value]);

  return <textarea {...props} ref={innerRef} value={value} style={{ ...style, ...(resize ? { resize } : {}) }} />;
});
