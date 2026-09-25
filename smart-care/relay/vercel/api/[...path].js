// relay/vercel/api/[...path].js
// Vercel Serverless Function (CommonJS — no package.json required).
// Catch-all route: /api/{modelId}/{version}?api_key=...
// Forwards to https://serverless.roboflow.com/{modelId}/{version}?api_key=...

const ROBOFLOW_BASE = 'https://serverless.roboflow.com';

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
