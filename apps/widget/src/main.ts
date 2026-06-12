import { TalkToGoWidget } from "./widget";

// Entry point. Sites embed:
//   <script src="https://your-app/widget.js" data-site-id="UUID" async></script>
// The WordPress plugin emits the same tag automatically.

function findConfig(): { siteId: string | null; apiOrigin: string } {
  const current = document.currentScript as HTMLScriptElement | null;
  const tagged =
    current?.dataset.siteId != null
      ? current
      : document.querySelector<HTMLScriptElement>("script[data-site-id]");

  // The push API lives on the same origin that serves widget.js.
  let apiOrigin = "";
  try {
    const src = (current ?? tagged)?.src;
    if (src) {
      const u = new URL(src, location.href);
      if (u.pathname.endsWith("/widget.js")) apiOrigin = u.origin;
    }
  } catch {
    /* ignore */
  }
  if (!apiOrigin) apiOrigin = (import.meta.env.VITE_APP_URL as string | undefined) ?? "";

  if (tagged?.dataset.siteId) return { siteId: tagged.dataset.siteId, apiOrigin };

  // Global config variant: window.talkToGoSiteId = "UUID"
  const w = window as unknown as { talkToGoSiteId?: string };
  return { siteId: w.talkToGoSiteId ?? null, apiOrigin };
}

function start(): void {
  const { siteId, apiOrigin } = findConfig();
  if (!siteId) {
    console.warn("[TalkToGo] missing data-site-id on the widget script tag");
    return;
  }
  if (document.getElementById("talktogo-widget")) return; // already loaded

  const boot = () => new TalkToGoWidget(siteId, apiOrigin).init();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}

start();
