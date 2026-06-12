import type { WidgetSettings } from "../lib/types";

const LAUNCHER_ICONS: Record<string, string> = {
  chat: "💬",
  message: "✉️",
  help: "❓",
};

// Visual mock of the embedded widget, rendered with the live settings so
// changes are reflected immediately while editing.
export default function WidgetPreview({ settings }: { settings: WidgetSettings }) {
  const c = settings.primaryColor;
  const side = settings.position === "left" ? "left" : "right";

  return (
    <div className="preview-stage">
      <span className="preview-note">Live preview</span>

      <div
        style={{
          position: "absolute",
          bottom: 90,
          [side]: 16,
          width: 320,
          height: 420,
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 12px 48px rgba(0,0,0,.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: `linear-gradient(135deg, ${c}, ${c}dd)`,
            color: "#fff",
            padding: "16px 14px",
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "rgba(255,255,255,.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
            }}
          >
            {(settings.agentName || "S").charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{settings.title}</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>{settings.subtitle}</div>
          </div>
        </div>

        <div style={{ flex: 1, background: "#f8fafc", padding: 12 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              borderBottomLeftRadius: 4,
              padding: "9px 12px",
              fontSize: 13,
              maxWidth: "80%",
              color: "#111827",
            }}
          >
            {settings.welcomeMessage}
          </div>
          <div
            style={{
              background: c,
              color: "#fff",
              borderRadius: 14,
              borderBottomRightRadius: 4,
              padding: "9px 12px",
              fontSize: 13,
              maxWidth: "80%",
              marginLeft: "auto",
              marginTop: 10,
            }}
          >
            Hi! I have a question 🙂
          </div>
        </div>

        <div
          style={{
            borderTop: "1px solid #e5e7eb",
            padding: "10px 12px",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span style={{ flex: 1, fontSize: 13, color: "#9ca3af" }}>Type your message…</span>
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: c,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
            }}
          >
            ➤
          </span>
        </div>
        {settings.showBranding && (
          <div style={{ textAlign: "center", fontSize: 10.5, color: "#9ca3af", paddingBottom: 6 }}>
            Powered by <b style={{ color: "#6b7280" }}>TalkToGo</b>
          </div>
        )}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 16,
          [side]: 16,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: c,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          boxShadow: "0 6px 24px rgba(0,0,0,.22)",
        }}
      >
        {LAUNCHER_ICONS[settings.launcherIcon] ?? "💬"}
      </div>
    </div>
  );
}
