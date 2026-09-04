import { useEffect, useMemo, useState } from "react";
import { Bot as BotIcon, LoaderCircle, PawPrint, Search } from "lucide-react";
import { BotAvatar } from "./BotAvatar";
import { useI18n } from "./i18n";
import type { AvatarPet, BotAvatarValue } from "./App";

const BLOB_KINDS = ["round", "organic", "boxy", "capsule", "nub", "cloud", "droplet", "hexagon", "sun", "triangle"] as const;
const frameCache = new Map<string, Promise<string | null>>();
let petFetchActive = 0;
const petFetchQueue: Array<() => Promise<void>> = [];

function pumpPetQueue() {
  while (petFetchActive < 4 && petFetchQueue.length) {
    const job = petFetchQueue.shift()!;
    petFetchActive += 1;
    void job().finally(() => {
      petFetchActive -= 1;
      pumpPetQueue();
    });
  }
}

async function petFrame(spriteUrl: string) {
  if (!frameCache.has(spriteUrl)) {
    frameCache.set(spriteUrl, new Promise((resolve) => {
      petFetchQueue.push(async () => {
        try {
          const response = await fetch(spriteUrl, { signal: AbortSignal.timeout(15_000) });
          if (!response.ok) return resolve(null);
          const bitmap = await createImageBitmap(await response.blob(), 0, 0, 192, 208);
          const canvas = document.createElement("canvas");
          canvas.width = 96;
          canvas.height = 104;
          canvas.getContext("2d")?.drawImage(bitmap, 0, 0, 96, 104);
          bitmap.close();
          resolve(canvas.toDataURL("image/png"));
        } catch {
          frameCache.delete(spriteUrl);
          resolve(null);
        }
      });
      pumpPetQueue();
    }));
  }
  return frameCache.get(spriteUrl)!;
}

function PetThumb({ pet }: { pet: AvatarPet }) {
  const [image, setImage] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    if (pet.spritesheetUrl) void petFrame(pet.spritesheetUrl).then((value) => active && setImage(value));
    return () => { active = false; };
  }, [pet.spritesheetUrl]);
  if (!pet.spritesheetUrl || image === null) return <span className="pet-placeholder" aria-hidden="true"><PawPrint size={19} /></span>;
  return image
    ? <img src={image} alt="" width="48" height="52" />
    : <span className="pet-placeholder" aria-hidden="true"><LoaderCircle size={18} /></span>;
}

interface BotAppearancePickerProps {
  botName: string;
  value: BotAvatarValue;
  onChange(value: BotAvatarValue): void;
  loadPets?: () => Promise<AvatarPet[]>;
}

