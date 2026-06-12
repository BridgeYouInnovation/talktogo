export function randomKey(len = 32): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export interface ClientInfo {
  browser: string;
  os: string;
  device: string;
}

export function detectClient(): ClientInfo {
  const ua = navigator.userAgent;
  let browser = "Unknown";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/SamsungBrowser/.test(ua)) browser = "Samsung Internet";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = "Safari";
  else if (/Firefox\//.test(ua)) browser = "Firefox";

  let os = "Unknown";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";

  const device = /Mobi|Android|iPhone|iPad/.test(ua) ? "Mobile" : "Desktop";
  return { browser, os, device };
}

export interface GeoInfo {
  country: string | null;
  country_code: string | null;
  city: string | null;
}

const GEO_CACHE_KEY = "ttg_geo_v1";

// Look up the visitor's country/city from their IP. Cached in
// localStorage so each visitor hits the geo API at most once.
export async function lookupGeo(): Promise<GeoInfo> {
  try {
    const cached = localStorage.getItem(GEO_CACHE_KEY);
    if (cached) return JSON.parse(cached) as GeoInfo;
  } catch {
    /* storage unavailable */
  }

  const empty: GeoInfo = { country: null, country_code: null, city: null };

  const providers: Array<() => Promise<GeoInfo>> = [
    async () => {
      const r = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      return { country: j.country_name ?? null, country_code: j.country_code ?? null, city: j.city ?? null };
    },
    async () => {
      const r = await fetch("https://ipwho.is/", { signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      return { country: j.country ?? null, country_code: j.country_code ?? null, city: j.city ?? null };
    },
  ];

  for (const provider of providers) {
    try {
      const geo = await provider();
      if (geo.country) {
        try {
          localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geo));
        } catch {
          /* ignore */
        }
        return geo;
      }
    } catch {
      /* try next provider */
    }
  }
  return empty;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// Patch History API so SPA navigations fire a callback.
export function onPageChange(cb: (url: string, title: string) => void): void {
  let lastUrl = location.href;
  const fire = () => {
    // Title often updates a tick after navigation in SPAs.
    setTimeout(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        cb(location.href, document.title);
      }
    }, 50);
  };

  const origPush = history.pushState.bind(history);
  history.pushState = (...args) => {
    origPush(...args);
    fire();
  };
  const origReplace = history.replaceState.bind(history);
  history.replaceState = (...args) => {
    origReplace(...args);
    fire();
  };
  window.addEventListener("popstate", fire);
  window.addEventListener("hashchange", fire);
}
