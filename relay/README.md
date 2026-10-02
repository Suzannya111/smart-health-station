# Smart Care — Wound AI Relay

Roboflow's firewall is currently blocking the user's network **and** Cloudflare
Workers, so the app's wound-detection call fails. This relay sits on a
non-Cloudflare host (Render or Vercel) and forwards the request to Roboflow's
hosted inference.

## What it does

It accepts the **exact same request the app already sends**:

```
POST /{modelId}/{version}?api_key=...
Content-Type: application/x-www-form-urlencoded
Body: <base64 image>
```

and forwards it to:

```
https://serverless.roboflow.com/{modelId}/{version}?api_key=...
```

Key behaviours:

- Upstream base is overridable with the env var `ROBOFLOW_BASE`
  (default `https://serverless.roboflow.com`).
- Sends a normal browser-like `User-Agent` (Cloudflare Workers' missing UA
  contributed to the block).
- Returns the upstream status, body, and content-type.
- Adds `Access-Control-Allow-Origin: *` and handles CORS preflight (`OPTIONS` → 204).
- Does **not** forward the browser `Origin` / `Referer` to Roboflow.

---

## Gemini vision proxy (`POST /gemini-generate`)

Google Gemini is geo-blocked in the user's region. This relay re-issues the
vision request from its own (US) egress so the static GitHub Pages app can run
inference, and it keeps `GEMINI_API_KEY` **server-side** — the browser never
sees it.

**Endpoint**

```
POST /gemini-generate?model=<modelName>
Content-Type: application/json
Body: <Gemini generateContent JSON, sent verbatim>
```

Request body example (exactly the Gemini shape, forwarded unchanged):

```json
{
  "contents": [
    {
      "parts": [
        { "text": "..." },
        { "inline_data": { "mime_type": "image/jpeg", "data": "..." } }
      ]
    }
  ],
  "generationConfig": { "temperature": 0.2 }
}
```

The relay forwards it to:

```
https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=...
```

and returns **Gemini's status code and JSON body unchanged**, so the client can
keep reading `candidates[0].content.parts[0].text`.

| Behaviour | Detail |
| --- | --- |
| Model resolution | `?model=` query param → `GEMINI_MODEL` env → default `gemini-3.8-flash` (URL-encoded) |
| `GEMINI_API_KEY` missing | `500` `{ "error": "server_misconfigured", "message": "GEMINI_API_KEY is not set" }` — upstream is **not** called |
| Upstream slower than ~45 s | `504` `{ "error": "upstream_timeout" }` |
| Other upstream failure | `502` `{ "error": "relay_error" }` |
| CORS | `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`; `OPTIONS` → `204` |

On **Vercel** the same endpoint lives under the catch-all, i.e.
`POST /api/gemini-generate?model=...`.

**Environment variables**

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | yes | — | Gemini key from Google AI Studio (server-side only) |
| `GEMINI_MODEL` | no | `gemini-3.8-flash` | Default model used when `?model=` is omitted |
| `ROBOFLOW_BASE` | no | `https://serverless.roboflow.com` | Roboflow passthrough upstream |

> The API key is never logged, echoed, or included in any response — including
> error responses — and never appears in a URL returned to the client.

---

## Deploy to Render (recommended)

The repo ships a Render Blueprint ([`render.yaml`](../render.yaml)) that deploys
the relay in a **US region** with one click — no CLI.

1. Fork this repository (or point Render at the existing repo) so Render can
   read `render.yaml`.
2. Go to <https://render.com> and sign in.
3. Click **New → Blueprint**.
4. Select the repository that contains this project. Render reads `render.yaml`
   automatically and proposes the `smart-care-wound-relay` web service (root dir
   `relay/render`, build `npm install`, start `npm start`, free plan, region
   `oregon`).
