import { useEffect, useState } from "react";

let deferredInstallPrompt = null;
let installed = false;
const listeners = new Set();

function isStandaloneDisplay() {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(
    window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true,
  );
}

function isIosDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function notify() {
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  installed = isStandaloneDisplay();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    installed = true;
    notify();
  });
}

export function getPwaInstallState() {
  return {
    canInstall: Boolean(deferredInstallPrompt) || isIosDevice(),
    deferredPromptAvailable: Boolean(deferredInstallPrompt),
    isIos: isIosDevice(),
    installed: installed || isStandaloneDisplay(),
  };
}

export function subscribePwaInstall(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function requestPwaInstall() {
  if (!deferredInstallPrompt) {
    return { ok: false, supported: isIosDevice(), manual: isIosDevice() };
  }

  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  notify();
  await prompt.prompt();
  const choice = await prompt.userChoice;

  return {
    ok: choice?.outcome === "accepted",
    outcome: choice?.outcome ?? "dismissed",
    supported: true,
    manual: false,
  };
}

export function usePwaInstall() {
  const [state, setState] = useState(getPwaInstallState);

  useEffect(() => {
    const refresh = () => setState(getPwaInstallState());
    refresh();
    return subscribePwaInstall(refresh);
  }, []);

  return state;
}
