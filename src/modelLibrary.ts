export const MODEL_LIBRARY_KEY = "bybots.modelLibrary.v1";
export interface ModelLibrary { favorites: string[]; recent: string[] }
const valid = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 1024) return false;
  try { const pair: unknown = JSON.parse(value); return Array.isArray(pair) && pair.length === 2 && pair.every((part) => typeof part === "string"); }
  catch { return false; }
};
export function loadModelLibrary(): ModelLibrary {
  try {
    const raw = localStorage.getItem(MODEL_LIBRARY_KEY);
    if (!raw || raw.length > 40_000) return { favorites: [], recent: [] };
    const parsed = JSON.parse(raw);
    const list = (values: unknown, limit: number) => Array.isArray(values) ? [...new Set(values.filter(valid))].slice(0, limit) : [];
    return { favorites: list(parsed.favorites, 24), recent: list(parsed.recent, 8) };
  } catch { return { favorites: [], recent: [] }; }
}
export function saveModelLibrary(library: ModelLibrary) {
  try { localStorage.setItem(MODEL_LIBRARY_KEY, JSON.stringify(library)); } catch { /* Model selection still works if local storage is unavailable. */ }
}
export function rememberModel(value: string) {
  if (!valid(value) || value === '["",""]') return;
  const library = loadModelLibrary();
  saveModelLibrary({ ...library, recent: [value, ...library.recent.filter((item) => item !== value)].slice(0, 8) });
}
