// TalkToGo — Web Push sender.
// Invoked by Supabase Database Webhooks on INSERTs into `messages` and
// `visitors`. Looks up the site owner's push subscriptions and delivers
// a Web Push notification to every registered browser/device.
//
// Required secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@talktogo.app",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: Record<string, unknown>;
}

Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as WebhookPayload;
    if (payload.type !== "INSERT") {
      return Response.json({ skipped: "not an insert" });
    }

    const record = payload.record;
    const siteId = record.site_id as string;
    if (!siteId) return Response.json({ skipped: "no site_id" });

    let notification: { title: string; body: string; url: string } | null = null;

    const { data: site } = await supabase
      .from("sites")
      .select("id, name, owner_id")
      .eq("id", siteId)
      .single();
    if (!site) return Response.json({ skipped: "site not found" });

    if (payload.table === "messages") {
      if (record.sender_type !== "visitor") {
        return Response.json({ skipped: "agent message" });
      }
      const { data: conv } = await supabase
        .from("conversations")
        .select("id, visitor_id, visitors(name, country)")
        .eq("id", record.conversation_id as string)
        .single();
      const visitor = (conv as any)?.visitors;
      const who = visitor?.name || "A visitor";
      const where = visitor?.country ? ` (${visitor.country})` : "";
      notification = {
        title: `💬 ${who}${where} — ${site.name}`,
        body: String(record.body ?? "").slice(0, 180),
        url: `/sites/${siteId}/inbox?c=${record.conversation_id}`,
      };
    } else if (payload.table === "visitors") {
      const country = record.country ? ` from ${record.country}` : "";
      const page = record.current_page ? `\nOn: ${record.current_page}` : "";
      notification = {
        title: `👋 New visitor${country} — ${site.name}`,
        body: `A new visitor just landed on your website.${page}`,
        url: `/sites/${siteId}/visitors`,
      };
    } else {
      return Response.json({ skipped: `table ${payload.table}` });
    }

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, subscription")
      .eq("user_id", site.owner_id);

    if (!subs?.length) return Response.json({ sent: 0 });

    let sent = 0;
    await Promise.all(
      subs.map(async (row) => {
        try {
          await webpush.sendNotification(
            row.subscription as any,
            JSON.stringify(notification),
          );
          sent++;
        } catch (err: any) {
          // 404/410 mean the subscription is dead — clean it up.
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", row.id);
          }
        }
      }),
    );

    return Response.json({ sent });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
