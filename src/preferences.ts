export type InterfaceDensity = "comfortable" | "compact";

export interface AppPreferences {
  density: InterfaceDensity;
  sendOnEnter: boolean;
  reduceMotion: boolean;
  displayName: string;
  desktopNotifications: boolean;
  usageDays: 7 | 30 | 90;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  density: "comfortable",
  sendOnEnter: true,
  reduceMotion: false,
  displayName: "",
  desktopNotifications: false,
  usageDays: 30
};

const STORAGE_KEY = "byfinity.preferences";

export function loadPreferences(storage?: Pick<Storage, "getItem">): AppPreferences {
  if (!storage) return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "{}") as Partial<AppPreferences>;
    return {
      density: parsed.density === "compact" ? "compact" : "comfortable",
      sendOnEnter: typeof parsed.sendOnEnter === "boolean" ? parsed.sendOnEnter : true,
      reduceMotion: parsed.reduceMotion === true,
      displayName: typeof parsed.displayName === "string" ? parsed.displayName.slice(0, 80) : "",
      desktopNotifications: parsed.desktopNotifications === true,
      usageDays: parsed.usageDays === 7 || parsed.usageDays === 90 ? parsed.usageDays : 30
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(preferences: AppPreferences, storage?: Pick<Storage, "setItem">) {
  storage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
}
