import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { startBridge, type BridgeRuntime } from "../server/runtime";

const isDev = !app.isPackaged;
const devServerUrl = process.env.BYBOTS_DEV_URL || "http://127.0.0.1:5188";
const applicationId = "com.byfinity.bots";
const stableUserDataPath = process.env.BYBOTS_E2E_USER_DATA || join(app.getPath("appData"), "Byfinity Bots");
const requestedE2ePort = Number.parseInt(process.env.BYBOTS_E2E_PORT ?? "", 10);
const embeddedBridgePort = process.env.BYBOTS_E2E_USER_DATA
  && Number.isInteger(requestedE2ePort)
  && requestedE2ePort >= 1_024
  && requestedE2ePort <= 65_535
  ? requestedE2ePort
  : 47_831;
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const windowControlChannel = "bybots:window-control";
let embeddedBridge: BridgeRuntime | undefined;
let mainWindow: BrowserWindow | undefined;

type WindowControlAction = "minimize" | "toggle-maximize" | "close";

ipcMain.on(windowControlChannel, (event, action: WindowControlAction) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window !== mainWindow) return;
  if (action === "minimize") window.minimize();
  if (action === "toggle-maximize") window.isMaximized() ? window.unmaximize() : window.maximize();
  if (action === "close") window.close();
});

function openExternalWebUrl(url: string) {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return;
  }
  if (protocol !== "https:" && protocol !== "http:") return;
  void shell.openExternal(url).catch(() => {
    console.error("Unable to open the external browser");
  });
}

app.setName("ByBots");
// Keep the pre-rename directory so upgrades retain the saved Hermes connection.
app.setPath("userData", stableUserDataPath);
app.setAppUserModelId(applicationId);
const hasSingleInstanceLock = process.env.BYBOTS_E2E_USER_DATA ? true : app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#000000",
    show: false,
    autoHideMenuBar: !isMac,
    ...(isMac ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 18 } } : {}),
    ...(isWindows ? { frame: false } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(isWindows ? { preload: join(import.meta.dirname, "preload.cjs") } : {})
    }
  });
  mainWindow = window;
  if (!isMac) window.setMenuBarVisibility(false);
  window.once("closed", () => { mainWindow = undefined; });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalWebUrl(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const allowedOrigin = new URL(isDev ? devServerUrl : embeddedBridge!.url).origin;
    if (new URL(url).origin !== allowedOrigin) {
      event.preventDefault();
      openExternalWebUrl(url);
    }
  });
  window.once("ready-to-show", () => window.show());

  if (isDev) {
    const applicationUrl = new URL(devServerUrl);
    if (isWindows || isMac) applicationUrl.searchParams.set("desktop", isWindows ? "windows" : "macos");
    await window.loadURL(applicationUrl.toString());
    return;
  }

  embeddedBridge ??= await startBridge({
    host: "127.0.0.1",
    port: embeddedBridgePort,
    staticDir: join(app.getAppPath(), "dist"),
    configFile: join(app.getPath("userData"), "connection.json")
  });
  const applicationUrl = new URL(embeddedBridge.url);
  if (isWindows || isMac) applicationUrl.searchParams.set("desktop", isWindows ? "windows" : "macos");
  await window.loadURL(applicationUrl.toString());
}

app.whenReady().then(() => hasSingleInstanceLock ? createWindow() : undefined).catch((cause) => {
  console.error("Unable to start ByBots", cause);
  app.quit();
});
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
app.on("second-instance", () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});
app.on("before-quit", () => { void embeddedBridge?.close(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
