import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the Windows desktop shell uses draggable custom window controls", async () => {
  test.skip(process.platform !== "win32", "Windows title-bar integration is platform-specific.");

  const userDataPath = await mkdtemp(join(tmpdir(), "bybots-e2e-"));
  const desktop = await electron.launch({
    args: ["dist-electron/main.js"],
    env: {
      ...process.env,
      BYBOTS_DEV_URL: "http://127.0.0.1:5190",
      BYBOTS_E2E_USER_DATA: userDataPath
    }
  });
  try {
    const window = await desktop.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    expect(new URL(window.url()).searchParams.get("desktop")).toBe("windows");
    await expect(window.locator("html")).toHaveAttribute("data-desktop", "windows");

    const chrome = await desktop.evaluate(({ BrowserWindow }) => {
      const applicationWindow = BrowserWindow.getAllWindows()[0];
      return {
        menuVisible: applicationWindow?.isMenuBarVisible() ?? true,
        movable: applicationWindow?.isMovable() ?? false
      };
    });
    expect(chrome.menuVisible).toBe(false);
    expect(chrome.movable).toBe(true);

    const presentation = await window.evaluate(() => ({
      fontFamily: getComputedStyle(document.documentElement).fontFamily,
      headerDragRegion: getComputedStyle(document.querySelector(".conversation-header")!).getPropertyValue("-webkit-app-region"),
      headerUserSelect: getComputedStyle(document.querySelector(".conversation-header")!).userSelect,
      controlsDragRegion: getComputedStyle(document.querySelector(".window-controls")!).getPropertyValue("-webkit-app-region")
    }));
    expect(presentation.fontFamily).toContain("Segoe UI Variable Text");
    expect(presentation.headerDragRegion).toBe("drag");
    expect(presentation.headerUserSelect).toBe("none");
    expect(presentation.controlsDragRegion).toBe("no-drag");

    await expect(window.getByRole("group", { name: "Window controls" })).toBeVisible();
    await window.getByRole("button", { name: "Minimize window" }).click();
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized())).toBe(true);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.restore());
    await window.getByRole("button", { name: "Maximize or restore window" }).click();
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized())).toBe(true);
    await window.getByRole("button", { name: "Maximize or restore window" }).click();
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized())).toBe(false);

    const authorizationUrl = "https://hermes.example.test/auth/native/authorize?state=opaque-state";
    await desktop.evaluate(({ shell }, expectedUrl) => {
      const state = globalThis as typeof globalThis & { __bybotsExternalUrl?: string };
      Object.defineProperty(shell, "openExternal", {
        configurable: true,
        value: async (url: string) => { state.__bybotsExternalUrl = url; }
      });
      state.__bybotsExternalUrl = expectedUrl === "" ? "invalid" : undefined;
    }, authorizationUrl);
    await window.evaluate((url) => globalThis.location.assign(url), authorizationUrl);
    await expect.poll(() => desktop.evaluate(() => (globalThis as typeof globalThis & { __bybotsExternalUrl?: string }).__bybotsExternalUrl)).toBe(authorizationUrl);
    expect(new URL(window.url()).origin).toBe("http://127.0.0.1:5190");

    const windowClosed = window.waitForEvent("close");
    await window.getByRole("button", { name: "Close window" }).dispatchEvent("click").catch(() => undefined);
    await windowClosed;
  } finally {
    await desktop.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("the macOS desktop shell uses native traffic lights and a draggable title area", async () => {
  test.skip(process.platform !== "darwin", "macOS title-bar integration is platform-specific.");

  const userDataPath = await mkdtemp(join(tmpdir(), "bybots-macos-e2e-"));
  const desktop = await electron.launch({
    args: ["dist-electron/main.js"],
    env: {
      ...process.env,
      BYBOTS_DEV_URL: "http://127.0.0.1:5190",
      BYBOTS_E2E_USER_DATA: userDataPath
    }
  });
  try {
    const window = await desktop.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    expect(new URL(window.url()).searchParams.get("desktop")).toBe("macos");
    await expect(window.locator("html")).toHaveAttribute("data-desktop", "macos");
    await expect(window.getByRole("group", { name: "Window controls" })).toHaveCount(0);

    const chrome = await desktop.evaluate(({ BrowserWindow }) => {
      const applicationWindow = BrowserWindow.getAllWindows()[0];
      return {
        menuVisible: applicationWindow?.isMenuBarVisible() ?? true,
        movable: applicationWindow?.isMovable() ?? false
      };
    });
    expect(chrome.menuVisible).toBe(true);
    expect(chrome.movable).toBe(true);

    const presentation = await window.evaluate(() => ({
      fontFamily: getComputedStyle(document.documentElement).fontFamily,
      headerDragRegion: getComputedStyle(document.querySelector(".conversation-header")!).getPropertyValue("-webkit-app-region"),
      headerUserSelect: getComputedStyle(document.querySelector(".conversation-header")!).userSelect,
      sidebarPaddingLeft: Number.parseFloat(getComputedStyle(document.querySelector(".sidebar-topbar")!).paddingLeft)
    }));
    expect(presentation.fontFamily).toContain("-apple-system");
    expect(presentation.headerDragRegion).toBe("drag");
    expect(presentation.headerUserSelect).toBe("none");
    expect(presentation.sidebarPaddingLeft).toBeGreaterThanOrEqual(78);

    const authorizationUrl = "https://hermes.example.test/auth/native/authorize?state=macos-state";
    await desktop.evaluate(({ shell }, expectedUrl) => {
      const state = globalThis as typeof globalThis & { __bybotsExternalUrl?: string };
      Object.defineProperty(shell, "openExternal", {
        configurable: true,
        value: async (url: string) => { state.__bybotsExternalUrl = url; }
      });
      state.__bybotsExternalUrl = expectedUrl === "" ? "invalid" : undefined;
    }, authorizationUrl);
    await window.evaluate((url) => globalThis.location.assign(url), authorizationUrl);
    await expect.poll(() => desktop.evaluate(() => (globalThis as typeof globalThis & { __bybotsExternalUrl?: string }).__bybotsExternalUrl)).toBe(authorizationUrl);
    expect(new URL(window.url()).origin).toBe("http://127.0.0.1:5190");
  } finally {
    await desktop.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});
