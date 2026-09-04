export {};

declare global {
  interface Window {
    byBotsDesktop?: {
      windowControls: {
        minimize(): void;
        toggleMaximize(): void;
        close(): void;
      };
    };
  }
}