5. When prompted, set **`GEMINI_API_KEY`** to a key from
   [Google AI Studio](https://aistudio.google.com/app/apikey). The blueprint uses
   `sync: false`, so the value is **never** stored in the repo — it lives only in
   Render's dashboard.
6. Click **Deploy** and wait for the build to finish.
7. Copy the service URL, e.g. `https://smart-care-wound-relay.onrender.com`.

`GEMINI_MODEL` is preset to `gemini-3.8-flash`. If Google renames or retires a
model, change `GEMINI_MODEL` in **Render → your service → Environment** (or pass
`?model=` per request) and restart — no code change is needed.

> **Cold start:** the Render free tier sleeps after inactivity. The **first**
> request after idle can take **30–60 s**. The Gemini proxy aborts upstream after
> ~45 s, so a cold request may return `upstream_timeout`; once the instance is
> warm, simply retry.

### Connect the app

After the deploy finishes, open the web app → **Settings → Advanced →
傷口辨識 Relay 網址**, paste the Render service URL (bare origin, **no trailing
slash** — e.g. `https://smart-care-wound-relay.onrender.com`), then click
**Save**. With the relay URL set, the client routes Gemini vision calls through
the relay, so no Gemini API key is needed in the browser.

> **Free-tier cold start:** the first request after the service has been idle may
> take **~30–60 s** to spin up. Let it finish, then retry once the instance is
> warm.

---

## Option A — Deploy on Render (recommended, no CLI)

1. Put this project in a GitHub repository (or use the existing repo that
   already contains this folder).
2. Go to <https://render.com> and sign in.
3. Click **New → Web Service**.
4. Connect the GitHub repository that contains this project.
5. Set **Root Directory** to `relay/render`.
6. Set **Build Command** to `npm install`.
7. Set **Start Command** to `npm start`.
8. Choose any instance type (the free tier is fine) and click **Create Web Service**.
9. Wait for the deploy to finish, then copy the public URL, e.g.
   `https://smart-care-wound-relay.onrender.com`.

> **Note:** the Render free tier sleeps after inactivity. The **first** request
> after sleeping can take **30–60 seconds** (cold start). The app's fetch timeout
> has been raised to 30 s to tolerate this; if it still times out, simply retry.

---

## Option B — Deploy on Vercel (no CLI)

1. Go to <https://vercel.com> and sign in.
2. Click **Add New → Project** and import the GitHub repository that contains this project.
3. Set **Root Directory** to `relay/vercel`.
4. Leave the build settings on their defaults (no build step; the function uses
   CommonJS so no `package.json` is needed).
5. Click **Deploy**, then copy the public URL, e.g.
   `https://smart-care-wound-relay.vercel.app`. **When entering this in the app,
   append `/api`** (see below) — the relay function is only reachable under
   `/api/*`.

---

## Connect the relay to the app

1. Open the Smart Care app.
2. Go to **Settings → Advanced**.
3. Find the **傷口辨識 API 網址** field.
4. Paste the relay URL **with no trailing slash**, using the form that matches
   where you deployed it:
   - **Render (Option A):** the bare origin, e.g.
     `https://smart-care-wound-relay.onrender.com`
   - **Vercel (Option B):** the origin **plus `/api`**, e.g.
     `https://smart-care-wound-relay.vercel.app/api`
5. Click **Save**.
6. Retest the wound-detection feature.

> The app now also auto-retries the `/api` variant when the first attempt returns
> `404`/`405`, but entering the correct form above is still recommended.

Leave **Model ID** `wound-object-detection`, **Version** `1`, and the **API key**
unchanged — the relay expects them exactly as the app already sends them.

---

## Troubleshooting

### Firewall block page vs. JSON auth error

- A **firewall / Cloudflare block** returns an **HTML** page (often mentioning
  "Attention Required", "Cloudflare", or "blocked"). The app now reports this as
  a *blocked* reason and shows a firewall-related message.
- An **auth error** returns **JSON** (e.g. `{"message": "..."}`) with HTTP
  `401` or `403`. The app reports this as an *auth* reason ("API key" related).

The app's messages now distinguish these two cases, so you can tell instantly
whether you need to fix the key or route around a block.

### Sanity-check the relay directly

Open a browser or run `curl`:

```
curl -X POST "https://<relay>/wound-object-detection/1?api_key=<key>" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "AA=="
```

Expected: **JSON** output from Roboflow (a prediction payload). If you instead
get an **HTML block page**, the relay's own egress is blocked (try the other
provider). If you get `{"message":"Relay error","detail":"..."}`, the relay
could not reach upstream — check the URL and redeploy.

### Common fixes

- Trailing slash in the relay URL → remove it and re-save.
- Wrong Model ID or Version → keep `wound-object-detection` / `1`.
- First Render request slow → wait 30–60 s (free-tier cold start) and retry.
- Still blocked on one provider → deploy the other option (Render vs. Vercel);
  their egress IPs differ.
