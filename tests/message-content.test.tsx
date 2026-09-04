// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageContent } from "../src/MessageContent";
import { LanguageProvider } from "../src/i18n";

afterEach(cleanup);

describe("MessageContent", () => {
  it("renders structured Markdown Bot output", () => {
    const { container } = render(<LanguageProvider initialLanguage="fr"><MessageContent text={"## Résultat\n\n- **Total** : 42\n\n```json\n{\"ok\":true}\n```"} /></LanguageProvider>);

    expect(screen.getByRole("heading", { name: "Résultat" })).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(container.querySelector("pre code")).toHaveTextContent('{"ok":true}');
  });

  it("turns Hermes MEDIA lines into generated-result cards", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<LanguageProvider initialLanguage="en"><MessageContent text={"Report ready.\n\nMEDIA:C:\\Users\\ruben\\report.md"} /></LanguageProvider>);

    expect(screen.getByText("Report ready.")).toBeInTheDocument();
    expect(screen.getByText("report.md")).toBeInTheDocument();
    expect(screen.queryByText(/MEDIA:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy the path to report.md" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("C:\\Users\\ruben\\report.md"));
  });

  it("opens safe web results without turning local paths into links", () => {
    render(<LanguageProvider initialLanguage="en"><MessageContent text={"MEDIA:https://files.example.test/report.pdf\nMEDIA:C:\\Users\\ruben\\private.pdf"} /></LanguageProvider>);

    expect(screen.getByRole("link", { name: "Open report.pdf" })).toHaveAttribute("href", "https://files.example.test/report.pdf");
    expect(screen.getAllByText("private.pdf").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Open private.pdf" })).not.toBeInTheDocument();
  });

  it("renders known user and Bot mentions with friendly highlighted labels", () => {
    render(<LanguageProvider initialLanguage="fr"><MessageContent text="@user, confirme avec @finance." mentions={{ user: { kind: "user", label: "Administrateur" }, finance: { kind: "bot", label: "Finance Byfinity" } }} /></LanguageProvider>);

    expect(screen.getByText("@Administrateur")).toHaveClass("message-mention", "message-mention-user");
    expect(screen.getByText("@Finance Byfinity")).toHaveClass("message-mention", "message-mention-bot");
  });
});
