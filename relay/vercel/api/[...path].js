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
const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
const GEMINI_TIMEOUT_MS = 45000; // overall budget shared by all attempts
// Transient-overload handling: retry 503/429 up to 3 TOTAL attempts with a
// short backoff (~800 ms, then ~1600 ms) before giving up.
const GEMINI_MAX_ATTEMPTS = 3;
const GEMINI_RETRY_DELAYS_MS = [800, 1600];

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

  // Model resolution order: ?model= -> GEMINI_MODEL -> built-in default.
  const requested = typeof req.query.model === 'string' ? req.query.model : '';
  const model = requested || process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
  const target =
    `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  // Forward the body verbatim (raw Gemini generateContent JSON).
  const body = await readRawBody(req);

  // Overall ~45 s budget shared by every attempt. Each attempt aborts when the
  // remaining budget is exhausted; that abort maps to 504 upstream_timeout.
  const deadline = Date.now() + GEMINI_TIMEOUT_MS;

  try {
    let upstream = null;
    let text = '';

    for (let attempt = 0; attempt < GEMINI_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        // Back off before a retry, but only while budget remains.
        const delay = GEMINI_RETRY_DELAYS_MS[attempt - 1];
        if (Date.now() + delay >= deadline) break;
        await sleep(delay);
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
      } finally {
        clearTimeout(timer);
      }

      // Retry ONLY transient upstream overload (503/429); never retry other 4xx.
      if (
        attempt < GEMINI_MAX_ATTEMPTS - 1 &&
        (upstream.status === 503 || upstream.status === 429)
      ) {
        continue;
      }
      break;
    }

    if (!upstream) {
      // Budget exhausted before any upstream response was obtained.
      res.statusCode = 504;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'upstream_timeout' }));
    }

    res.statusCode = upstream.status;
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json'
    );
    res.end(text);
  } catch (err) {
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
