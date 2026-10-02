// relay/vercel/api/[...path].js
// Vercel Serverless Function (CommonJS — no package.json required).
// Catch-all route: /api/{modelId}/{version}?api_key=...
// Forwards to https://serverless.roboflow.com/{modelId}/{version}?api_key=...

const ROBOFLOW_BASE = 'https://serverless.roboflow.com';

// --- Gemini vision proxy -----------------------------------------------------
// Transparent proxy for the app's vision inference, reachable at
// POST /api/gemini-generate?model=<model>. Google Gemini is blocked in the
// user's region, so the request is re-issued from this function's egress.
// The API key stays server-side and is never logged, echoed, or returned.
const GEMINI_API_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash';
const GEMINI_TIMEOUT_MS = 45000; // overall budget shared by all attempts
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

/** Read the raw request stream as a UTF-8 string. */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return resolve('');
    }
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Proxy a Gemini generateContent call and pass the JSON through unchanged. */
async function handleGemini(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(
      JSON.stringify({
        error: 'server_misconfigured',
        message: 'GEMINI_API_KEY is not set'
      })
    );
  }

  // Candidate order: ?model= -> GEMINI_MODEL env -> fallback list (deduped).
  const requested = typeof req.query.model === 'string' ? req.query.model.trim() : '';
  const envModel = String(process.env.GEMINI_MODEL || '').trim();
  const candidates = [];
  [requested, envModel, ...GEMINI_MODEL_LIST].forEach((name) => {
    if (name && !candidates.includes(name)) candidates.push(name);
  });

  // Forward the body verbatim (raw Gemini generateContent JSON).
  const body = await readRawBody(req);

  // Overall ~45 s budget shared by every attempt. Each attempt aborts when the
  // remaining budget is exhausted; that abort maps to 504 upstream_timeout.
  const deadline = Date.now() + GEMINI_TIMEOUT_MS;

  // The model that produced the response actually returned to the caller.
  let usedModel = candidates[0] || GEMINI_DEFAULT_MODEL;

  try {
    let upstream = null;
    let text = '';

    // Walk the candidates in order. Rotate to the next model on quota (429),
    // missing (404) or overloaded (503); a 503 gets ONE short retry on the
    // SAME model first. Any other status stops the walk and is returned as-is.
    for (const candidate of candidates) {
      const target =
        `${GEMINI_API_BASE}/${encodeURIComponent(candidate)}:generateContent` +
        `?key=${encodeURIComponent(apiKey)}`;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          // Back off before the single 503 retry, while budget remains.
          if (Date.now() + GEMINI_RETRY_DELAY_MS >= deadline) break;
          await sleep(GEMINI_RETRY_DELAY_MS);
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), remaining);
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
        } finally {
          clearTimeout(timer);
        }

        // Retry the SAME model ONCE on 503 only; otherwise stop this model.
        if (upstream.status === 503 && attempt === 0) continue;
        break;
      }

      if (!upstream) break; // budget exhausted before any upstream response

      // Rotate to the next model ONLY on these statuses; else return this one.
      if (GEMINI_ROTATE_STATUSES.includes(upstream.status)) continue;
      break;
    }

    if (!upstream) {
      // Budget exhausted before any upstream response was obtained.
      res.statusCode = 504;
      res.setHeader('X-Relay-Model', usedModel);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'upstream_timeout' }));
    }

    res.statusCode = upstream.status;
    res.setHeader('X-Relay-Model', usedModel);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json'
    );
    res.end(text);
  } catch (err) {
    res.setHeader('X-Relay-Model', usedModel);
    if (err && err.name === 'AbortError') {
      res.statusCode = 504;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'upstream_timeout' }));
    }
    // Deliberately no detail: never surface the key or the keyed URL.
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'relay_error' }));
  }
}

module.exports = async function handler(req, res) {
  // CORS + preflight.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    // Build the upstream path from the catch-all segments.
    const rawPath = req.query.path;
    const segments = Array.isArray(rawPath)
      ? rawPath
      : rawPath
        ? [rawPath]
        : [];

    // Gemini proxy branch: POST /api/gemini-generate?model=...
    if (segments.length === 1 && segments[0] === 'gemini-generate') {
      return await handleGemini(req, res);
    }

    // Keep every other query param (notably api_key), drop `path`.
    const params = new URLSearchParams();
    Object.keys(req.query).forEach((key) => {
      if (key === 'path') return;
      const value = req.query[key];
      if (Array.isArray(value)) {
        value.forEach((v) => params.append(key, v));
      } else {
        params.append(key, value);
      }
    });

    const query = params.toString();
    const pathPart = segments
      .map((seg) => encodeURIComponent(seg))
      .join('/');

    const target =
      `${ROBOFLOW_BASE}/${pathPart}` + (query ? `?${query}` : '');

    const body = await readRawBody(req);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        'Content-Type':
          req.headers['content-type'] ||
          'application/x-www-form-urlencoded',
        Accept: 'application/json',
        // Browser-like UA: Cloudflare Workers' missing UA contributed to the block.
        'User-Agent': 'Mozilla/5.0 (compatible; smart-care/1.0)'
      },
      body: hasBody ? body : undefined
    });

    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json'
    );
    res.end(text);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        message: 'Relay error',
        detail: err && err.message ? err.message : String(err)
      })
    );
  }
};
