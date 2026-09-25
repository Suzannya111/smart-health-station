# Serving `smart-care/` locally

A static HTTP server is **mandatory**. Opening [`index.html`](../index.html) via `file://`
blocks native ES modules (CORS) and disables Web Bluetooth. `http://localhost` is the only
target that provides *both* a secure context (BLE) and a non-mixed-content page (ESP32 over HTTP).

Always run the commands **from this folder** (`smart-care/`), e.g.:

```powershell
cd c:/Users/zhaoc/Desktop/smart-health-app/smart-care
```

---

## 1. Python 3 (recommended — no install needed on most kiosks)

```powershell
python -m http.server 8080
```

Then open: <http://localhost:8080/>

Stop with `Ctrl + C`.

## 2. Node / npx (if Node is already present)

```powershell
npx --yes serve -l 8080 .
```

Then open: <http://localhost:8080/>

## 3. Node with `http-server`

```powershell
npx --yes http-server -p 8080 -c-1 .
```

`-c-1` disables caching so edits show up immediately.

## 4. PowerShell one-liner (no Python, no Node)

Serves the current folder on port 8080 via the .NET HTTP listener:

```powershell
$root = (Get-Location).Path
$l = [System.Net.HttpListener]::new(); $l.Prefixes.Add('http://localhost:8080/'); $l.Start()
while ($l.IsListening) {
  $c = $l.GetContext(); $p = Join-Path $root ($c.Request.Url.LocalPath.TrimStart('/'))
  if ($c.Request.Url.LocalPath -eq '/') { $p = Join-Path $root 'index.html' }
  if (Test-Path $p -PathType Leaf) {
    $bytes = [IO.File]::ReadAllBytes($p)
    $ext = [IO.Path]::GetExtension($p)
    $c.Response.ContentType = @{'.html'='text/html';'.js'='text/javascript';'.css'='text/css'}[$ext]
    if (-not $c.Response.ContentType) { $c.Response.ContentType = 'application/octet-stream' }
    $c.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
```

---

## 5. Verifying the environment (browser console)

Open <http://localhost:8080/> and paste into DevTools → Console:

```js
({ href: location.href, secure: isSecureContext, bluetooth: 'bluetooth' in navigator })
// expected on the recommended target:
// { href: "http://localhost:8080/", secure: true, bluetooth: true }
```

## 6. Health checks

```powershell
# server answers
Invoke-WebRequest http://localhost:8080/ -UseBasicParsing | Select-Object StatusCode

# ES modules resolve (should NOT be 404)
Invoke-WebRequest http://localhost:8080/js/app.js -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://localhost:8080/js/devices/frames.js -UseBasicParsing | Select-Object StatusCode
```

## 7. Known-bad setups (see README §3)

| Setup | Symptom |
|---|---|
| `file://…/index.html` | Blank page; console: *"Access to script … has been blocked by CORS policy"* (modules are not allowed on `file://`). |
| `http://192.168.x.x:8080` | App loads, but `'bluetooth' in navigator` is `false` → *"Secure context required (localhost or HTTPS)"*. |
| HTTPS page + `http://192.168.x.x` ESP32 | Console: *"Mixed Content: … blocked"* → ESP32 commands never leave the browser. |

Port 8080 busy? Use any free port (`8081`, `5173`, …) — all app paths are relative,
so nothing needs editing.
