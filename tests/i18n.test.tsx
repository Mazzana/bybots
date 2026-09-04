// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider, useI18n } from "../src/i18n";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function LanguageProbe() {
  const { language, languagePreference, t, formatError } = useI18n();
  return <div>
    <span data-testid="language">{language}</span>
    <span data-testid="preference">{languagePreference}</span>
    <span>{t("System language")}</span>
    <span>{formatError(new Error("Profile 'inbox-triage' already exists"))}</span>
  </div>;
}

describe("language preferences", () => {
  it("uses the operating-system language by default and persists that preference", async () => {
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("en-US");
    render(<LanguageProvider><LanguageProbe /></LanguageProvider>);

    expect(screen.getByTestId("language")).toHaveTextContent("en");
    expect(screen.getByTestId("preference")).toHaveTextContent("system");
    expect(screen.getByText("System language")).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem("byfinity.language")).toBe("system"));
    expect(document.documentElement.lang).toBe("en");
  });

  it("updates the resolved locale when the system language changes", async () => {
    const language = vi.spyOn(window.navigator, "language", "get").mockReturnValue("en-US");
    render(<LanguageProvider><LanguageProbe /></LanguageProvider>);

    language.mockReturnValue("fr-FR");
    fireEvent(window, new Event("languagechange"));

    expect(await screen.findByText("Langue du système")).toBeInTheDocument();
    expect(screen.getByTestId("language")).toHaveTextContent("fr");
    expect(screen.getByText("Le profil « inbox-triage » existe déjà")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("fr");
  });
});
