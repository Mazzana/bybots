import type { IpcMainInvokeEvent, WebContents } from "electron";

export function trustedUpdateRequest(event: IpcMainInvokeEvent, main: WebContents | undefined, expectedUrl: string | undefined): boolean {
  if (!main || !expectedUrl || event.sender !== main || event.senderFrame !== main.mainFrame) return false;
  try {
    return new URL(event.senderFrame.url).origin === new URL(expectedUrl).origin;
  } catch { return false; }
}
