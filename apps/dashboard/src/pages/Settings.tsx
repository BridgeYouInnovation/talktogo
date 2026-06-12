import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase, APP_URL } from "../lib/supabase";
import { DEFAULT_WIDGET_SETTINGS, type WidgetSettings } from "../lib/types";
import WidgetPreview from "../components/WidgetPreview";
import type { SiteContext } from "./SiteLayout";

export default function Settings() {
  const { site, setSite } = useOutletContext<SiteContext>();
  const [settings, setSettings] = useState<WidgetSettings>({
    ...DEFAULT_WIDGET_SETTINGS,
    ...site.widget_settings,
  });
  const [name, setName] = useState(site.name);
  const [domain, setDomain] = useState(site.domain ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const set = <K extends keyof WidgetSettings>(key: K, value: WidgetSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    setError(null);
    const { data, error } = await supabase
      .from("sites")
      .update({ widget_settings: settings, name: name.trim(), domain: domain.trim() || null })
      .eq("id", site.id)
      .select()
      .single();
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSite(data as typeof site);
    setSaved(true);
  }

  const snippet = `<script src="${APP_URL}/widget.js" data-site-id="${site.id}" async></script>`;

  function copy(text: string, which: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Widget settings</h1>
          <p>Customize how the chat widget looks on {site.name}, then grab your install code.</p>
        </div>
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save changes"}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}

      <div className="settings-layout">
        <div>
          <section className="card settings-section">
            <h2>Website</h2>
            <div className="row-2">
              <div className="field">
                <label>Name</label>
                <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
              </div>
              <div className="field">
                <label>Domain</label>
                <input
                  value={domain}
                  placeholder="mystore.com"
                  onChange={(e) => { setDomain(e.target.value); setSaved(false); }}
                />
              </div>
            </div>
          </section>

          <section className="card settings-section">
            <h2>Appearance</h2>
            <div className="row-2">
              <div className="field">
                <label>Brand color</label>
                <div className="color-row">
                  <input
                    type="color"
                    value={settings.primaryColor}
                    onChange={(e) => set("primaryColor", e.target.value)}
                  />
                  <input
                    value={settings.primaryColor}
                    onChange={(e) => set("primaryColor", e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label>Position</label>
                <select
                  value={settings.position}
                  onChange={(e) => set("position", e.target.value as WidgetSettings["position"])}
                >
                  <option value="right">Bottom right</option>
                  <option value="left">Bottom left</option>
                </select>
              </div>
            </div>
            <div className="row-2">
              <div className="field">
                <label>Launcher icon</label>
                <select
                  value={settings.launcherIcon}
                  onChange={(e) => set("launcherIcon", e.target.value as WidgetSettings["launcherIcon"])}
                >
                  <option value="chat">Chat bubble</option>
                  <option value="message">Envelope</option>
                  <option value="help">Question mark</option>
                </select>
              </div>
              <div className="field">
                <label>Agent display name</label>
                <input
                  value={settings.agentName}
                  onChange={(e) => set("agentName", e.target.value)}
                />
              </div>
            </div>
            <div className="checkbox-row">
              <input
                type="checkbox"
                id="branding"
                checked={settings.showBranding}
                onChange={(e) => set("showBranding", e.target.checked)}
              />
              <label htmlFor="branding">Show “Powered by TalkToGo” branding</label>
            </div>
          </section>

          <section className="card settings-section">
            <h2>Texts</h2>
            <div className="row-2">
              <div className="field">
                <label>Header title</label>
                <input value={settings.title} onChange={(e) => set("title", e.target.value)} />
              </div>
              <div className="field">
                <label>Header subtitle</label>
                <input value={settings.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>Welcome message</label>
              <textarea
                rows={2}
                value={settings.welcomeMessage}
                onChange={(e) => set("welcomeMessage", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Offline message</label>
              <textarea
                rows={2}
                value={settings.offlineMessage}
                onChange={(e) => set("offlineMessage", e.target.value)}
              />
            </div>
          </section>

          <section className="card settings-section">
            <h2>Install on any website</h2>
            <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
              Paste this snippet just before the closing <code>&lt;/head&gt;</code> tag of your
              website. The widget loads asynchronously and won’t slow your site down.
            </p>
            <div className="code-block">
              {snippet}
              <button className="copy-btn" onClick={() => copy(snippet, "snippet")}>
                {copied === "snippet" ? "Copied!" : "Copy"}
              </button>
            </div>
          </section>

          <section className="card settings-section">
            <h2>Install on WordPress</h2>
            <ol style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, paddingLeft: 20 }}>
              <li>
                <a href={`${APP_URL}/talktogo-wordpress-plugin.zip`} download>
                  Download the TalkToGo plugin zip
                </a>
                .
              </li>
              <li>In WordPress admin go to <b>Plugins → Add New → Upload Plugin</b> and upload it.</li>
              <li>Activate the plugin, then open <b>Settings → TalkToGo</b>.</li>
              <li>Paste your <b>Site ID</b> and <b>Widget URL</b> below and save.</li>
            </ol>
            <div className="field">
              <label>Site ID</label>
              <div className="code-block">
                {site.id}
                <button className="copy-btn" onClick={() => copy(site.id, "siteid")}>
                  {copied === "siteid" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
            <div className="field">
              <label>Widget URL</label>
              <div className="code-block">
                {`${APP_URL}/widget.js`}
                <button className="copy-btn" onClick={() => copy(`${APP_URL}/widget.js`, "wurl")}>
                  {copied === "wurl" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </section>
        </div>

        <div style={{ position: "sticky", top: 80 }}>
          <WidgetPreview settings={settings} />
          <p className="toolbar-note" style={{ marginTop: 10 }}>
            The preview updates as you type. Click <b>Save changes</b> to publish — live widgets
            pick up the new settings on the next page load.
          </p>
        </div>
      </div>
    </main>
  );
}
