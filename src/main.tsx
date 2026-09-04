import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { api } from "./api";
import { LanguageProvider } from "./i18n";
import { WindowControls } from "./WindowControls";
import "./styles.css";
import "./platform.css";

declare global {
  const __APP_VERSION__: string;
}

const desktopPlatform = new URLSearchParams(window.location.search).get("desktop");
if (desktopPlatform === "windows" || desktopPlatform === "macos") document.documentElement.dataset.desktop = desktopPlatform;

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><LanguageProvider><App api={api} /><WindowControls /></LanguageProvider></React.StrictMode>);
