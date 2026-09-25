# Smart Care 智慧醫療站 — `smart-care/`

Restructured, modular version of the original single-file kiosk app
([`_source/original-index.html`](../_source/original-index.html)).
Vanilla JavaScript, native ES modules, **no build step, no frameworks, no external libraries**.

This folder implements the **full app** (blueprint steps S1–S15): scaffold, layered
CSS, HTML shell, core primitives, config, i18n, frame parser, BLE thermometer
client, ESP32 client, and the interactive UI layer (`js/ui/*` + `js/app.js`).

---

## 1. Running it (required)

The app **must** be served over HTTP — opening the file directly fails (see §3).

### Recommended: plain HTTP on localhost (Python 3)

```powershell
# from c:/Users/zhaoc/Desktop/smart-health-app/smart-care
python -m http.server 8080
# then open http://localhost:8080/
```

### Alternative: Node (if already installed)

```powershell
# from c:/Users/zhaoc/Desktop/smart-health-app/smart-care
npx --yes serve -l 8080 .
```

Exact commands are also in [`tools/serve.md`](tools/serve.md).

## 2. Why `http://localhost` (and not `file://` or a LAN IP)

| Target | Web Bluetooth | ES modules | ESP32 HTTP | Verdict |
|---|---|---|---|---|
| `http://localhost:8080` | ✅ works (`localhost` is a *potentially trustworthy origin* → `isSecureContext === true`) | ✅ | ✅ (page is HTTP, so no mixed content) | **Primary deployment** |
| `https://…` | ✅ | ✅ | ❌ plain-HTTP ESP32 is blocked as **mixed content** | Needs an HTTPS reverse proxy in front of the ESP32 (out of scope for now) |
| `http://<LAN-IP>` | ❌ not a secure context | ✅ | ✅ | Unsupported for BLE; use localhost on the kiosk machine |
| `file://` | ❌ | ❌ blocked by CORS | ❌ | **Broken** — a static server is mandatory |

`localhost` gives both properties at once: a secure context (BLE allowed) **and** an
HTTP page (so `fetch('http://192.168.1.100/...')` is not mixed content).

## 3. Documented broken paths

- **`file://` is broken.** Native ES modules are fetched with CORS rules and are blocked
  from a `file://` origin; Web Bluetooth is also unavailable. Never ship a
  double-click-the-file shortcut for the kiosk.
- **`http://<LAN-IP>:8080` is broken for BLE.** The page loads and the ESP32 works, but
  `navigator.bluetooth` is `undefined` / the context is insecure, so the thermometer
  cannot be paired. Run the server on the kiosk machine and use `http://localhost:8080`.
- **`https://` page + `http://` ESP32 is broken.** The browser blocks the request as
  mixed content. Serve the ESP32 behind an HTTPS reverse proxy and point
  `esp32.baseUrl` at it (tracked follow-up, not implemented).

## 4. Browser support (Web Bluetooth)

| Browser | Thermometer (BLE) | Notes |
|---|---|---|
| Chrome / Edge on Windows or Android | ✅ | Required for the thermometer and for silent reconnect |
| Chrome / Edge on macOS | ⚠️ limited | Pairing usually works; silent reconnect is unreliable |
| Safari (iOS/macOS), Firefox | ❌ | No Web Bluetooth. Show localized guidance ("Use Chrome or Edge"); ESP32, maps and views keep working |

> **Kiosk-only last resort (with an explicit security warning):** Chrome's
> `unsupported-flag` `--unsafely-treat-insecure-origin-as-secure=http://<LAN-IP>:8080`
> can force BLE on a LAN IP. It disables an important browser security boundary and
> must **not** be used on a machine that browses anything else.

## 5. Configuration (persisted in `localStorage`)

| Key | Type | Purpose |
|---|---|---|
| `smart_care_lang` | string | **Legacy key, preserved byte-for-byte.** Locale code, written/read as before. |
| `smart_care.config` | JSON string | Main config object. |
| `smart_care.config.version` | JSON number | Schema version used for migrations. |

Defaults (see [`js/config.js`](js/config.js:1)):

```jsonc
{
  "schemaVersion": 1,
  "esp32": { "baseUrl": "http://192.168.1.100", "protocol": "http", "host": "192.168.1.100", "commandLockMs": 2200 },
  "ble":   { "serviceUuid": "0000ffe0-0000-1000-8000-00805f9b34fb",
             "characteristicUuid": "0000ffe1-0000-1000-8000-00805f9b34fb",
             "acceptAllDevices": true, "minValidTempC": 30.0, "maxValidTempC": 45.0 },
  "thresholds": { "feverCelsius": 37.5 },
  "device": { "thermometerName": "", "lastConnectedAt": null }
}
```

- `thresholds.feverCelsius` defaults to **37.5** — this is an **approved correction** of the
  original 36.0 *test* value. Do not revert it to 36.0.
- Unknown keys are dropped on save (strict schema whitelist); corrupt JSON falls back to
  defaults with a console warning and never throws.
- `smart_care_lang` is **not** cleared by a config reset.

## 6. File tree

```
smart-care/
├── index.html
├── README.md
├── css/            tokens.css, base.css, layout.css, components.css, utilities.css
├── js/
│   ├── app.js                  (bootstrap: config -> i18n -> clients -> UI wiring)
│   ├── config.js
│   ├── core/       bus.js, dom.js, toast.js
│   ├── devices/    frames.js, ble-thermometer.js, esp32-client.js
│   ├── i18n/       index.js, strings.js
│   └── ui/                     router.js, header.js, settings.js, views.js, maps.js
└── tools/serve.md
```

## 7. Preserved wire contracts (do not change)

- Service UUID `0000ffe0-0000-1000-8000-00805f9b34fb`,
  characteristic UUID `0000ffe1-0000-1000-8000-00805f9b34fb`.
- `requestDevice({ acceptAllDevices: true, optionalServices: [serviceUuid] })`.
- Frame gate `bytes.length >= 6 && bytes[0] === 0xAA && bytes[2] === 0xC1`.
- Decode `((bytes[4] << 8) | bytes[5]) / 100.0`, plausibility window `30.0–45.0 °C`.
- Motor endpoints `m1/fwd`, `m2/fwd`, `m3/fwd`; request shape
  `fetch(baseUrl + '/' + endpoint, { mode: 'no-cors' })`.
- Motor button lock `2200 ms` (default, configurable via `esp32.commandLockMs`).

## 8. Test log (to be filled during the verification step)

| Date | Environment | Result |
|---|---|---|
| — | — | — |
