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
const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash';
const GEMINI_TIMEOUT_MS = 45000; // overall wall-clock budget shared by all attempts
// Each individual model attempt gets its own short budget so a hung candidate
// cannot consume the whole deadline: a per-attempt abort is a ROTATION signal.
const GEMINI_ATTEMPT_TIMEOUT_MS = 12000;
// Quota buckets are PER MODEL: when one model is daily-quota-exhausted (429)
// we rotate to the next candidate to restore service. The list is
// env-overridable via GEMINI_MODELS (comma-separated) for ops flexibility.
const GEMINI_FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash'
];
const GEMINI_MODELS_ENV = String(process.env.GEMINI_MODELS || '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const GEMINI_MODEL_LIST = GEMINI_MODELS_ENV.length
  ? GEMINI_MODELS_ENV
  : GEMINI_FALLBACK_MODELS;
// Upstream statuses that mean "try the next model" (quota / gone / overload).
const GEMINI_ROTATE_STATUSES = [429, 404, 503];
// A 503 gets ONE short retry on the SAME model before rotating to the next.
const GEMINI_RETRY_DELAY_MS = 700;

/** Promisified setTimeout for retry backoff. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Registered BEFORE app.all('*') so it is not swallowed by the Roboflow proxy.
app.post('/gemini-generate', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'server_misconfigured',
      message: 'GEMINI_API_KEY is not set'
    });
  }

  // Candidate order: ?model= -> GEMINI_MODEL env -> fallback list (deduped).
  const requested = typeof req.query.model === 'string' ? req.query.model.trim() : '';
  const envModel = String(process.env.GEMINI_MODEL || '').trim();
  const candidates = [];
  [requested, envModel, ...GEMINI_MODEL_LIST].forEach((name) => {
    if (name && !candidates.includes(name)) candidates.push(name);
  });

  // Forward the body verbatim (express.text already kept it as a raw string).
  const body = typeof req.body === 'string' ? req.body : '';

  // Overall ~45 s wall-clock budget shared by every attempt.
  const deadline = Date.now() + GEMINI_TIMEOUT_MS;

  // The model that produced the response actually returned to the caller.
  let usedModel = candidates[0] || GEMINI_DEFAULT_MODEL;

  try {
    let upstream = null;
    let text = '';

    // Walk the candidates in order. Rotate to the next model on quota (429),
    // missing (404), overloaded (503) or a per-attempt abort/timeout; a 503
    // gets ONE short retry on the SAME model first. Any other status stops the
    // walk and is returned as-is.
    for (const candidate of candidates) {
      const target =
        `${GEMINI_API_BASE}/${encodeURIComponent(candidate)}:generateContent` +
        `?key=${encodeURIComponent(apiKey)}`;

      // True when this candidate aborted/threw, i.e. a rotation signal.
      let aborted = false;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          // Back off before the single 503 retry, while budget remains.
          if (Date.now() + GEMINI_RETRY_DELAY_MS >= deadline) break;
          await sleep(GEMINI_RETRY_DELAY_MS);
        }

        // Stop walking once the shared wall-clock deadline has passed.
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;

        // Cap this attempt by the short per-attempt budget AND what is left of
        // the shared deadline, so no single candidate can stall the walk.
        const attemptBudget = Math.min(GEMINI_ATTEMPT_TIMEOUT_MS, remaining);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), attemptBudget);
        try {
          upstream = await fetch(target, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            body,
            signal: controller.signal
          });
          text = await upstream.text();
          usedModel = candidate;
        } catch (err) {
          // Per-attempt abort/timeout (or network error): forget this
          // response and rotate to the next candidate instead of failing.
          upstream = null;
          text = '';
          usedModel = candidate;
          aborted = true;
          break;
        } finally {
          clearTimeout(timer);
        }

        // Retry the SAME model ONCE on 503 only; otherwise stop this model.
        if (upstream.status === 503 && attempt === 0) continue;
        break;
      }

      if (aborted) continue; // timeout/abort -> try the next candidate model

      if (!upstream) break; // budget exhausted before any upstream response

      // Rotate to the next model ONLY on these statuses; else return this one.
      if (GEMINI_ROTATE_STATUSES.includes(upstream.status)) continue;
      break;
    }

    if (!upstream) {
      // All candidates exhausted with a timeout/abort as the last outcome
      // (or the budget ran out before any upstream response was obtained).
      res.setHeader('X-Relay-Model', usedModel);
      return res.status(504).json({ error: 'upstream_timeout' });
    }

    res.status(upstream.status);
    res.setHeader('X-Relay-Model', usedModel);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json'
    );
    res.send(text);
  } catch (err) {
    res.setHeader('X-Relay-Model', usedModel);
    if (err && err.name === 'AbortError') {
      return res.status(504).json({ error: 'upstream_timeout' });
    }
    // Deliberately no detail: never surface the key or the keyed URL.
    return res.status(502).json({ error: 'relay_error' });
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