export function BotAppearancePicker({ botName, value, onChange, loadPets }: BotAppearancePickerProps) {
  const { locale, t, formatError } = useI18n();
  const [tab, setTab] = useState<"bot" | "pets">(value.image ? "pets" : "bot");
  const [pets, setPets] = useState<AvatarPet[]>([]);
  const [petsLoading, setPetsLoading] = useState(false);
  const [petsLoaded, setPetsLoaded] = useState(false);
  const [petError, setPetError] = useState("");
  const [query, setQuery] = useState("");
  const [selectingPet, setSelectingPet] = useState("");
  const [selectedPet, setSelectedPet] = useState("");

  useEffect(() => {
    if (tab !== "pets" || petsLoaded || !loadPets) return;
    let active = true;
    setPetsLoading(true);
    setPetError("");
    void loadPets().then((result) => {
      if (!active) return;
      setPets(result);
      setPetsLoaded(true);
    }).catch((cause) => {
      if (!active) return;
      setPetError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => active && setPetsLoading(false));
    return () => { active = false; };
  }, [loadPets, petsLoaded, tab]);

  const visiblePets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    return pets
      .filter((pet) => !normalized || `${pet.displayName} ${pet.slug}`.toLocaleLowerCase(locale).includes(normalized))
      .sort((left, right) => Number(Boolean(right.installed)) - Number(Boolean(left.installed)) || Number(Boolean(right.curated)) - Number(Boolean(left.curated)))
      .slice(0, 24);
  }, [locale, pets, query]);

  async function choosePet(pet: AvatarPet) {
    if (!pet.spritesheetUrl) return;
    setSelectingPet(pet.slug);
    const image = await petFrame(pet.spritesheetUrl);
    setSelectingPet("");
    if (image) {
      setSelectedPet(pet.slug);
      onChange({ image });
    }
    else setPetError(t("This pet could not be loaded. Try another one."));
  }

  function navigateTabs(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "bot" : event.key === "End" ? "pets" : tab === "bot" ? "pets" : "bot";
    setTab(next);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[next === "bot" ? 0 : 1]?.focus();
  }

  return (
    <section className="appearance-picker" aria-label={t("Bot appearance")}>
      <div className="appearance-preview">
        <BotAvatar bot={{ name: botName || "new-bot", system: false, avatar: value }} size={72} />
        <div><strong>{t("Appearance")}</strong><span>{value.image ? t("Hermes Petdex pet") : t("Hermes Blobatar")}</span></div>
      </div>
      <div className="appearance-tabs" role="tablist" aria-label={t("Avatar type")}>
        <button id="appearance-tab-bot" type="button" role="tab" tabIndex={tab === "bot" ? 0 : -1} aria-selected={tab === "bot"} aria-controls="appearance-panel-bot" onKeyDown={navigateTabs} onClick={() => setTab("bot")}><BotIcon size={16} />{t("Bot")}</button>
        <button id="appearance-tab-pets" type="button" role="tab" tabIndex={tab === "pets" ? 0 : -1} aria-selected={tab === "pets"} aria-controls="appearance-panel-pets" onKeyDown={navigateTabs} onClick={() => setTab("pets")}><PawPrint size={16} />{t("Pets")}</button>
      </div>
      {tab === "bot" ? (
        <div id="appearance-panel-bot" className="appearance-grid" role="tabpanel" aria-labelledby="appearance-tab-bot">
          {BLOB_KINDS.map((kind) => {
            const shape = `blobatar::${kind}`;
            return <button key={kind} type="button" className={value.shape === shape && !value.image ? "selected" : ""} aria-pressed={value.shape === shape && !value.image} aria-label={t(kind)} onClick={() => { setSelectedPet(""); onChange({ shape }); }}><BotAvatar bot={{ name: botName || "new-bot", system: false, avatar: { shape } }} size={44} /><span>{t(kind)}</span></button>;
          })}
        </div>
      ) : (
        <div id="appearance-panel-pets" className="pet-panel" role="tabpanel" aria-labelledby="appearance-tab-pets">
          <label className="pet-search"><Search size={15} /><span className="sr-only">{t("Search pets")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search pets…")} /></label>
          {petsLoading && <div className="pet-state"><LoaderCircle className="spin" size={18} />{t("Loading Hermes pets…")}</div>}
          {!petsLoading && petError && <p className="pet-state error" role="alert">{formatError(petError)}</p>}
          {!petsLoading && !petError && petsLoaded && visiblePets.length === 0 && <p className="pet-state">{t("No pets found.")}</p>}
          {visiblePets.length > 0 && <div className="pet-grid" aria-label={t("Hermes Petdex pets")}>{visiblePets.map((pet) => <button key={pet.slug} type="button" className={selectedPet === pet.slug ? "selected" : ""} disabled={selectingPet === pet.slug} aria-label={pet.displayName} aria-pressed={selectedPet === pet.slug} onClick={() => void choosePet(pet)}><PetThumb pet={pet} /><span>{pet.displayName}</span>{pet.installed && <small>{t("Installed")}</small>}</button>)}</div>}
          {petsLoaded && pets.length > 24 && <p className="pet-count">{t("Showing the first {count} matches. Refine your search to explore the full Petdex.", { count: visiblePets.length })}</p>}
        </div>
      )}
    </section>
  );
}
