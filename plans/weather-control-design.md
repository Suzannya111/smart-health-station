# Weather Control Debug Function — Design (Settings → Advanced Settings)

## 1. Investigation summary (current implementation)

The requested "weather control debug function" **already exists** in the Settings
dialog's Advanced section, and is already wired to a real weather override
mechanism. The work is therefore *verify + polish*, not greenfield.

### Weather override mechanism — [`js/weather.js`](js/weather.js:1)
- Captured element: `const devWeatherSelect = document.getElementById('devWeatherSelect');` ([`js/weather.js`](js/weather.js:18)).
- Supported values: `auto` | `sunny` | `cloudy` | `rainy` ([`js/weather.js`](js/weather.js:138)).
- Behaviour:
  - `auto` → `fetchMacauWeather()` (live Open-Meteo API) ([`js/weather.js`](js/weather.js:140)).
  - `sunny` → `applyWeatherState('sunny', 28, 0)` + toast `weather.dev.toast.sunny` ([`js/weather.js`](js/weather.js:143)).
  - `cloudy` → `applyWeatherState('cloudy', 24, 20)` + toast ([`js/weather.js`](js/weather.js:146)).
  - `rainy` → `applyWeatherState('rainy', 20, 90)` + toast; unlocks raincoat ([`js/weather.js`](js/weather.js:149)).
- Application to UI: `applyWeatherState()` writes `#weatherIcon`, `#weatherStateText`,
  `#tempRainText` imperatively and toggles the raincoat button
  ([`js/weather.js`](js/weather.js:53)).
- Persistence: **NONE** — session-only. `currentWeatherMode` (`let … = 'sunny'`, [`js/weather.js`](js/weather.js:20))
  and selection are lost on reload; reload always calls `fetchMacauWeather()`
  ([`js/weather.js`](js/weather.js:121)).
- Language re-render: `i18n.onLanguageChange(...)` re-applies `lastState`
  ([`js/weather.js`](js/weather.js:156)) so the override survives a language switch.
- Module is loaded as its own `<script type="module">` at [`index.html`](index.html:437);
  the Home weather panel lives at [`index.html`](index.html:52).

### Settings structure — [`index.html`](index.html:1) + [`js/ui/settings.js`](js/ui/settings.js:1)
- The Settings surface is a **static** native `<dialog id="settingsDialog">` in
  [`index.html`](index.html:1); [`js/ui/settings.js`](js/ui/settings.js:1) only *drives* it
  (populate / render / delegate clicks). Markup is NOT generated dynamically.
- "Advanced Settings" is the `<details class="advanced" open>` block at
  [`index.html`](index.html:362). Its `<summary>` uses `settings.advanced.summary`.
- The weather dev control is **already the first child** of that `<details>`, at
  [`index.html`](index.html:366)–[`index.html`](index.html:375):
  a `<div class="field" style="background:#f3f4f6; …">` containing
  `<label for="devWeatherSelect" data-i18n="weather.dev.title">` and
  `<select id="devWeatherSelect" class="select">` with the four `<option>`s.
- Settings row conventions: `<div class="field"><label for=… data-i18n=…>…</label><input/select …></div>`,
  `<label class="checkbox-row">`, `<p class="hint" id="…">`; advanced block styled by
  `.advanced` in [`css/components.css`](css/components.css:631).
- Persistence: settings go through [`js/config.js`](js/config.js:1) (`saveConfig` →
  strict whitelist `mergeWhitelisted` + `validateConfig` → `localStorage['smart_care.config']`).
  **The weather override is intentionally NOT part of config**, so `Save` /
  `Reset to defaults` do not affect it.
- Events: shared bus [`js/core/bus.js`](js/core/bus.js:1) (`CONFIG_CHANGED`,
  `I18N_CHANGED`); i18n re-renders all `[data-i18n]` nodes on `config:changed`
  ([`js/i18n/index.js`](js/i18n/index.js:207)).

### i18n workflow
- Flat dotted keys per locale in `STRINGS` ([`js/i18n/strings.js`](js/i18n/strings.js:57)); 4 locales:
  `zh-Hant`, `zh-Hans`, `en`, `pt` ([`js/i18n/strings.js`](js/i18n/strings.js:20)).
- `t(key)` substitutes `{name}`; `[data-i18n="key"]` → `textContent`;
  `[data-i18n-attr="attr:key"]` → attribute ([`js/i18n/index.js`](js/i18n/index.js:161)).
- `weather.dev.*` keys already exist in **all 4 locales**:
  `title`, `option.auto`, `option.sunny`, `option.cloudy`, `option.rainy`,
  `toast.sunny`, `toast.cloudy`, `toast.rainy`
  (zh-Hant [`js/i18n/strings.js`](js/i18n/strings.js:105), zh-Hans
  [`js/i18n/strings.js`](js/i18n/strings.js:269), en [`js/i18n/strings.js`](js/i18n/strings.js:420),
  pt [`js/i18n/strings.js`](js/i18n/strings.js:573)).

