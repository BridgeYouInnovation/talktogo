export interface WidgetSettings {
  primaryColor: string;
  position: "left" | "right";
  title: string;
  subtitle: string;
  welcomeMessage: string;
  offlineMessage: string;
  launcherIcon: "chat" | "message" | "help";
  showBranding: boolean;
  agentName: string;
}

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  primaryColor: "#2563eb",
  position: "right",
  title: "Chat with us",
  subtitle: "We typically reply in a few minutes",
  welcomeMessage: "Hi there! 👋 How can we help you today?",
  offlineMessage: "Leave a message and we will get back to you by email.",
  launcherIcon: "chat",
  showBranding: true,
  agentName: "Support",
};

export interface Site {
  id: string;
  owner_id: string;
  name: string;
  domain: string | null;
  widget_settings: WidgetSettings;
  created_at: string;
}

export interface Visitor {
  id: string;
  site_id: string;
  name: string | null;
  email: string | null;
  country: string | null;
  country_code: string | null;
  city: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  current_page: string | null;
  current_page_title: string | null;
  referrer: string | null;
  online: boolean;
  first_seen_at: string;
  last_seen_at: string;
}

export interface Conversation {
  id: string;
  site_id: string;
  visitor_id: string;
  status: "open" | "closed";
  created_at: string;
  last_message_at: string;
  last_message_preview: string | null;
  agent_unread_count: number;
  visitors?: Visitor;
}

export interface Message {
  id: string;
  conversation_id: string;
  site_id: string;
  sender_type: "visitor" | "agent";
  agent_id: string | null;
  body: string;
  created_at: string;
}

// Country code (ISO 3166-1 alpha-2) → flag emoji.
export function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "🌐";
  const base = 0x1f1e6;
  const a = code.toUpperCase().charCodeAt(0) - 65;
  const b = code.toUpperCase().charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return "🌐";
  return String.fromCodePoint(base + a, base + b);
}

export function visitorLabel(v: Visitor | undefined | null): string {
  if (!v) return "Visitor";
  return v.name || v.email || `Visitor ${v.id.slice(0, 6)}`;
}

export function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
