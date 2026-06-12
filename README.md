# TalkToGo 💬

A self-hosted livechat platform — like Tidio, but yours. Add a chat widget to **any website** (one script tag) or **WordPress site** (plugin included), then see your visitors live and chat with them from the TalkToGo dashboard.

## Features

- **Embeddable chat widget** — one async `<script>` tag, isolated in shadow DOM, mobile friendly
- **WordPress plugin** — upload, paste your Site ID, done
- **Realtime inbox** — see and reply to visitor messages instantly, with typing indicators
- **Live visitor tracking** — get notified the moment someone lands on your site; see their country 🇺🇸, city, browser/OS, and the page they're on — updated live on every page change (SPA navigations included)
- **Push notifications** — Web Push tells you about new visitors and messages even when the app is closed
- **Per-site widget customization** — colors, position, texts, launcher icon, branding — with a live preview
- **Installable PWA** — install the dashboard as a desktop or phone app
- **Multi-site** — manage any number of websites from one account
- Deploys to **Netlify** and **Vercel**; backend runs on **Supabase** (free tier works)

## Project layout

```
apps/dashboard/     React PWA — the agent dashboard (inbox, visitors, settings)
apps/widget/        The embeddable widget, built to a single widget.js
wordpress-plugin/   WordPress plugin (zip the talktogo/ folder to install)
supabase/           Database schema (migrations/) + send-push edge function
scripts/            Icon generator and build helpers
```

## Setup

### 1. Create the Supabase project (~5 minutes)

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Open the **SQL Editor**, paste the contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and run it.
3. In **Project Settings → API**, copy the **Project URL** and **anon public key**.
4. (Recommended) In **Authentication → Providers → Email**, disable "Confirm email" for instant signups, or configure SMTP.

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `VITE_VAPID_PUBLIC_KEY` | From `npx web-push generate-vapid-keys` (optional, for background push) |
| `VITE_APP_URL` | The URL where you deploy the app (used in the embed snippet) |

### 3. Run locally

```bash
npm install
npm run dev          # dashboard at http://localhost:5173
```

### 4. Deploy to Netlify or Vercel

Push this repo to GitHub, then import it in Netlify or Vercel — both configs are committed (`netlify.toml`, `vercel.json`). Set the four `VITE_*` environment variables in the site settings. The build outputs the dashboard **and** `widget.js` on the same domain.

You can deploy to both at once; they build from the same repo.

### 5. Background push notifications (optional but nice)

In-app notifications work out of the box once you click **🔔 Enable notifications** in the dashboard. For push that works **while the app is closed**:

1. Generate VAPID keys: `npx web-push generate-vapid-keys`
2. Set `VITE_VAPID_PUBLIC_KEY` in Netlify/Vercel env vars (and `.env`).
3. Deploy the edge function:
   ```bash
   npx supabase functions deploy send-push --project-ref YOUR_PROJECT_REF
   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com --project-ref YOUR_PROJECT_REF
   ```
4. In Supabase **Database → Webhooks**, create two webhooks that call the `send-push` edge function:
   - table `messages`, event `INSERT`
   - table `visitors`, event `INSERT`

### 6. Install the widget on a website

In the dashboard: **your site → Settings → Install**. You'll get a snippet like:

```html
<script src="https://your-app.netlify.app/widget.js" data-site-id="YOUR-SITE-ID" async></script>
```

Paste it before `</head>` on any website.

### 7. Install on WordPress

1. Zip the plugin: `cd wordpress-plugin && zip -r talktogo.zip talktogo`
   (a prebuilt `talktogo.zip` is created by `npm run build` too)
2. WordPress admin → **Plugins → Add New → Upload Plugin** → upload the zip → activate.
3. **Settings → TalkToGo** → paste the **Site ID** and **Widget URL** from your dashboard.

### 8. Install the dashboard as an app

Open your deployed dashboard in Chrome/Edge (desktop or Android) and use **Install app** from the address bar / browser menu, or **Add to Home Screen** in Safari on iOS. The app runs in its own window and receives push notifications.

## How it works

- The **widget** authenticates visitors with an unguessable random key stored in `localStorage`, and talks to Postgres only through locked-down `SECURITY DEFINER` RPCs — anonymous clients have zero direct table access.
- **Realtime** uses Supabase Broadcast channels: `conv:{conversationId}` for chat messages and typing, `site:{siteId}` for visitor presence and page-change events.
- **Visitor geo** is resolved client-side (ipapi.co with ipwho.is fallback) and cached per visitor.
- **Presence** combines heartbeats (30 s), `pagehide` beacons, and a sweep that marks visitors offline after 2 minutes of silence.
- The dashboard is a **PWA**: `manifest.webmanifest` + a service worker that handles offline shell caching, push events, and notification clicks.