## 2. Recommendation

**Do NOT move or duplicate the control — it is already correctly placed** in
Settings → Advanced Settings. Keep the existing `#devWeatherSelect` id, the
existing `weather.dev.*` keys and the existing `change` handler; close the gaps
below so it behaves like a deliberate debug function:

1. **Guard against a race** where the initial async `fetchMacauWeather()` resolves
   *after* the user picks an override, silently clobbering it. Add an
   `overrideActive` flag.
2. **Persist the override** across reloads (sessionStorage/localStorage key
   `smart_care.weatherOverride`) so a demo state survives a refresh, *without*
   touching the frozen config schema.
3. **Add an "auto restored" toast** for symmetry with the other options.
4. **Replace inline styles** with a CSS class (`.weather-dev`) matching `.advanced`.
5. **Add an explanatory hint** (`weather.dev.hint`) so the control is
   self-describing and clearly marked as a developer/demo tool.
6. **Accessibility**: give the `<select>` an `aria-label` (reuse `weather.dev.title`).

Optional (present as a decision, recommendation = keep visible): gate the control
behind `?debug=1` / a `localStorage` flag if it must never appear in production.
Recommendation: this is a controlled prototype/kiosk device and the block is
already under "Advanced (developer tools)", so keep it visible; note the risk.

## 3. Files to create / modify

| File | Change |
| --- | --- |
| [`index.html`](index.html:366) | Replace the inline-styled weather `<div class="field">` (lines 366–375) with a class-based `.weather-dev` block; add `aria-label` to the select and a `weather.dev.hint` `<p class="hint">`. Keep id `devWeatherSelect` and the four `<option value>`s. |
| [`js/weather.js`](js/weather.js:18) | Add `WEATHER_OVERRIDE_KEY`, `readOverride()`/`writeOverride()`, `overrideActive` flag and an `applyOverride(val)` helper; refactor the `change` handler to persist + delegate; on init read the stored override and apply it (skipping the live fetch); guard `fetchMacauWeather`/auto-apply against `overrideActive`. |
| [`css/components.css`](css/components.css:649) | Add a `.weather-dev` block after `.advanced[open] > summary`. |
| [`js/i18n/strings.js`](js/i18n/strings.js:1) | Add `weather.dev.hint` and `weather.dev.toast.auto` for all 4 locales (see §5). |
| [`js/ui/settings.js`](js/ui/settings.js:1) | No change required (control is static in HTML; weather module owns behaviour). One optional line noted in §6. |

## 4. Proposed HTML (matching Settings conventions)

```html
<details class="advanced" open>
  <summary data-i18n="settings.advanced.summary">進階設定與開發者工具</summary>

  <!-- Developer weather simulation -->
  <div class="field weather-dev">
    <label for="devWeatherSelect" data-i18n="weather.dev.title">⚡ 開發者測試：模擬天氣控制</label>
    <select id="devWeatherSelect" class="select"
            data-i18n-attr="aria-label:weather.dev.title">
      <option value="auto"   data-i18n="weather.dev.option.auto">🌐 自動讀取澳門真實天氣 (預設)</option>
      <option value="sunny"  data-i18n="weather.dev.option.sunny">☀️ 晴天 (Sun / 0% 雨)</option>
      <option value="cloudy" data-i18n="weather.dev.option.cloudy">☁️ 多雲 (Cloudy / 20% 雨)</option>
      <option value="rainy"  data-i18n="weather.dev.option.rainy">🌧️ 下雨 (Rainy / 90% 雨 - 解鎖雨衣發放)</option>
    </select>
    <p class="hint" data-i18n="weather.dev.hint">…</p>
  </div>

  <div class="field mt-3">
    <label for="svcUuid" data-i18n="settings.advanced.serviceUuid">服務 UUID</label>
    …
```

## 5. JS wiring outline ([`js/weather.js`](js/weather.js:1))

```js
const WEATHER_OVERRIDE_KEY = 'smart_care.weatherOverride';
let overrideActive = false;               // suppress late live-fetch clobbers

const OVERRIDES = {
  sunny:  { temp: 28, rainProb: 0,  toast: 'weather.dev.toast.sunny'  },
  cloudy: { temp: 24, rainProb: 20, toast: 'weather.dev.toast.cloudy' },
  rainy:  { temp: 20, rainProb: 90, toast: 'weather.dev.toast.rainy'  }
};

function readOverride()  { try { return localStorage.getItem(WEATHER_OVERRIDE_KEY) || 'auto'; } catch { return 'auto'; } }
function writeOverride(v){ try { localStorage.setItem(WEATHER_OVERRIDE_KEY, v); } catch {} }

function applyOverride(val) {
  if (val === 'auto') {
    overrideActive = false;
    writeOverride('auto');
    fetchMacauWeather();                       // live API restores normal weather
    showToast(t('weather.dev.toast.auto'));
    return;
  }
  const cfg = OVERRIDES[val];
  if (!cfg) return;
  overrideActive = true;
  writeOverride(val);
  applyWeatherState(val, cfg.temp, cfg.rainProb);
  showToast(t(cfg.toast));
}

// in DOMContentLoaded, replace the raw change handler:
if (devWeatherSelect) {
  devWeatherSelect.addEventListener('change', (e) => applyOverride(e.target.value));
  const stored = readOverride();
  if (stored !== 'auto' && OVERRIDES[stored]) {
    devWeatherSelect.value = stored;
    applyOverride(stored);
  } else {
    devWeatherSelect.value = 'auto';
    fetchMacauWeather();
  }
}

// guard the live path so a slow fetch cannot overwrite a manual override:
// in applyWeatherState(), or at the end of fetchMacauWeather():
if (!overrideActive) { /* only then apply fetched/derived state */ }
```

