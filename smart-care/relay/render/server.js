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

// Proxy every path/method to Roboflow.
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
