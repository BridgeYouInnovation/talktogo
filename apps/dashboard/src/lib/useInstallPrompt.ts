import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Capture the event at module load — it often fires before React mounts.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<(available: boolean) => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    subscribers.forEach((fn) => fn(true));
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    subscribers.forEach((fn) => fn(false));
  });
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function useInstallPrompt(): { showInstall: boolean; install: () => void } {
  const [, setAvailable] = useState(!!deferredPrompt);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const fn = (avail: boolean) => {
      setAvailable(avail);
      if (!avail) setInstalled(true);
    };
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);

  const install = useCallback(async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        deferredPrompt = null;
        setInstalled(true);
      }
      return;
    }
    // Browsers without beforeinstallprompt (iOS Safari, Firefox): instructions.
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    alert(
      isIOS
        ? "To install TalkToGo on your iPhone/iPad:\n\n1. Tap the Share button (square with arrow)\n2. Scroll down and tap “Add to Home Screen”\n3. Tap “Add”"
        : "To install TalkToGo:\n\nOpen your browser menu and choose “Install app” or “Add to Home Screen”."
    );
  }, []);

  return { showInstall: !installed, install };
}
