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
   `https://smart-care-wound-relay.vercel.app`.

---

## Connect the relay to the app

1. Open the Smart Care app.
2. Go to **Settings → Advanced**.
3. Find the **傷口辨識 API 網址** field.
4. Paste the relay URL **with no trailing slash**, e.g.
   `https://smart-care-wound-relay.onrender.com`.
5. Click **Save**.
6. Retest the wound-detection feature.

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
