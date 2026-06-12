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
    const { data } = await supabase
      .from("visitors")
      .select("*")
      .eq("site_id", site.id)
      .order("online", { ascending: false })
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

  const online = visitors.filter((v) => v.online);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Visitors</h1>
          <p>
            <b style={{ color: "var(--green)" }}>{online.length} online now</b> · {visitors.length}{" "}
            recent visitors. Updates live as people browse your site.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="center-screen" style={{ height: 200 }}>
          <div className="spinner" />
        </div>
      ) : visitors.length === 0 ? (
        <div className="empty-state">
          <h2>No visitors yet</h2>
          <p>
            Install the widget on your website (see the Settings tab) and visitors will show up
            here the moment they land on a page.
          </p>
        </div>
      ) : (
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
      )}
    </main>
  );
}
