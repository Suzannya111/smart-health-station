# Leaflet + OpenStreetMap Combined Map — Implementation Plan

Feature: replace the keyless Google Maps `<iframe>` embeds with a **Leaflet +
OpenStreetMap** map that shows, on a **single map simultaneously**:
1. the user's recent location marker (from the existing geolocation feature), and
2. nearby medical institutions as markers (keyless, via Overpass API).

Scope of this document: research + design only. No code was modified.

---

## 1. Verified current state (against actual files)

| Concern | Fact | Reference |
|---|---|---|
| Map implementation | Keyless Google Maps `<iframe>` | [`index.html`](index.html:122), [`index.html`](index.html:176) |
| Controller | `createMaps({ bus, i18n, router, location })` | [`js/ui/maps.js`](js/ui/maps.js:67) |
| URL builder | `buildMapUrl(query, position, mode)`, modes `'facilities'`/`'person'` | [`js/ui/maps.js`](js/ui/maps.js:47) |
| iframe ids | `homeMapFrame`, `alertMapFrame` (`MAP_FRAMES`) | [`js/ui/maps.js`](js/ui/maps.js:30) |
| Geolocation service | `createLocation({ bus })`, localStorage `smart_care.lastLocation` | [`js/ui/location.js`](js/ui/location.js:86) |
| Bus events | `location:changed`, `location:error` | [`js/core/bus.js`](js/core/bus.js:33) |
| Bootstrap order | `location.init()` then `maps.init()` then `views.init()` then `router.init()` | [`js/app.js`](js/app.js:65) |
| Activation lifecycle | `showView` toggles `.is-active` (line 91) **then** runs hooks (line 98) | [`js/ui/router.js`](js/ui/router.js:85) |
| Views persist | No unmount; only `.is-active` class toggles | [`js/ui/router.js`](js/ui/router.js:52) |
| CSS box | `.map-box { height: 300px }` (240px mobile, 340px ≥1024px) | [`css/components.css`](css/components.css:296) |
| iframe CSS | `.map-box iframe { width/height:100% }` | [`css/components.css`](css/components.css:306) |
| Toolbar CSS | `.map-toolbar`, `.map-toolbar__status` | [`css/components.css`](css/components.css:321) |
| i18n | 4 locales; `map.locate*`, `map.location.*`, `mapQuery`, `error.geolocation.*` | [`js/i18n/strings.js`](js/i18n/strings.js:87) |
| i18n accessor | `getMapQuery()` (used ONLY by maps.js) | [`js/i18n/index.js`](js/i18n/index.js:189) |
| No build step | Plain ES modules; no CSP meta present | [`index.html`](index.html:473) |
| Default coords | **None in maps.js**; Macau `22.1987, 113.5439` in weather | [`js/weather.js`](js/weather.js:11) |

Verified: `buildMapUrl`, `MAP_FRAMES`, `getMapQuery`, and `mapQuery` have **no
external consumers** — they are safe to refactor/remove. `refreshLoaded` is
called only inside [`js/ui/maps.js`](js/ui/maps.js:1).

---

## 2. Library choice + no-bundler integration

### 2.1 Version
**Leaflet 1.9.4** (latest stable 1.x). Do NOT use the Leaflet 2.0 alpha.

### 2.2 `index.html` `<head>` (after line 15, before `</head>`)
```html
<!-- Leaflet (keyless) — pinned + SRI -->
<link rel="stylesheet"
      href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
      crossorigin="">
```

### 2.3 `index.html` before the module scripts (before line 473)
```html
<!-- Leaflet JS (classic, parser-blocking → runs before deferred module scripts) -->
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
        crossorigin=""></script>
<script type="module" src="js/app.js"></script>
<script type="module" src="js/weather.js"></script>
```

**Why this order is safe:** module scripts are deferred (execute after parsing),
while this classic script is parser-blocking, so `window.L` is defined before
`js/app.js` runs. Guard in the module regardless:
```js
const L = (typeof window !== 'undefined' && window.L) || null;
```
If `!L`, skip map init, render a fallback link, and disable the locate button
(progressive enhancement — see §8).

### 2.4 CDN reference from ES-module code
Leaflet is a UMD global (`window.L`); reference it through the guarded `const L`
above. No `import` is possible without a bundler. jsDelivr is an acceptable
alternative (`https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/...`, same SRI).

