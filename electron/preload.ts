import { contextBridge, ipcRenderer } from "electron";

const windowControlChannel = "bybots:window-control";

contextBridge.exposeInMainWorld("byBotsDesktop", {
  updates: { check: () => ipcRenderer.invoke("bybots:check-updates") },
  ...(process.platform === "win32" ? { windowControls: {
    minimize: () => ipcRenderer.send(windowControlChannel, "minimize"),
    toggleMaximize: () => ipcRenderer.send(windowControlChannel, "toggle-maximize"),
    close: () => ipcRenderer.send(windowControlChannel, "close")
  } } : {})
});