`auto` restores normal weather by clearing the flag and calling the live
`fetchMacauWeather()` (which itself falls back to sunny on network error,
[`js/weather.js`](js/weather.js:106)).

### Default / reset / persistence
- **Default**: no stored value → `auto` → live Open-Meteo fetch.
- **Persistence**: `localStorage['smart_care.weatherOverride']` (independent of
  config, so `Save`/`Reset to defaults` in the dialog do not wipe it).
- **Reset**: choosing `auto` clears the override and restores live weather.
- **Save button**: intentionally does not persist the weather override (it is a
  debug toggle, not application config). Document this.

## 6. CSS needed ([`css/components.css`](css/components.css:1))

```css
/* --- developer weather override ---------------------------------------- */
.weather-dev {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid #c7d2fe;
  border-radius: var(--radius-sm);
  background: #eef2ff;
}
.weather-dev > label {
  font-weight: 700;
  color: var(--primary-blue);
}
.weather-dev .select { margin-top: 5px; }
```

Optional coupling to Settings reset (only if desired): in
[`js/ui/settings.js`](js/ui/settings.js:483) `doResetAll()`, after `resetConfig()`
emit a bus event / dispatch a `CustomEvent('weather:reset')`, and have
[`js/weather.js`](js/weather.js:1) listen and call `applyOverride('auto')` +
reset the `<select>`. Recommend leaving this out to keep the debug toggle
independent.

## 7. New i18n keys (all 4 locales)

Existing `weather.dev.title` / `option.*` / `toast.sunny|cloudy|rainy` **suffice**;
only two additive keys are proposed:

| Key | zh-Hant | zh-Hans | en | pt |
| --- | --- | --- | --- | --- |
| `weather.dev.hint` | 僅供展示與測試使用；選「自動」會恢復讀取澳門即時天氣。 | 仅供展示与测试使用；选「自动」会恢复读取澳门实时天气。 | For demo/testing only — Auto restores live Macau weather. | Apenas para demonstração/testes — Auto repõe o tempo real de Macau. |
| `weather.dev.toast.auto` | 已恢復：自動讀取澳門即時天氣 🌐 | 已恢复：自动读取澳门实时天气 🌐 | Restored: auto-fetching live Macau weather 🌐 | Restaurado: tempo real de Macau automático 🌐 |

Insert next to the existing `weather.dev.*` block in each locale
(zh-Hant [`js/i18n/strings.js`](js/i18n/strings.js:105), zh-Hans
[`js/i18n/strings.js`](js/i18n/strings.js:269), en [`js/i18n/strings.js`](js/i18n/strings.js:420),
pt [`js/i18n/strings.js`](js/i18n/strings.js:573)).

## 8. Edge cases / risks

- **Late live-fetch clobber (real bug today)**: initial `fetchMacauWeather()` is
  async; picking an override before it resolves lets the fetch overwrite it.
  Mitigated by the `overrideActive` guard.
- **Language-change re-render**: `applyToDOM()` rewrites `<option>` `textContent`
  via `data-i18n` but keeps each option's `value`/`selected`, so the selection is
  preserved; `weather.js` `onLanguageChange` re-applies `lastState` to keep the
  panel consistent ([`js/weather.js`](js/weather.js:156)). No dialog re-render is
  needed because the weather panel is on Home, not in the dialog.
- **Persistence across reload**: solved via `smart_care.weatherOverride`.
- **Dev control leaking into production**: the block is always visible under
  Advanced. Acceptable for a controlled prototype; if unacceptable, gate it behind
  `?debug=1` or a `localStorage` flag (hide the `.weather-dev` node otherwise).
- **Accessibility**: keep `<label for="devWeatherSelect">`; add `aria-label` via
  `data-i18n-attr`; native `<select>` is keyboard operable and inside the dialog's
  focus trap ([`js/ui/settings.js`](js/ui/settings.js:542)).
- **Mobile layout**: `.field` stacks label over control; the new `.weather-dev`
  class (replacing inline styles) keeps padding/contrast consistent with `.advanced`
  and avoids horizontal overflow.