> ⚠️ **Open question (needs user input):** CDN choice (unpkg vs jsDelivr) and
> whether to keep `integrity` (recommended) — the SRI hashes above are the
> published Leaflet 1.9.4 values but **must be re-verified at implementation
> time**; if unverifiable, omit `integrity` but keep `crossorigin`.

---

## 3. Map containers (iframe → div)

Leaflet needs a sized DOM element (0-height breaks it). `.map-box` already has an
explicit height, so it is safe.

**Home — replace [`index.html`](index.html:121)-124:**
```html
<div class="map-box">
  <div id="homeMap" class="leaflet-map" role="region" aria-label="附近醫療地圖"
       data-i18n-attr="aria-label:mapTitle"></div>
</div>
```

**Alert — replace [`index.html`](index.html:175)-178:**
```html
<div class="map-box">
  <div id="alertMap" class="leaflet-map" role="region" aria-label="附近醫療地圖"
       data-i18n-attr="aria-label:mapTitle"></div>
</div>
```

**CSS — replace [`css/components.css`](css/components.css:306)-311:**
```css
.map-box .leaflet-map {
  width: 100%;
  height: 100%;
  display: block;
  background: var(--surface-soft);
}
.leaflet-container { font: inherit; }
.map-facility-icon { font-size: 20px; line-height: 24px; text-align: center; }
```
`.map-box { overflow: hidden }` ([`css/components.css`](css/components.css:298))
is fine; note it can clip popups near edges (acceptable, or switch to
`overflow: clip`).

---

## 4. Basemap + attribution

```js
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
```
- `maxZoom: 19`; optionally `detectRetina: true`.
- **OSM tile usage policy:** acceptable for this low-volume app **only** with the
  attribution above and no bulk downloading. Keep the Leaflet attribution control
  (do not remove it).
- **Optional fallback provider** (if OSM tiles are blocked): CARTO light basemap
  `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png` with combined
  OSM + CARTO attribution. Flag as an open question.
- Attribution text stays in English (proper nouns); optional i18n prefix
  `map.attribution` — not required.

---

## 5. Nearby facilities — keyless Overpass API

### 5.1 Endpoint + call
- Primary: `https://overpass-api.de/api/interpreter` (CORS enabled, `ACAO: *`).
- Fallback mirror: `https://overpass.kumi.systems/api/interpreter`.
- **POST** `Content-Type: application/x-www-form-urlencoded`, body `data=<QL>`.
- `AbortController` with a client timeout of **12000 ms** (server `[timeout:25]`).

### 5.2 Overpass QL (radius default **3000 m**, limit 50)
```
[out:json][timeout:25];
nwr(around:3000,CENTER_LAT,CENTER_LNG)["amenity"~"^(hospital|clinic|doctors|pharmacy|dentist)$"];
out center tags 50;
```
- `nwr` = node + way + relation.
- `out center` yields `center:{lat,lon}` for ways/relations; nodes have `lat/lon`.
- `tags` included by default (`out body`); `50` is the result limit.
- **Coordinate parsing:** `el.lat/el.lon` for nodes, `el.center.lat/el.center.lon`
  for ways/relations; skip elements without resolvable coordinates.

### 5.3 Caching / dedup (avoid re-query on every tick)
- Module-level `facilityCache: Map<string, { at, elements }>`, key =
  `lat.toFixed(3),lng.toFixed(3),radius`, **TTL 10 min**.
- `inflightRequests: Map<key, Promise>` so Home + Alert sharing one center
  **share a single network request**.
- Re-fetch only when: cache miss/expired **and** the center moved > ~250 m.
- Raise the 3-decimal cache key to ≈111 m resolution — good enough for this app.
- Optional `sessionStorage` persistence — not required.

### 5.4 Fallback when no location / permission denied
Use the default center **Macau `22.1987, 113.5439`** (mirrors
[`js/weather.js`](js/weather.js:11)); the Overpass query still runs around it so
the map remains useful.

