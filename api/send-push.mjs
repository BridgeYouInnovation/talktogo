// TalkToGo — Web Push sender (Vercel serverless function).
//
// Called by:
//  - the embedded widget when a new visitor lands or sends a chat message
//    (authenticated by the visitor's secret visitor_key, validated against
//    the database, with freshness checks to prevent replay spam)
//  - the dashboard ("test" type, authenticated by the agent's Supabase JWT)
//
// Env: SUPABASE_SERVICE_ROLE_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// (SUPABASE_URL and the VAPID public key fall back to the VITE_* vars.)

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@talktogo.app";

const configured = Boolean(SUPABASE_URL && SERVICE_KEY && VAPID_PUBLIC && VAPID_PRIVATE);
if (configured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

const supabase = configured ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (!configured) return res.status(503).json({ error: "push not configured" });

  try {
    const body = typeof req.body === "object" && req.body ? req.body : {};
    const type = body.type;

    let ownerId = null;
    let notification = null;

    if (type === "test") {
      const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return res.status(401).json({ error: "missing token" });
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) return res.status(401).json({ error: "invalid token" });
      ownerId = data.user.id;
      notification = {
        title: "🔔 TalkToGo notifications are working!",
        body: "You will be alerted here when a new visitor arrives or a chat message comes in.",
        url: "/",
      };
    } else if (type === "new_visitor" || type === "new_message") {
      const siteId = String(body.site_id || "");
      const visitorKey = String(body.visitor_key || "");
      if (!/^[0-9a-f-]{36}$/i.test(siteId) || visitorKey.length < 16) {
        return res.status(400).json({ error: "bad request" });
      }

      const { data: visitor } = await supabase
        .from("visitors")
        .select("id, name, country, current_page, current_page_title, first_seen_at")
        .eq("site_id", siteId)
        .eq("visitor_key", visitorKey)
        .single();
      if (!visitor) return res.status(404).json({ error: "unknown visitor" });

      const { data: site } = await supabase
        .from("sites")
        .select("id, name, owner_id")
        .eq("id", siteId)
        .single();
      if (!site) return res.status(404).json({ error: "unknown site" });
      ownerId = site.owner_id;

      if (type === "new_visitor") {
        // Only push for genuinely fresh visitors (anti-replay).
        if (Date.now() - new Date(visitor.first_seen_at).getTime() > 2 * 60 * 1000) {
          return res.status(200).json({ sent: 0, skipped: "not a new visitor" });
        }
        const where = visitor.country ? ` from ${visitor.country}` : "";
        notification = {
          title: `👋 New visitor${where} — ${site.name}`,
          body: visitor.current_page_title || visitor.current_page
            ? `Browsing: ${visitor.current_page_title || visitor.current_page}`
            : "Someone just landed on your website.",
          url: `/sites/${site.id}/visitors`,
        };
      } else {
        const { data: conv } = await supabase
          .from("conversations")
          .select("id, last_message_at, last_message_preview")
          .eq("site_id", siteId)
          .eq("visitor_id", visitor.id)
          .single();
        if (!conv) return res.status(404).json({ error: "no conversation" });
        // Only push right after a message was actually stored (anti-replay).
        if (Date.now() - new Date(conv.last_message_at).getTime() > 60 * 1000) {
          return res.status(200).json({ sent: 0, skipped: "no recent message" });
        }
        const who = visitor.name || "Visitor";
        const where = visitor.country ? ` (${visitor.country})` : "";
        notification = {
          title: `💬 ${who}${where} — ${site.name}`,
          body: String(conv.last_message_preview || "New chat message").slice(0, 180),
          url: `/sites/${site.id}/inbox?c=${conv.id}`,
        };
      }
    } else {
      return res.status(400).json({ error: "unknown type" });
    }

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, subscription")
      .eq("user_id", ownerId);

    if (!subs?.length) return res.status(200).json({ sent: 0, reason: "no subscriptions" });

    let sent = 0;
    await Promise.all(
      subs.map(async (row) => {
        try {
          await webpush.sendNotification(row.subscription, JSON.stringify(notification), {
            TTL: 120,
            urgency: "high",
          });
          sent++;
        } catch (err) {
          // 404/410 = subscription expired or revoked — clean it up.
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", row.id);
          }
        }
      })
    );

    return res.status(200).json({ sent });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
