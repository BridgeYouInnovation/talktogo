import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  ensureNotificationPermission,
  notifyLocal,
  sendTestPush,
  subscribeToPush,
} from "../lib/notifications";
import { useAuth } from "../lib/useAuth";
import { useInstallPrompt } from "../lib/useInstallPrompt";
import type { Site } from "../lib/types";

export interface SiteContext {
  site: Site;
  setSite: (s: Site) => void;
  // Bumped whenever a realtime event arrives, so child pages refetch.
  visitorsSignal: number;
  messagesSignal: number;
}

export default function SiteLayout() {
  const { siteId } = useParams<{ siteId: string }>();
  const { session } = useAuth();
  const [site, setSite] = useState<Site | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [visitorsSignal, setVisitorsSignal] = useState(0);
  const [messagesSignal, setMessagesSignal] = useState(0);
  const [notifState, setNotifState] = useState<"unknown" | "granted" | "needed" | "denied">("unknown");
  const { showInstall, install } = useInstallPrompt();
  const seenVisitors = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!siteId) return;
    supabase
      .from("sites")
      .select("*")
      .eq("id", siteId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) setNotFound(true);
        else setSite(data as Site);
      });
  }, [siteId]);

  useEffect(() => {
    if (!("Notification" in window)) {
      setNotifState("denied");
      return;
    }
    setNotifState(
      Notification.permission === "granted"
        ? "granted"
        : Notification.permission === "denied"
          ? "denied"
          : "needed"
    );
  }, []);

  // Site-wide realtime: visitor presence + new messages from the widget.
  useEffect(() => {
    if (!siteId || !site) return;

    const channel = supabase
      .channel(`site:${siteId}`)
      .on("broadcast", { event: "presence" }, ({ payload }) => {
        setVisitorsSignal((n) => n + 1);
        const type = payload?.type;
        const vid = payload?.visitor_id as string | undefined;
        if (type === "enter" && vid && !seenVisitors.current.has(vid)) {
          seenVisitors.current.add(vid);
          notifyLocal(
            `👋 New visitor — ${site.name}`,
            `A new visitor just landed on ${payload?.title || payload?.url || "your website"}`,
            `/sites/${siteId}/visitors`
          );
        }
      })
      .on("broadcast", { event: "new_message" }, ({ payload }) => {
        setMessagesSignal((n) => n + 1);
        notifyLocal(
          `💬 New message — ${site.name}`,
          String(payload?.body ?? "New chat message"),
          `/sites/${siteId}/inbox?c=${payload?.conversation_id ?? ""}`
        );
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [siteId, site?.id]);

  const enableNotifications = useCallback(async () => {
    const granted = await ensureNotificationPermission();
    if (!granted) {
      setNotifState("denied");
      return;
    }
    setNotifState("granted");
    if (session) {
      const result = await subscribeToPush(session.user.id);
      if (result === "ok") {
        // Real round-trip through the push service so the user sees it work.
        const pushed = await sendTestPush();
        if (!pushed) {
          notifyLocal(
            "🔔 Notifications enabled",
            "You'll be alerted when a new visitor arrives or a chat comes in.",
            "/"
          );
        }
      } else if (result === "no-vapid") {
        console.info(
          "[TalkToGo] VITE_VAPID_PUBLIC_KEY not set — background push disabled, in-app notifications still work."
        );
      }
    }
  }, [session]);

  // Re-register push silently when permission is already granted.
  useEffect(() => {
    if (notifState === "granted" && session) {
      subscribeToPush(session.user.id);
    }
  }, [notifState, session?.user.id]);

  if (notFound) {
    return (
      <div className="center-screen">
        <h2>Site not found</h2>
        <Link to="/">← Back to your websites</Link>
      </div>
    );
  }

  if (!site) {
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    );
  }

  const ctx: SiteContext = { site, setSite, visitorsSignal, messagesSignal };

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="logo-dot">💬</span> TalkToGo
        </Link>
        <span className="site-name">/ {site.name}</span>
        <nav className="tabs">
          <NavLink to={`/sites/${site.id}/inbox`}>Inbox</NavLink>
          <NavLink to={`/sites/${site.id}/visitors`}>Visitors</NavLink>
          <NavLink to={`/sites/${site.id}/settings`}>Settings</NavLink>
        </nav>
        <div className="grow" />
        {notifState === "needed" && (
          <button className="btn secondary" onClick={enableNotifications}>
            🔔 Enable notifications
          </button>
        )}
        {showInstall && (
          <button className="btn secondary" onClick={install} title="Install TalkToGo as an app">
            ⬇️ Install app
          </button>
        )}
        <button className="btn secondary" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>
      <Outlet context={ctx} />
    </>
  );
}
