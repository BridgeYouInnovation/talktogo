import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import {
  detectClient,
  escapeHtml,
  formatTime,
  lookupGeo,
  onPageChange,
  randomKey,
} from "./utils";

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

interface ChatMessage {
  id: string;
  sender_type: "visitor" | "agent";
  body: string;
  created_at: string;
}

const DEFAULTS: WidgetSettings = {
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

const ICONS: Record<string, string> = {
  chat: '<svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.2 1.1 4.2 2.9 5.6-.2 1.1-.8 2.2-1.7 3.1-.2.2-.1.6.2.6 1.9.1 3.6-.5 4.9-1.4 1.1.4 2.4.6 3.7.6 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>',
  message: '<svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4.2-8 5-8-5V6l8 5 8-5v2.2z"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm.9 15.9h-2v-2h2v2zm2.1-7.4c-.3.5-.8.9-1.4 1.4-.5.4-.7.7-.7 1.5h-2c0-1.3.5-2 1.2-2.6.5-.4.9-.7 1.1-1.1.2-.4.2-1-.2-1.4-.4-.4-1.3-.5-1.9-.1-.4.3-.6.7-.6 1.2h-2c0-1.2.5-2.2 1.4-2.8 1.3-.9 3.4-.8 4.5.3.9.9 1.1 2.5.6 3.6z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>',
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export class TalkToGoWidget {
  private siteId: string;
  private supabase: SupabaseClient;
  private visitorKey: string;
  private visitorId: string | null = null;
  private conversationId: string | null = null;
  private settings: WidgetSettings = DEFAULTS;
  private messages: ChatMessage[] = [];
  private convChannel: RealtimeChannel | null = null;
  private siteChannel: RealtimeChannel | null = null;
  private open = false;
  private unread = 0;
  private identified = false;
  private identifyDismissed = false;
  private heartbeatTimer: number | null = null;
  private typingTimeout: number | null = null;
  private lastTypingSent = 0;

  // DOM
  private host!: HTMLDivElement;
  private root!: ShadowRoot;
  private launcherEl!: HTMLButtonElement;
  private panelEl!: HTMLDivElement;
  private messagesEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private badgeEl!: HTMLSpanElement;
  private typingEl!: HTMLDivElement;

  constructor(siteId: string) {
    this.siteId = siteId;
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const storageKey = `ttg_vk_${siteId}`;
    let key: string | null = null;
    try {
      key = localStorage.getItem(storageKey);
      if (!key) {
        key = randomKey(40);
        localStorage.setItem(storageKey, key);
      }
    } catch {
      key = randomKey(40);
    }
    this.visitorKey = key;
    try {
      this.identified = localStorage.getItem(`ttg_idd_${siteId}`) === "1";
    } catch {
      /* ignore */
    }
  }

  async init(): Promise<void> {
    const client = detectClient();
    const geo = await lookupGeo();

    const { data, error } = await this.supabase.rpc("widget_init", {
      p_site_id: this.siteId,
      p_visitor_key: this.visitorKey,
      p_url: location.href,
      p_title: document.title,
      p_referrer: document.referrer || null,
      p_browser: client.browser,
      p_os: client.os,
      p_device: client.device,
      p_country: geo.country,
      p_country_code: geo.country_code,
      p_city: geo.city,
    });

    if (error || !data) {
      console.warn("[TalkToGo] failed to initialize:", error?.message);
      return;
    }

    this.visitorId = data.visitor_id;
    this.conversationId = data.conversation_id;
    this.settings = { ...DEFAULTS, ...(data.settings ?? {}) };
    this.messages = (data.messages ?? []) as ChatMessage[];

    this.render();
    this.connectRealtime();
    this.broadcastPresence(data.is_new_visitor ? "enter" : "return");
    this.startHeartbeat();
    this.trackNavigation();
  }

  // ----------------------------------------------------------
  // Realtime
  // ----------------------------------------------------------

  private connectRealtime(): void {
    this.convChannel = this.supabase
      .channel(`conv:${this.conversationId}`)
      .on("broadcast", { event: "message" }, ({ payload }) => {
        if (payload?.sender_type === "agent") {
          this.appendMessage({
            id: payload.id ?? randomKey(12),
            sender_type: "agent",
            body: String(payload.body ?? ""),
            created_at: payload.created_at ?? new Date().toISOString(),
          });
          this.hideTyping();
          if (!this.open) {
            this.unread++;
            this.updateBadge();
          }
        }
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload?.from === "agent") this.showTyping();
      })
      .subscribe();

    this.siteChannel = this.supabase.channel(`site:${this.siteId}`).subscribe();
  }

  private broadcastPresence(type: "enter" | "return" | "page" | "leave"): void {
    this.siteChannel?.send({
      type: "broadcast",
      event: "presence",
      payload: {
        type,
        visitor_id: this.visitorId,
        url: location.href,
        title: document.title,
        at: new Date().toISOString(),
      },
    });
  }

  private broadcastNewMessage(body: string): void {
    this.siteChannel?.send({
      type: "broadcast",
      event: "new_message",
      payload: {
        visitor_id: this.visitorId,
        conversation_id: this.conversationId,
        body,
        at: new Date().toISOString(),
      },
    });
  }

  // ----------------------------------------------------------
  // Tracking
  // ----------------------------------------------------------

  private startHeartbeat(): void {
    this.heartbeatTimer = window.setInterval(() => {
      this.supabase
        .rpc("widget_heartbeat", {
          p_site_id: this.siteId,
          p_visitor_key: this.visitorKey,
          p_online: true,
        })
        .then(() => {});
    }, 30_000);

    // Mark offline when the tab closes; keepalive fetch survives unload.
    window.addEventListener("pagehide", () => {
      this.broadcastPresence("leave");
      fetch(`${SUPABASE_URL}/rest/v1/rpc/widget_heartbeat`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          p_site_id: this.siteId,
          p_visitor_key: this.visitorKey,
          p_online: false,
        }),
      }).catch(() => {});
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.supabase
          .rpc("widget_heartbeat", {
            p_site_id: this.siteId,
            p_visitor_key: this.visitorKey,
            p_online: true,
          })
          .then(() => {});
      }
    });
  }

  private trackNavigation(): void {
    onPageChange((url, title) => {
      this.supabase
        .rpc("widget_track_page", {
          p_site_id: this.siteId,
          p_visitor_key: this.visitorKey,
          p_url: url,
          p_title: title,
        })
        .then(() => {});
      this.broadcastPresence("page");
    });
  }

  // ----------------------------------------------------------
  // Sending
  // ----------------------------------------------------------

  private async sendMessage(body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed) return;

    const optimistic: ChatMessage = {
      id: `tmp_${randomKey(8)}`,
      sender_type: "visitor",
      body: trimmed,
      created_at: new Date().toISOString(),
    };
    this.appendMessage(optimistic);
    this.inputEl.value = "";
    this.autosize();

    const { data, error } = await this.supabase.rpc("widget_send_message", {
      p_site_id: this.siteId,
      p_visitor_key: this.visitorKey,
      p_body: trimmed,
    });

    if (error) {
      console.warn("[TalkToGo] send failed:", error.message);
      return;
    }

    this.convChannel?.send({
      type: "broadcast",
      event: "message",
      payload: {
        id: data?.id,
        sender_type: "visitor",
        body: trimmed,
        created_at: data?.created_at ?? optimistic.created_at,
      },
    });
    this.broadcastNewMessage(trimmed);

    if (!this.identified && !this.identifyDismissed) this.showIdentifyCard();
  }

  private sendTyping(): void {
    const now = Date.now();
    if (now - this.lastTypingSent < 2000) return;
    this.lastTypingSent = now;
    this.convChannel?.send({
      type: "broadcast",
      event: "typing",
      payload: { from: "visitor" },
    });
  }

  private async submitIdentify(name: string, email: string): Promise<void> {
    await this.supabase.rpc("widget_identify", {
      p_site_id: this.siteId,
      p_visitor_key: this.visitorKey,
      p_name: name || null,
      p_email: email || null,
    });
    this.identified = true;
    try {
      localStorage.setItem(`ttg_idd_${this.siteId}`, "1");
    } catch {
      /* ignore */
    }
  }

  // ----------------------------------------------------------
  // UI
  // ----------------------------------------------------------

  private render(): void {
    this.host = document.createElement("div");
    this.host.id = "talktogo-widget";
    this.root = this.host.attachShadow({ mode: "open" });

    const s = this.settings;
    const side = s.position === "left" ? "left" : "right";

    const style = document.createElement("style");
    style.textContent = this.css(side);
    this.root.appendChild(style);

    // Launcher
    this.launcherEl = document.createElement("button");
    this.launcherEl.className = "ttg-launcher";
    this.launcherEl.setAttribute("aria-label", "Open chat");
    this.launcherEl.innerHTML = `
      <span class="ttg-icon-open">${ICONS[s.launcherIcon] ?? ICONS.chat}</span>
      <span class="ttg-icon-close">${ICONS.close}</span>
      <span class="ttg-badge" hidden></span>`;
    this.badgeEl = this.launcherEl.querySelector(".ttg-badge")!;
    this.launcherEl.addEventListener("click", () => this.toggle());

    // Panel
    this.panelEl = document.createElement("div");
    this.panelEl.className = "ttg-panel";
    this.panelEl.hidden = true;
    this.panelEl.innerHTML = `
      <div class="ttg-header">
        <div class="ttg-avatar">${escapeHtml((s.agentName || "S").charAt(0).toUpperCase())}</div>
        <div class="ttg-header-text">
          <div class="ttg-title">${escapeHtml(s.title)}</div>
          <div class="ttg-subtitle">${escapeHtml(s.subtitle)}</div>
        </div>
      </div>
      <div class="ttg-messages"></div>
      <div class="ttg-typing" hidden>
        <span></span><span></span><span></span>
      </div>
      <div class="ttg-input-row">
        <textarea class="ttg-input" rows="1" placeholder="Type your message…"></textarea>
        <button class="ttg-send" aria-label="Send">${ICONS.send}</button>
      </div>
      ${s.showBranding ? '<div class="ttg-branding">Powered by <b>TalkToGo</b></div>' : ""}`;

    this.messagesEl = this.panelEl.querySelector(".ttg-messages")!;
    this.typingEl = this.panelEl.querySelector(".ttg-typing")!;
    this.inputEl = this.panelEl.querySelector(".ttg-input")!;

    const sendBtn = this.panelEl.querySelector<HTMLButtonElement>(".ttg-send")!;
    sendBtn.addEventListener("click", () => this.sendMessage(this.inputEl.value));
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage(this.inputEl.value);
      } else {
        this.sendTyping();
      }
    });
    this.inputEl.addEventListener("input", () => this.autosize());

    this.root.appendChild(this.panelEl);
    this.root.appendChild(this.launcherEl);
    document.body.appendChild(this.host);

    // Welcome message + history
    if (s.welcomeMessage) {
      this.renderMessage({
        id: "welcome",
        sender_type: "agent",
        body: s.welcomeMessage,
        created_at: new Date().toISOString(),
      });
    }
    for (const m of this.messages) this.renderMessage(m);
    this.scrollToBottom();
  }

  private css(side: string): string {
    const c = this.settings.primaryColor;
    return `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
      [hidden] { display: none !important; }
      .ttg-launcher {
        position: fixed; bottom: 20px; ${side}: 20px; z-index: 2147483000;
        width: 58px; height: 58px; border-radius: 50%; border: none; cursor: pointer;
        background: ${c}; color: #fff; display: flex; align-items: center; justify-content: center;
        box-shadow: 0 6px 24px rgba(0,0,0,.22); transition: transform .15s ease;
      }
      .ttg-launcher:hover { transform: scale(1.07); }
      .ttg-launcher .ttg-icon-close { display: none; }
      .ttg-launcher.open .ttg-icon-close { display: flex; }
      .ttg-launcher.open .ttg-icon-open { display: none; }
      .ttg-badge {
        position: absolute; top: -2px; right: -2px; min-width: 20px; height: 20px;
        border-radius: 10px; background: #ef4444; color: #fff; font-size: 12px; font-weight: 700;
        display: flex; align-items: center; justify-content: center; padding: 0 5px;
      }
      .ttg-panel {
        position: fixed; bottom: 92px; ${side}: 20px; z-index: 2147483000;
        width: 372px; max-width: calc(100vw - 32px); height: 560px; max-height: calc(100vh - 120px);
        background: #fff; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column;
        box-shadow: 0 12px 48px rgba(0,0,0,.25);
        animation: ttg-pop .18s ease;
      }
      @keyframes ttg-pop { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }
      @media (max-width: 480px) {
        .ttg-panel { bottom: 0; ${side}: 0; width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; }
      }
      .ttg-header {
        background: linear-gradient(135deg, ${c}, ${c}dd);
        color: #fff; padding: 18px 16px; display: flex; align-items: center; gap: 12px;
      }
      .ttg-avatar {
        width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,.25);
        display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px;
      }
      .ttg-title { font-weight: 700; font-size: 16px; }
      .ttg-subtitle { font-size: 12.5px; opacity: .9; margin-top: 2px; }
      .ttg-messages { flex: 1; overflow-y: auto; padding: 16px 14px 8px; background: #f8fafc; }
      .ttg-msg { display: flex; margin-bottom: 10px; }
      .ttg-msg .ttg-bubble {
        max-width: 78%; padding: 10px 13px; border-radius: 14px; font-size: 14px; line-height: 1.45;
        white-space: pre-wrap; word-break: break-word;
      }
      .ttg-msg.agent .ttg-bubble { background: #fff; color: #111827; border: 1px solid #e5e7eb; border-bottom-left-radius: 4px; }
      .ttg-msg.visitor { justify-content: flex-end; }
      .ttg-msg.visitor .ttg-bubble { background: ${c}; color: #fff; border-bottom-right-radius: 4px; }
      .ttg-time { display: block; font-size: 10.5px; opacity: .6; margin-top: 4px; }
      .ttg-typing { display: flex; gap: 4px; padding: 0 16px 10px; align-items: center; background: #f8fafc; }
      .ttg-typing span { width: 7px; height: 7px; border-radius: 50%; background: #9ca3af; animation: ttg-blink 1.2s infinite; }
      .ttg-typing span:nth-child(2) { animation-delay: .2s; }
      .ttg-typing span:nth-child(3) { animation-delay: .4s; }
      @keyframes ttg-blink { 0%,80%,100% { opacity: .3; } 40% { opacity: 1; } }
      .ttg-input-row { display: flex; align-items: flex-end; border-top: 1px solid #e5e7eb; background: #fff; padding: 10px 12px; gap: 8px; }
      .ttg-input {
        flex: 1; border: none; outline: none; resize: none; font-size: 14px; line-height: 1.4;
        max-height: 110px; padding: 8px 4px; background: transparent; color: #111827;
      }
      .ttg-send {
        border: none; background: ${c}; color: #fff; width: 38px; height: 38px; border-radius: 50%;
        cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      }
      .ttg-send:hover { filter: brightness(1.1); }
      .ttg-branding { text-align: center; font-size: 11px; color: #9ca3af; padding: 6px 0 8px; background: #fff; }
      .ttg-branding b { color: #6b7280; }
      .ttg-identify {
        background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 14px; margin: 4px 0 12px;
      }
      .ttg-identify p { margin: 0 0 10px; font-size: 13px; color: #374151; }
      .ttg-identify input {
        width: 100%; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 10px;
        font-size: 13px; margin-bottom: 8px; outline: none; color: #111827; background: #fff;
      }
      .ttg-identify input:focus { border-color: ${c}; }
      .ttg-identify-actions { display: flex; gap: 8px; }
      .ttg-identify button {
        border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
      }
      .ttg-identify .ttg-id-save { background: ${c}; color: #fff; }
      .ttg-identify .ttg-id-skip { background: #f3f4f6; color: #6b7280; }
    `;
  }

  private toggle(): void {
    this.open = !this.open;
    this.panelEl.hidden = !this.open;
    this.launcherEl.classList.toggle("open", this.open);
    if (this.open) {
      this.unread = 0;
      this.updateBadge();
      this.scrollToBottom();
      this.inputEl.focus();
    }
  }

  private updateBadge(): void {
    if (this.unread > 0) {
      this.badgeEl.hidden = false;
      this.badgeEl.textContent = String(this.unread);
    } else {
      this.badgeEl.hidden = true;
    }
  }

  private appendMessage(m: ChatMessage): void {
    this.messages.push(m);
    this.renderMessage(m);
    this.scrollToBottom();
  }

  private renderMessage(m: ChatMessage): void {
    const div = document.createElement("div");
    div.className = `ttg-msg ${m.sender_type}`;
    div.innerHTML = `<div class="ttg-bubble">${escapeHtml(m.body)}<span class="ttg-time">${formatTime(m.created_at)}</span></div>`;
    this.messagesEl.appendChild(div);
  }

  private showIdentifyCard(): void {
    if (this.messagesEl.querySelector(".ttg-identify")) return;
    const card = document.createElement("div");
    card.className = "ttg-identify";
    card.innerHTML = `
      <p>Leave your details so we can reach you if you step away:</p>
      <input type="text" class="ttg-id-name" placeholder="Your name (optional)" />
      <input type="email" class="ttg-id-email" placeholder="Email address" />
      <div class="ttg-identify-actions">
        <button class="ttg-id-save">Save</button>
        <button class="ttg-id-skip">No thanks</button>
      </div>`;
    card.querySelector(".ttg-id-save")!.addEventListener("click", () => {
      const name = card.querySelector<HTMLInputElement>(".ttg-id-name")!.value.trim();
      const email = card.querySelector<HTMLInputElement>(".ttg-id-email")!.value.trim();
      this.submitIdentify(name, email);
      card.remove();
    });
    card.querySelector(".ttg-id-skip")!.addEventListener("click", () => {
      this.identifyDismissed = true;
      card.remove();
    });
    this.messagesEl.appendChild(card);
    this.scrollToBottom();
  }

  private showTyping(): void {
    this.typingEl.hidden = false;
    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.typingTimeout = window.setTimeout(() => this.hideTyping(), 4000);
  }

  private hideTyping(): void {
    this.typingEl.hidden = true;
  }

  private autosize(): void {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 110)}px`;
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }
}
