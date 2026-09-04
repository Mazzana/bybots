export {};
import type { ReleaseCheck } from "../electron/release-checker";

declare global {
  interface Window {
    byBotsDesktop?: {
      updates?: { check(): Promise<ReleaseCheck> };
      windowControls?: {
        minimize(): void;
        toggleMaximize(): void;
        close(): void;
      };
    };
  }
}
