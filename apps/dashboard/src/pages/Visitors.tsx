import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { countryFlag, timeAgo, visitorLabel, type Visitor } from "../lib/types";
import type { SiteContext } from "./SiteLayout";

export default function Visitors() {
  const { site, visitorsSignal } = useOutletContext<SiteContext>();
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchVisitors = useCallback(async () => {
    // Opportunistically flip stale visitors offline, then fetch.
    await supabase.rpc("sweep_offline_visitors");

    // Delete visitors that went offline more than 5 minutes ago, unless
    // they have chat history (deleting those would erase inbox threads).
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stale } = await supabase
      .from("visitors")
      .select("id, conversations(last_message_preview)")
      .eq("site_id", site.id)
      .eq("online", false)
      .lt("last_seen_at", cutoff);
    const deletable = ((stale as { id: string; conversations: { last_message_preview: string | null }[] }[]) ?? [])
      .filter((v) => (v.conversations ?? []).every((c) => !c.last_message_preview))
      .map((v) => v.id);
    if (deletable.length > 0) {
      await supabase.from("visitors").delete().in("id", deletable);
    }

    const { data } = await supabase
      .from("visitors")
      .select("*")
      .eq("site_id", site.id)
      .eq("online", true)
      .order("last_seen_at", { ascending: false })
      .limit(200);
    setVisitors((data as Visitor[]) ?? []);
    setLoading(false);
  }, [site.id]);

  // Refetch on realtime events and on a slow safety interval.
  useEffect(() => {
    fetchVisitors();
    const interval = window.setInterval(fetchVisitors, 30_000);
    return () => window.clearInterval(interval);
  }, [fetchVisitors, visitorsSignal]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Visitors</h1>
          <p>
            <b style={{ color: "var(--green)" }}>{visitors.length} online now</b> · updates live as
            people browse your site.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="center-screen" style={{ height: 200 }}>
          <div className="spinner" />
        </div>
      ) : visitors.length === 0 ? (
        <div className="empty-state">
          <h2>No visitors online right now</h2>
          <p>
            The moment someone lands on your website they will show up here, with their country
            and the page they are viewing.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
        <table className="visitor-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Visitor</th>
              <th>Location</th>
              <th>Current page</th>
              <th>Device</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {visitors.map((v) => (
              <tr key={v.id}>
                <td>
                  <span className={`status-chip ${v.online ? "" : "off"}`}>
                    <span className="dot" /> {v.online ? "Online" : "Offline"}
                  </span>
                </td>
                <td>{visitorLabel(v)}</td>
                <td>
                  <span className="flag">{countryFlag(v.country_code)}</span>
                  {v.country ?? "Unknown"}
                  {v.city ? `, ${v.city}` : ""}
                </td>
                <td className="page-cell" title={v.current_page ?? undefined}>
                  {v.current_page_title || v.current_page || "—"}
                </td>
                <td>
                  {[v.browser, v.os].filter(Boolean).join(" · ") || "—"}
                </td>
                <td>{timeAgo(v.last_seen_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </main>
  );
}
