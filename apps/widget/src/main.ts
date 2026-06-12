import { TalkToGoWidget } from "./widget";

// Entry point. Sites embed:
//   <script src="https://your-app/widget.js" data-site-id="UUID" async></script>
// The WordPress plugin emits the same tag automatically.

function findSiteId(): string | null {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current?.dataset.siteId) return current.dataset.siteId;

  // Fallback for loaders that inject the script differently.
  const tagged = document.querySelector<HTMLScriptElement>("script[data-site-id]");
  if (tagged?.dataset.siteId) return tagged.dataset.siteId;

  // Global config variant: window.talkToGoSiteId = "UUID"
  const w = window as unknown as { talkToGoSiteId?: string };
  return w.talkToGoSiteId ?? null;
}

function start(): void {
  const siteId = findSiteId();
  if (!siteId) {
    console.warn("[TalkToGo] missing data-site-id on the widget script tag");
    return;
  }
  if (document.getElementById("talktogo-widget")) return; // already loaded

  const boot = () => new TalkToGoWidget(siteId).init();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}

start();
