import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

declare global {
  interface Window {
    __APP_ROOT__?: HTMLElement | null;
  }
}

const container = document.getElementById("root") ?? document.createElement("div");
container.id = "root";
if (!container.parentElement) {
  document.body.appendChild(container);
}

window.__APP_ROOT__ = container;

const root = createRoot(container);
root.render(<App />);
