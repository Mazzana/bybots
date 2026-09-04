// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BotAppearancePicker } from "../src/BotAppearancePicker";
import { BotAvatar } from "../src/BotAvatar";
import { LanguageProvider } from "../src/i18n";

afterEach(cleanup);

describe("BotAvatar", () => {
  it("renders the avatar image stored by Hermes", () => {
    render(<LanguageProvider initialLanguage="fr"><BotAvatar bot={{ name: "analyst", system: false, avatar: { image: "data:image/png;base64,abc" } }} /></LanguageProvider>);

    expect(screen.getByRole("img", { name: "Avatar de analyst" })).toHaveAttribute("src", "data:image/png;base64,abc");
  });

  it("renders Hermes deterministic blob faces from avatar metadata", () => {
    const { container } = render(
      <LanguageProvider initialLanguage="fr"><BotAvatar bot={{ name: "analyst", avatar: { shape: "blobatar:locked-seed:cloud", color: "#7170ff" } }} /></LanguageProvider>
    );

    expect(container.querySelector("[data-bot-avatar] svg")).toBeInTheDocument();
  });
});

describe("BotAppearancePicker", () => {
  it("uses roving focus and arrow keys for avatar type tabs", () => {
    render(<LanguageProvider initialLanguage="en"><BotAppearancePicker botName="analyst" value={{ shape: "blobatar::round" }} onChange={() => undefined} /></LanguageProvider>);

    const botTab = screen.getByRole("tab", { name: "Bot" });
    const petsTab = screen.getByRole("tab", { name: "Pets" });
    expect(botTab).toHaveAttribute("tabindex", "0");
    expect(petsTab).toHaveAttribute("tabindex", "-1");
    botTab.focus();
    fireEvent.keyDown(botTab, { key: "ArrowRight" });

    expect(petsTab).toHaveFocus();
    expect(petsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Pets" })).toBeInTheDocument();
  });
});
