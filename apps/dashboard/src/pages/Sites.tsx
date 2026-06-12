import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";
import { useInstallPrompt } from "../lib/useInstallPrompt";
import type { Site } from "../lib/types";

export default function Sites() {
  const { session } = useAuth();
  const { showInstall, install } = useInstallPrompt();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("sites")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setSites((data as Site[]) ?? []);
        setLoading(false);
      });
  }, []);

  async function createSite(e: FormEvent) {
    e.preventDefault();
    if (!session) return;
    setCreating(true);
    setError(null);
    const { data, error } = await supabase
      .from("sites")
      .insert({ owner_id: session.user.id, name: name.trim(), domain: domain.trim() || null })
      .select()
      .single();
    setCreating(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSites((prev) => [data as Site, ...prev]);
    setShowForm(false);
    setName("");
    setDomain("");
  }

  return (
    <>
      <header className="topbar">
        <span className="brand">
          <span className="logo-dot">💬</span> TalkToGo
        </span>
        <div className="grow" />
        {showInstall && (
          <button className="btn secondary" onClick={install} title="Install TalkToGo as an app">
            ⬇️ Install app
          </button>
        )}
        <button className="btn secondary" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>

      <main className="page">
        <div className="page-head">
          <div>
            <h1>Your websites</h1>
            <p>Each website gets its own chat widget, inbox and visitor feed.</p>
          </div>
          <button className="btn" onClick={() => setShowForm((v) => !v)}>
            + Add website
          </button>
        </div>

        {showForm && (
          <form className="card" style={{ marginBottom: 20 }} onSubmit={createSite}>
            <div className="row-2">
              <div className="field">
                <label>Website name</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Store"
                />
              </div>
              <div className="field">
                <label>Domain (optional)</label>
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="mystore.com"
                />
              </div>
            </div>
            <button className="btn" disabled={creating}>
              {creating ? "Creating…" : "Create website"}
            </button>
            {error && <p className="error-text">{error}</p>}
          </form>
        )}

        {loading ? (
          <div className="center-screen" style={{ height: 200 }}>
            <div className="spinner" />
          </div>
        ) : sites.length === 0 ? (
          <div className="empty-state">
            <h2>No websites yet</h2>
            <p>Add your first website to get your chat widget embed code and WordPress plugin setup.</p>
          </div>
        ) : (
          <div className="sites-grid">
            {sites.map((site) => (
              <Link key={site.id} to={`/sites/${site.id}/inbox`} className="site-card">
                <h3>{site.name}</h3>
                <div className="domain">{site.domain || "No domain set"}</div>
                <div className="meta">Created {new Date(site.created_at).toLocaleDateString()}</div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