> ⚠️ **Open question (needs user input):** radius (recommend 3000 m) and whether
> the default center should be Macau (matches the app's weather default).

---

## 6. Markers, popups, fit-bounds

**User marker + accuracy circle**
```js
userMarker = L.circleMarker([lat, lng], {
  radius: 8, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1
}).bindPopup(t('map.popup.you'));
if (Number.isFinite(accuracy) && accuracy > 0)
  userCircle = L.circle([lat, lng], { radius: Math.min(accuracy, 5000), /* subtle style */ });
```

**Facility markers** — prefer `L.divIcon` (avoids Leaflet's default
`marker-icon.png` image requests / CSP img wildcard):
```js
L.marker([lat, lng], {
  icon: L.divIcon({ className: 'map-facility-icon', html: typeEmoji(amenity), iconSize: [24,24] })
}).bindPopup(popupNode(tags, amenity));
```
**Popup XSS safety (IMPORTANT):** build the popup with DOM nodes +
`textContent` (never `innerHTML` with raw OSM `tags.name`). Show
`tags.name || t('map.facility.medical')` and `t('map.facility.type.' + amenity)`.

**Fit bounds**
```js
const layers = [...facilityMarkers, userMarker, userCircle].filter(Boolean);
if (layers.length > 1) map.fitBounds(L.featureGroup(layers).getBounds().pad(0.15), { maxZoom: 17 });
else if (userMarker) map.setView([lat, lng], 15);
else if (facilityMarkers.length) map.fitBounds(L.featureGroup(facilityMarkers).getBounds().pad(0.15), { maxZoom: 17 });
else map.setView(DEFAULT_CENTER, 13);
```
No clustering needed at ≤50 markers (markercluster would be a new dependency —
not recommended).

---

## 7. Reactivity / router lifecycle

Views stay in the DOM; only `.is-active` toggles. Because `showView` applies the
`.is-active` class **before** running activation hooks, the container is already
visible/sized when the hook fires — but always call `map.invalidateSize()` on
activation (cheap, robust against the hidden→visible transition).

```
mapsByView = new Map()   // viewId -> { map, tileLayer, facilityLayer, userLayer }

ensureMap(viewId):        // idempotent — creates once per view
  if (!L) return null
  if (mapsByView.has(viewId)) return mapsByView.get(viewId)
  el = document.getElementById(MAP_IDS[viewId]); if (!el) return null
  map = L.map(el, { zoomControl: true }).setView(centerOrDefault(), 13)
  tileLayer = addOsmTiles(map)
  facilityLayer = L.layerGroup().addTo(map)
  userLayer = L.layerGroup().addTo(map)
  mapsByView.set(viewId, {...}); return ...

activate(viewId):
  m = ensureMap(viewId); if (!m) return
  m.map.invalidateSize()
  seedFromStored()
  renderUserMarkers()        // all created maps
  loadFacilities()           // cache/dedup, then renderFacilityMarkers + fitAll
  ensureGeolocation()        // Home-only (existing behaviour)

bus.on(location:changed):  update coords+accuracy; locating=false;
                           renderUserMarkers(); loadFacilities() if center moved; fitAll(); renderControl()
bus.on(location:error):    locating=false; toast(key); keep last-known; renderControl()
bus.on(i18n:changed):      renderControl(); refresh popups (re-bind) / status text
```
- **No teardown** needed (page-lifetime views); `ensureMap` prevents duplicate maps.
- **Map scope:** recommend **both Home and Alert** get the combined map, sharing
  the facility cache and in-flight dedup; Home keeps the toolbar, Alert shows a
  status line only.

> ⚠️ **Open question (needs user input):** confirm Alert should also become a
> combined Leaflet map (recommended) vs Home-only.

---

## 8. Error / edge handling

| Scenario | Detection | Behaviour |
|---|---|---|
| Leaflet CDN unavailable | `window.L` falsy | Skip map init; show fallback link to openstreetmap.org; disable locate button; `console.warn` |
| Geolocation denied / unavailable / timeout | `location:error` | Keep last-known marker; existing toast key; restore control |
| No stored + no live fix | `coords === null` | Center on default Macau; query facilities around default |
| Overpass fetch fail / timeout / HTTP ≥ 400 | `AbortError` / `!res.ok` | Status `map.facilities.error`; toast once; keep user marker + tiles; retry next activation |
| Overpass rate limit (429 / 504) | `res.status` | Back off: skip re-fetch for 60 s (record `failedAt`) |
| No facilities returned | `elements.length === 0` | Status `map.facilities.empty`; user-only view |
| Offline | `navigator.onLine === false` / fetch reject | Same as fetch failure; no crash |
| Tiles fail to load | `tileerror` event | Markers still render over blank background |
| Unnamed / unknown facility | missing `tags.name`/`amenity` | Fallback `map.facility.medical` + generic icon |
| XSS via OSM name | n/a | Popups built with `textContent`, never raw `innerHTML` |
| Re-activation / double fetch | router hook + dedup | `ensureMap` idempotent; shared in-flight promise per cache key |
| `invalidateSize` on hidden map | activation hook | Called after `.is-active` applied; also on `location:changed` |

---

## 9. UI / toolbar cleanup + i18n

### 9.1 Markup (Home, [`index.html`](index.html:115)-120)
Keep title + one button + status; the person/facilities toggle is obsolete.
```html
<div class="map-title" data-i18n="mapTitle">📍 附近即時醫療與診所分佈</div>
<div class="map-toolbar">
  <button type="button" class="btn btn-outline" data-action="locate-me" id="btnLocateMe"
          data-i18n="map.locate">📍 定位我的位置</button>
  <span class="map-toolbar__status" id="mapLocationStatus" role="status" aria-live="polite"></span>
</div>
```
Remove the `data-action="show-facilities"` handling entirely.

### 9.2 i18n keys (ALL 4 locales: zh-Hant / zh-Hans / en / pt)
**Add:**
| Key | zh-Hant | zh-Hans | en | pt |
|---|---|---|---|---|
| `map.facilities.loading` | 載入附近醫療機構… | 加载附近医疗机构… | Loading nearby facilities… | A carregar unidades próximas… |
| `map.facilities.error` | 無法載入附近醫療機構 | 无法加载附近医疗机构 | Could not load nearby facilities | Não foi possível carregar as unidades |
| `map.facilities.empty` | 附近找不到醫療機構 | 附近找不到医疗机构 | No nearby medical facilities found | Nenhuma unidade de saúde encontrada |
| `map.facility.medical` | 醫療機構 | 医疗机构 | Medical facility | Unidade de saúde |
| `map.facility.type.hospital` | 醫院 | 医院 | Hospital | Hospital |
| `map.facility.type.clinic` | 診所 | 诊所 | Clinic | Clínica |
| `map.facility.type.doctors` | 醫生 | 医生 | Doctor | Médico |
| `map.facility.type.pharmacy` | 藥房 | 药房 | Pharmacy | Farmácia |
| `map.facility.type.dentist` | 牙醫 | 牙医 | Dentist | Dentista |
| `map.popup.you` | 你的位置 | 你的位置 | You are here | A sua localização |

**Remove (now obsolete):** `map.locate.showFacilities`
([`js/i18n/strings.js`](js/i18n/strings.js:89)).
**Keep:** `map.locate`, `map.locate.locating`, `map.location.updated`,
`map.location.stored`, `mapTitle`, all `error.geolocation.*`.

**Remove obsolete map-query machinery:** per-locale `mapQuery` values
([`js/i18n/strings.js`](js/i18n/strings.js:84)), `mapQuery: 'map.query'` in
`LEGACY_KEY_MAP` ([`js/i18n/strings.js`](js/i18n/strings.js:38)), and
`getMapQuery()` ([`js/i18n/index.js`](js/i18n/index.js:189)) + its export
([`js/i18n/index.js`](js/i18n/index.js:227)).

### 9.3 CSS changes
- Replace `.map-box iframe` → `.map-box .leaflet-map` (see §3).
- Add `.map-facility-icon` + `.leaflet-container` rules (see §3).
- Reuse existing `.map-toolbar` / `.map-toolbar__status` / `.status-pill` — no
  new toolbar CSS required.

---

## 10. `js/ui/maps.js` — new module structure

**Keep:** `createMaps({ bus, i18n, router, location })`, `coords`, `locating`,
`geolocationRequested`, `seedFromStored`, `hasStored`, `ensureGeolocation`,
`requestFix`, `renderControl`, bus subscriptions, `init` registration pattern,
and the `LOCATION_VIEW` (Home) constraint for geolocation.

**Delete:** `buildMapUrl`, iframe `MAP_FRAMES` + `frameFor`, `urlFor`, `load`,
`loadedViews`, `mode`, `showFacilities`, `refreshLoaded` (replace with
`refreshMaps`), the `show-facilities` delegate, and `mapQuery` usage.

**Add / repurpose (function list):**
```
constants: DEFAULT_CENTER (Macau), FACILITY_RADIUS = 3000,
           OVERPASS_ENDPOINTS, FACILITY_AMENITIES, CACHE_TTL_MS
state:     mapsByView, facilityCache, inflightRequests, coords, accuracy
ensureMap(viewId)                  -> create-once Leaflet map (+ tiles + layers)
addTileLayer(map)                  -> OSM tile layer
loadFacilities({ force })          -> cache/dedup/fetch Overpass -> elements
renderFacilityMarkers(elements)    -> safe popups + markers (all maps)
renderUserMarkers()                -> circleMarker + accuracy circle (all maps)
fitAll()                           -> fitBounds(user + facilities)
buildOverpassQuery(lat, lng, r)    -> QL string
parseElements(elements)            -> normalised { lat, lng, name, amenity }
refreshMaps()                      -> renderUserMarkers + renderFacilityMarkers + fitAll
activate(viewId)                   -> ensureMap + invalidateSize + seed + load + geolocate
renderControl()                    -> locate button + status (incl. facility states)
```
**Return:** `{ init, activate, refreshMaps, renderControl, MAP_IDS }`.

**Optional split:** extract the Overpass query/cache into `js/ui/overpass.js`
(single responsibility). Recommend keeping one file for a minimal diff.

---

## 11. File-by-file change list

1. [`index.html`](index.html:15) — add Leaflet CSS `<link>` (§2.2).
2. [`index.html`](index.html:473) — add Leaflet classic `<script>` before modules (§2.3).
3. [`index.html`](index.html:121) / [`index.html`](index.html:175) — iframe → `<div class="leaflet-map">` (§3).
4. [`css/components.css`](css/components.css:306) — `.map-box iframe` → `.leaflet-map` + icon/container rules (§3).
5. [`js/ui/maps.js`](js/ui/maps.js:1) — rewrite per §10.
6. [`js/i18n/strings.js`](js/i18n/strings.js:26) — add/remove keys across 4 locales (§9.2).
7. [`js/i18n/index.js`](js/i18n/index.js:189) — remove `getMapQuery` + export (§9.2).
8. [`js/app.js`](js/app.js:58) — unchanged (still `createMaps({ bus, i18n, router, location })`).
9. `plans/` — this design doc.

---

## 12. Risks + mitigations

| Risk | Mitigation |
|---|---|
| SRI hash mismatch breaks loading | Verify at implementation; otherwise drop `integrity`, keep `crossorigin` |
| OSM tile policy / rate limiting | Keep attribution control; low volume; optional fallback tile provider (§4) |
| Overpass down / CORS surprises | Fallback mirror; 12 s timeout; cache; graceful status + toast (§8) |
| Leaflet map sized 0 in hidden view | `.is-active` applied before hooks; `invalidateSize()` on activation |
| Popups clipped by `.map-box overflow:hidden` | Accept, or `overflow: clip` / edge padding |
| OSM name XSS in popups | Build popups with `textContent`, never raw `innerHTML` |
| Accuracy circle enormous | Clamp displayed radius (e.g. `Math.min(accuracy, 5000)`) |
| i18n popups stale after locale switch | Re-bind popups on `i18n:changed` |
| Two maps double memory/fetches | Shared cache + in-flight dedup; `ensureMap` idempotent |
| Future CSP would block CDN/tiles/Overpass | Document needed sources: `https://unpkg.com`, `https://*.tile.openstreetmap.org`, `https://overpass-api.de` |
| Leaflet z-index vs header/settings dialog | Leaflet default (≤700) is below the top-layer `<dialog>` — verify visually |

---

## 13. Open questions (need user input)

1. **CDN choice**: unpkg (recommended) vs jsDelivr; keep SRI?
2. **Facility radius**: 3000 m default (recommended) or other?
3. **Alert map scope**: convert Alert to the combined Leaflet map too (recommended,
   shared cache) or Home-only?
4. **Fallback tile provider**: add CARTO fallback or OSM only?
5. **Click-through**: should facility popups link to OpenStreetMap, or
   `https://www.google.com/maps/dir/?api=1&destination=lat,lng` for directions?
