import { useState } from "react";
import { DialogActions, DialogShell } from "./Dialog";
import { FormField } from "./FormField";
import { SelectControl } from "./SelectControl";
import { useI18n } from "./i18n";
import { loadModelLibrary, saveModelLibrary } from "./modelLibrary";

export interface ModelOption { value: string; model: string; provider: string }
export default function ModelLibraryDialog({ options, current, busy, error, onChoose, onClose }: {
  options: ModelOption[]; current: string; busy: boolean; error: string;
  onChoose(value: string): void; onClose(): void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(current);
  const [library, setLibrary] = useState(loadModelLibrary);
  const visible = options.filter((item) => `${item.provider} ${item.model}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = visible.find((item) => item.value === chosen)?.value ?? visible[0]?.value ?? "";
  const favorites = visible.filter((item) => library.favorites.includes(item.value));
  const recent = library.recent.flatMap((value) => visible.filter((item) => item.value === value && !library.favorites.includes(value)));
  const rest = visible.filter((item) => !library.favorites.includes(item.value) && !library.recent.includes(item.value));
  const favorite = library.favorites.includes(selected);
  function toggleFavorite() {
    const next = { ...library, favorites: favorite ? library.favorites.filter((value) => value !== selected) : [...library.favorites, selected].slice(-24) };
    setLibrary(next); saveModelLibrary(next);
  }
  const renderOptions = (items: ModelOption[]) => items.map((item) => <option key={item.value} value={item.value}>{item.model} · {item.provider}</option>);
  return <DialogShell className="model-library" ariaLabel={t("Find a model")} onClose={onClose}>
    <h2>{t("Find a model")}</h2>
    <FormField label={t("Search models")}><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} disabled={busy} /></FormField>
    <FormField label={t("Available models")}><SelectControl value={selected} disabled={busy || !visible.length} onChange={(event) => setChosen(event.target.value)}>
      {!visible.length && <option value="">{t("No matching model")}</option>}
      {favorites.length > 0 && <optgroup label={t("Favorite models")}>{renderOptions(favorites)}</optgroup>}
      {recent.length > 0 && <optgroup label={t("Recent models")}>{renderOptions(recent)}</optgroup>}
      {rest.length > 0 && <optgroup label={t("All models")}>{renderOptions(rest)}</optgroup>}
    </SelectControl></FormField>
    <p className="settings-help">{t("Favorites and recent models are stored only on this device.")}</p>
    {error && <p role="alert">{error}</p>}
    <DialogActions><button type="button" aria-pressed={favorite} disabled={busy || !selected} onClick={toggleFavorite}>{favorite ? t("Remove favorite") : t("Add favorite")}</button><button type="button" onClick={onClose}>{t("Cancel")}</button><button type="button" className="primary" disabled={busy || !selected} onClick={() => onChoose(selected)}>{busy ? t("Changing model…") : t("Use model")}</button></DialogActions>
  </DialogShell>;
}
