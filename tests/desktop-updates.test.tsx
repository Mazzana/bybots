// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopUpdates } from "../src/DesktopUpdates";
import { LanguageProvider } from "../src/i18n";
import type { ReleaseCheck } from "../electron/release-checker";
afterEach(() => { cleanup(); delete window.byBotsDesktop; });
const mount = () => render(<LanguageProvider initialLanguage="en"><DesktopUpdates /></LanguageProvider>);

it("hides desktop checks in the web version", () => {
  mount();
  expect(screen.queryByRole("button", { name: "Check for updates" })).not.toBeInTheDocument();
});
it("checks only on click, prevents duplicate requests and presents a release link", async () => {
  let finish!: (value: ReleaseCheck) => void;
  const check = vi.fn(() => new Promise<ReleaseCheck>((resolve) => { finish = resolve; }));
  window.byBotsDesktop = { updates: { check } };
  mount();
  expect(check).not.toHaveBeenCalled();
  const button = screen.getByRole("button", { name: "Check for updates" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(check).toHaveBeenCalledTimes(1);
  await act(async () => finish({ status: "available", version: "0.4.0", url: "https://github.com/Mazzana/bybots/releases/tag/v0.4.0" }));
  expect(screen.getByRole("status")).toHaveTextContent("Version 0.4.0 is available.");
  expect(screen.getByRole("link", { name: "View release on GitHub" })).toHaveAttribute("rel", "noreferrer");
  expect(button).toBeEnabled();
});
it("keeps no-release, current and error states distinct and ignores an unmounted check", async () => {
  const check = vi.fn<() => Promise<ReleaseCheck>>().mockResolvedValue({ status: "no-stable-release" });
  window.byBotsDesktop = { updates: { check } };
  const view = mount();
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No stable release is published yet."));
  check.mockResolvedValue({ status: "current" });
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No newer stable release"));
  check.mockRejectedValue(new Error("private"));
  fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByRole("alert")).toHaveTextContent("try again in a minute");
  expect(screen.queryByText("private")).not.toBeInTheDocument();
  let finish!: (value: ReleaseCheck) => void;
  check.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button"));
  view.unmount();
  await act(async () => finish({ status: "current" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
