// relay/render/server.js
// Minimal Express relay that forwards the app's wound-detection request to
// Roboflow's hosted inference from a non-Cloudflare egress (Render/Vercel).
//
// Contract (matches what the app already sends):
//   POST /{modelId}/{version}?api_key=...   (any path, any method)
//   Content-Type: application/x-www-form-urlencoded
//   body: base64 image (raw string)
// -> forwarded to ${ROBOFLOW_BASE}/{modelId}/{version}?api_key=...

const express = require('express');

const app = express();

// Do not advertise the framework.
app.disable('x-powered-by');

// Capture the raw request body for ANY content type (the app posts base64).
// express.text with `type: () => true` keeps the body as a string.
app.use(express.text({ type: () => true, limit: '25mb' }));

// CORS: allow the browser app (served from file:// or any origin) to call us.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});

// --- Gemini vision proxy -----------------------------------------------------
// Transparent proxy for the app's vision inference. Google Gemini is blocked in
// the user's region, so the request is re-issued from this relay's (US) egress.
// The API key stays server-side and is never logged, echoed, or returned.
//
// Contract:
//   POST /gemini-generate?model=<model>
//   Content-Type: application/json
//   body: Gemini generateContent JSON ({ contents, generationConfig, ... })
// -> forwarded verbatim to
//   https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//
// Gemini's JSON is passed through unchanged so the caller can read
// candidates[0].content.parts[0].text directly.

const GEMINI_API_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
const GEMINI_TIMEOUT_MS = 45000;

// Registered BEFORE app.all('*') so it is not swallowed by the Roboflow proxy.
app.post('/gemini-generate', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'server_misconfigured',
      message: 'GEMINI_API_KEY is not set'
    });
  }

  // Model resolution order: ?model= -> GEMINI_MODEL -> built-in default.
  const requested = typeof req.query.model === 'string' ? req.query.model : '';
  const model = requested || process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
  const target =
    `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  // Forward the body verbatim (express.text already kept it as a raw string).
  const body = typeof req.body === 'string' ? req.body : '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body,
      signal: controller.signal
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json'
    );
    res.send(text);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return res.status(504).json({ error: 'upstream_timeout' });
    }
    // Deliberately no detail: never surface the key or the keyed URL.
    return res.status(502).json({ error: 'relay_error' });
  } finally {
    clearTimeout(timer);
  }
});

// Proxy every other path/method to Roboflow.
app.all('*', async (req, res) => {
  const base = process.env.ROBOFLOW_BASE || 'https://serverless.roboflow.com';
  const target = base + req.originalUrl;

  try {
    // Only send a body for methods that can have one.
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        // Forward the content type, but do NOT forward Origin/Referer/etc.
        'Content-Type':
          req.headers['content-type'] ||
          'application/x-www-form-urlencoded',
        Accept: 'application/json',
        // Browser-like UA: Cloudflare Workers' missing UA contributed to the block.
        'User-Agent': 'Mozilla/5.0 (compatible; smart-care/1.0)'
      },
      body: hasBody ? req.body : undefined
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json'
    );
    res.send(text);
  } catch (err) {
    res.status(502).json({
      message: 'Relay error',
      detail: err && err.message ? err.message : String(err)
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`smart-care wound relay listening on port ${port}`);
});
